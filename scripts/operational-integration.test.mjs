import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerHooks } from "node:module";
import { Client } from "pg";
import {
  OPERATIONAL_TABLES,
  buildRelationalRows,
  importOperationalRows,
  validateImportedRows,
} from "./operational-database.mjs";
import {
  getSourceControlState,
  historicalEvidenceFingerprint,
  loadOperationalSource,
  logicalFingerprint,
} from "./operational-data.mjs";
import {
  MIGRATION_ADVISORY_LOCK_KEY,
  runMigrations,
} from "./migration-runner.mjs";

const databaseUrlA = process.env.OPERATIONAL_TEST_DATABASE_URL_A?.trim();
const databaseUrlB = process.env.OPERATIONAL_TEST_DATABASE_URL_B?.trim();
const databaseNameA = process.env.OPERATIONAL_TEST_DATABASE_NAME_A?.trim();
const databaseNameB = process.env.OPERATIONAL_TEST_DATABASE_NAME_B?.trim();
const importerRole = process.env.OPERATIONAL_TEST_IMPORTER_ROLE?.trim();
const configured = Boolean(
  databaseUrlA && databaseUrlB && databaseNameA && databaseNameB && importerRole,
);

test("operational migrations and imports are transactional and repeatable", {
  skip: configured ? false : "Disposable PostgreSQL test databases are not provisioned.",
  timeout: 120_000,
}, async () => {
  assert.match(databaseNameA, /^kaizen_project_manager_migration_test_[ab]$/);
  assert.match(databaseNameB, /^kaizen_project_manager_migration_test_[ab]$/);
  assert.notEqual(databaseNameA, databaseNameB);
  assert.notEqual(databaseNameA, "kaizen_project_manager_dev");
  assert.notEqual(databaseNameB, "kaizen_project_manager_dev");

  const migrationsDirectory = path.join(process.cwd(), "database", "migrations");
  const silentLogger = { log() {} };
  for (const connectionString of [databaseUrlA, databaseUrlB]) {
    const first = await runMigrations({ connectionString, migrationsDirectory, logger: silentLogger });
    const second = await runMigrations({ connectionString, migrationsDirectory, logger: silentLogger });
    assert.ok(first.every((migration) => migration.state === "applied"));
    assert.ok(second.every((migration) => migration.state === "applied"));
    await grantImporterPrivileges(connectionString, importerRole);
  }
  await clearDisposableOperationalData(databaseUrlA, databaseNameA);
  await clearDisposableOperationalData(databaseUrlB, databaseNameB);

  await verifyAdvisoryLock(databaseUrlA, migrationsDirectory, silentLogger);
  await verifyChecksumMismatch(databaseUrlA, migrationsDirectory, silentLogger);
  await verifyTransactionalMigration(databaseUrlA, migrationsDirectory, silentLogger);

  const source = await loadOperationalSource({
    sourceDirectory: path.join(process.cwd(), ".data"),
    projectionManifestPath: path.join(
      process.cwd(),
      "database",
      "operational-runtime-projection-v1.json",
    ),
    allowRuntimeProjection: true,
  });
  const sourceControl = await getSourceControlState();
  const rows = buildRelationalRows(source.data);
  const fingerprint = logicalFingerprint(rows);
  const importRecord = {
    sourceCommit: sourceControl.commit,
    sourceWorktreeDirty: sourceControl.worktreeDirty,
    sourceManifest: {
      files: source.inventory,
      rawCounts: source.rawCounts,
      projectedCounts: source.projectedCounts,
      historicalEvidenceSha256: historicalEvidenceFingerprint(source.raw),
      worktreeFingerprint: sourceControl.worktreeFingerprint,
    },
    projectionManifest: source.projection,
    logicalFingerprint: fingerprint,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const invalidRows = structuredClone(rows);
  invalidRows.deliverable_criterion[0].criterion_id = "missing-criterion";
  await assert.rejects(
    () => importOperationalRows({
      connectionString: databaseUrlA,
      expectedDatabase: databaseNameA,
      databaseRole: importerRole,
      rows: invalidRows,
      importRecord: { ...importRecord, logicalFingerprint: logicalFingerprint(invalidRows) },
    }),
    /foreign key|violates/i,
  );
  assert.equal(await tableCount(databaseUrlA, "project"), 0);
  assert.equal(await tableCount(databaseUrlA, "operational_import"), 0);

  await importOperationalRows({
    connectionString: databaseUrlA,
    expectedDatabase: databaseNameA,
    databaseRole: importerRole,
    rows,
    importRecord,
  });
  await assert.rejects(
    () => importOperationalRows({
      connectionString: databaseUrlA,
      expectedDatabase: databaseNameA,
      databaseRole: importerRole,
      rows,
      importRecord,
    }),
    /target is not empty/i,
  );

  await importOperationalRows({
    connectionString: databaseUrlB,
    expectedDatabase: databaseNameB,
    databaseRole: importerRole,
    rows,
    importRecord,
  });
  const validationA = await validateImportedRows({
    connectionString: databaseUrlA,
    expectedDatabase: databaseNameA,
    databaseRole: importerRole,
    expectedRows: rows,
  });
  const validationB = await validateImportedRows({
    connectionString: databaseUrlB,
    expectedDatabase: databaseNameB,
    databaseRole: importerRole,
    expectedRows: rows,
  });
  assert.equal(validationA.logicalFingerprint, fingerprint);
  assert.equal(validationB.logicalFingerprint, fingerprint);
  assert.deepEqual(validationA.counts, validationB.counts);
  assert.equal(await countEmptyJsonChangeArrays(databaseUrlA), 1);

  await verifyDatabaseConstraints(databaseUrlA);
  await verifyDatabaseConstraints(databaseUrlB);
  await verifyRuntimePersistence(databaseUrlA, source.data);
  await clearDisposableOperationalData(databaseUrlA, databaseNameA);
  await importOperationalRows({
    connectionString: databaseUrlA,
    expectedDatabase: databaseNameA,
    databaseRole: importerRole,
    rows,
    importRecord,
  });
  const restoredValidationA = await validateImportedRows({
    connectionString: databaseUrlA,
    expectedDatabase: databaseNameA,
    databaseRole: importerRole,
    expectedRows: rows,
  });
  assert.equal(restoredValidationA.logicalFingerprint, fingerprint);
  assert.deepEqual(restoredValidationA.counts, validationB.counts);
});

async function verifyRuntimePersistence(connectionString, source) {
  process.env.DATABASE_URL = connectionString;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export {}", shortCircuit: true };
      }
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (specifier.startsWith(".")) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw error;
      }
    },
  });
  const runtime = await import("../src/lib/operational/postgres.ts");
  const database = await import("../src/lib/database.ts");
  const backend = await import("../src/lib/operational/backend.ts");
  const projectFacade = await import("../src/lib/projects.ts");
  const packageFacade = await import("../src/lib/packages.ts");
  const deliverableFacade = await import("../src/lib/deliverables.ts");
  const actionFacade = await import("../src/lib/project-actions.ts");
  const previousBackend = process.env.OPERATIONAL_DATA_BACKEND;

  try {
    delete process.env.OPERATIONAL_DATA_BACKEND;
    assert.equal(backend.getOperationalDataBackend(), "json");
    process.env.OPERATIONAL_DATA_BACKEND = "unsupported";
    assert.throws(() => backend.getOperationalDataBackend(), /must be exactly/);
    process.env.OPERATIONAL_DATA_BACKEND = "postgres";

    const expectedProjects = [...source.projects].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt));
    assert.deepEqual(await projectFacade.getProjects(), expectedProjects);
    for (const project of source.projects) {
      const expectedPackages = source.packages
        .filter((projectPackage) => projectPackage.projectId === project.id)
        .sort((left, right) => left.packageCode.localeCompare(right.packageCode));
      const expectedActions = source.actionStore.actions
        .filter((action) => action.projectId === project.id)
        .sort((left, right) => left.sequence - right.sequence);
      assert.deepEqual(await packageFacade.getPackages(project.id), expectedPackages);
      assert.deepEqual(await actionFacade.getProjectActions(project.id), expectedActions);
    }

    const project = await projectFacade.createProject({
      projectNumber: `runtime-${Date.now()}`,
      name: "Runtime persistence verification",
      description: "Disposable integration-test Project.",
      projectManager: "Integration Test",
      customer: "Test Customer",
      reportsTo: "Test Sponsor",
      siteLocation: "Test Site",
      plannedStartDate: "2026-01-15",
      plannedCompletionDate: "2026-12-15",
      validationRequired: false,
      currentStage: "initiation",
    });
    assert.equal(project.plannedStartDate, "2026-01-15");
    assert.equal(project.plannedCompletionDate, "2026-12-15");

    const updatedProject = await projectFacade.updateProject(project.id, {
      projectNumber: project.projectNumber,
      name: "Updated runtime persistence verification",
      description: project.description,
      projectManager: project.projectManager,
      customer: project.customer,
      reportsTo: project.reportsTo,
      siteLocation: project.siteLocation,
      plannedStartDate: project.plannedStartDate,
      plannedCompletionDate: project.plannedCompletionDate,
      validationRequired: project.validationRequired,
      currentStage: "closure",
    });
    assert.equal(updatedProject?.name, "Updated runtime persistence verification");
    assert.equal(updatedProject?.currentStage, "initiation");

    const tiers = await Promise.all(
      ["Execution", "Steering", "Sponsor", "Board"].map((name) =>
        runtime.createProjectGovernanceTier(project.id, {
          name,
          description: `${name} tier`,
        })),
    );
    assert.deepEqual(
      tiers.map((tier) => tier?.sequence).sort((left, right) => left - right),
      [1, 2, 3, 4],
    );
    const executionTier = tiers.find((tier) => tier?.name === "Execution");
    const boardTier = tiers.find((tier) => tier?.name === "Board");
    assert.ok(executionTier);
    assert.ok(boardTier);
    assert.equal(
      (await projectFacade.updateProjectGovernanceTier(
        project.id,
        executionTier.id,
        { name: "Delivery", description: "Updated tier" },
      ))?.name,
      "Delivery",
    );
    assert.equal(
      (await projectFacade.moveProjectGovernanceTier(
        project.id,
        boardTier.id,
        "up",
      ))?.sequence,
      Math.max(1, boardTier.sequence - 1),
    );
    assert.deepEqual(
      await projectFacade.deleteProjectGovernanceTier(project.id, boardTier.id),
      { outcome: "deleted" },
    );

    const packageInput = {
      packageCode: "PKG-RACE",
      packageName: "Concurrent Package",
      description: "Concurrency check.",
      packageOwner: "Integration Test",
      executionModel: "internal",
      currentStage: "definition",
      status: "not_assessed",
      targetDeliveryDate: "2026-09-30",
    };
    const packageResults = await Promise.allSettled([
      packageFacade.createPackage(project.id, packageInput),
      packageFacade.createPackage(project.id, packageInput),
    ]);
    assert.equal(
      packageResults.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      packageResults.filter((result) => result.status === "rejected").length,
      1,
    );
    const projectPackage = (await packageFacade.getPackages(project.id))[0];
    assert.equal(projectPackage.targetDeliveryDate, "2026-09-30");
    const updatedPackage = await packageFacade.updatePackage(
      project.id,
      projectPackage.id,
      {
        ...packageInput,
        packageName: "Updated Concurrent Package",
        currentStage: "closure",
      },
    );
    assert.equal(updatedPackage?.packageName, "Updated Concurrent Package");
    assert.equal(updatedPackage?.currentStage, "definition");

    const actionActor = { userId: null, displayName: "Integration Test" };
    const actions = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        actionFacade.createManualProjectAction(
          project.id,
          {
            description: `Concurrent Action ${index + 1}`,
            assignee: "Integration Test",
            dueDate: "2026-06-30",
            status: "new",
            priority: "medium",
            packageIds: [],
            governanceTierId: null,
            gateId: null,
            initialUpdate: null,
          },
          actionActor,
        )),
    );
    assert.deepEqual(
      actions.map((action) => action.sequence).sort((left, right) => left - right),
      [1, 2, 3, 4, 5, 6],
    );
    const actionWithTier = await actionFacade.updateProjectAction(
      project.id,
      actions[1].id,
      {
        description: actions[1].description,
        assignee: actions[1].assignee,
        dueDate: actions[1].dueDate,
        status: actions[1].status,
        priority: actions[1].priority,
        packageIds: actions[1].packageIds,
        governanceTierId: executionTier.id,
        gateId: actions[1].gateId,
        initialUpdate: null,
      },
      actionActor,
    );
    assert.equal(actionWithTier.governanceTierId, executionTier.id);
    await actionFacade.updateProjectAction(
      project.id,
      actions[1].id,
      {
        description: actionWithTier.description,
        assignee: actionWithTier.assignee,
        dueDate: actionWithTier.dueDate,
        status: actionWithTier.status,
        priority: actionWithTier.priority,
        packageIds: actionWithTier.packageIds,
        governanceTierId: null,
        gateId: actionWithTier.gateId,
        initialUpdate: null,
      },
      actionActor,
    );
    const tierReferences = await actionFacade.getGovernanceTierActionReferences(
      project.id,
      executionTier.id,
    );
    assert.deepEqual(tierReferences.currentActionIds, []);
    assert.deepEqual(tierReferences.historicalActionIds, [actions[1].id]);
    assert.equal(
      (await projectFacade.deleteProjectGovernanceTier(
        project.id,
        executionTier.id,
      ))?.outcome,
      "referenced",
    );

    const actionWithComment = await actionFacade.addProjectActionUpdate(
      project.id,
      actions[0].id,
      "Runtime comment",
      actionActor,
    );
    assert.equal(actionWithComment.updates.at(-1)?.text, "Runtime comment");
    const closedAction = await actionFacade.closeProjectAction(
      project.id,
      actions[0].id,
      actionActor,
      "Runtime close",
    );
    assert.equal(closedAction.status, "closed");
    assert.ok(closedAction.closingDate);
    const reopenedAction = await actionFacade.reopenProjectAction(
      project.id,
      actions[0].id,
      "in_progress",
      actionActor,
      "Runtime reopen",
    );
    assert.equal(reopenedAction.status, "in_progress");
    assert.equal(reopenedAction.closingDate, null);
    const actionBeforeRollback = await actionFacade.getProjectAction(project.id, actions[0].id);
    await assert.rejects(
      () => actionFacade.updateProjectAction(
        project.id,
        actions[0].id,
        {
          description: "This update must roll back.",
          assignee: "Integration Test",
          dueDate: "2026-07-01",
          status: "new",
          priority: "high",
          packageIds: ["missing-package"],
          governanceTierId: null,
          gateId: null,
          initialUpdate: "Must not persist.",
        },
        actionActor,
      ),
      /selected Packages are invalid/,
    );
    assert.deepEqual(
      await actionFacade.getProjectAction(project.id, actions[0].id),
      actionBeforeRollback,
    );
    assert.deepEqual(
      await actionFacade.deleteProjectAction(project.id, actions[5].id),
      { deleted: true },
    );
    assert.equal(await actionFacade.getProjectAction(project.id, actions[5].id), null);

    const currentProject = await projectFacade.getProject(project.id);
    const currentGate = currentProject.gates.find(
      (gate) => gate.stageId === currentProject.currentStage,
    );
    assert.ok(currentGate);
    const customCriterion = await projectFacade.createProjectGateCriterion(
      project.id,
      currentGate.id,
      { description: "Runtime criterion", status: "pending" },
    );
    assert.ok(customCriterion);
    assert.equal(
      (await projectFacade.updateProjectGateCriterion(
        project.id,
        currentGate.id,
        customCriterion.id,
        { description: "Updated runtime criterion", status: "completed" },
      ))?.description,
      "Updated runtime criterion",
    );
    const customDeliverable = await deliverableFacade.createDeliverable({
      projectId: project.id,
      packageId: null,
      gateId: currentGate.id,
      criterionIds: [customCriterion.id],
      title: "Runtime Deliverable",
      description: "Runtime deliverable regression.",
      status: "in_progress",
      stageId: currentGate.stageId,
      scopeLevel: "project",
    });
    assert.deepEqual(customDeliverable.criterionIds, [customCriterion.id]);
    assert.equal(
      (await deliverableFacade.updateDeliverable(customDeliverable.id, {
        ...customDeliverable,
        criterionIds: [customCriterion.id],
        title: "Updated Runtime Deliverable",
        status: "completed",
      }))?.title,
      "Updated Runtime Deliverable",
    );
    assert.equal(
      await projectFacade.deleteProjectGateCriterion(
        project.id,
        currentGate.id,
        customCriterion.id,
      ),
      true,
    );
    assert.deepEqual(
      (await deliverableFacade.getGateDeliverables(
        project.id,
        null,
        currentGate.id,
      )).find((deliverable) => deliverable.id === customDeliverable.id)?.criterionIds,
      [],
    );
    assert.equal(
      await deliverableFacade.deleteDeliverable(customDeliverable.id, {
        projectId: project.id,
        packageId: null,
        gateId: currentGate.id,
      }),
      true,
    );
    const gateAction = await actionFacade.createGateProjectAction(
      project.id,
      currentGate.id,
      [],
      false,
      {
        description: "Frozen Gate Action",
        assignee: "Integration Test",
        dueDate: "2026-08-01",
        priority: "high",
        initialUpdate: null,
      },
      actionActor,
    );
    for (const criterion of currentGate.criteria) {
      const updated = await projectFacade.updateProjectGateCriterion(
        project.id,
        currentGate.id,
        criterion.id,
        { description: criterion.description, status: "completed" },
      );
      assert.ok(updated);
    }
    const deliverables = await deliverableFacade.getGateDeliverables(
      project.id,
      null,
      currentGate.id,
    );
    for (const deliverable of deliverables) {
      const updated = await deliverableFacade.updateDeliverable(deliverable.id, {
        projectId: project.id,
        packageId: null,
        gateId: currentGate.id,
        criterionIds: deliverable.criterionIds,
        title: deliverable.title,
        description: deliverable.description,
        status: "completed",
        stageId: deliverable.stageId,
        scopeLevel: "project",
      });
      assert.ok(updated);
    }
    const approver = await projectFacade.createProjectGateApprover(
      project.id,
      currentGate.id,
      {
        name: "Runtime Approver",
        email: "runtime-approver@example.invalid",
        roleFunction: "Project Sponsor",
        approvalRole: "Approver",
        approvalLevel: 1,
      },
    );
    assert.ok(approver);
    assert.equal(
      (await projectFacade.updateProjectGateApprover(
        project.id,
        currentGate.id,
        approver.id,
        {
          name: "Updated Runtime Approver",
          email: approver.email,
          roleFunction: approver.roleFunction,
          approvalRole: approver.approvalRole,
          approvalLevel: approver.approvalLevel,
        },
      ))?.name,
      "Updated Runtime Approver",
    );
    const temporaryApprover = await projectFacade.createProjectGateApprover(
      project.id,
      currentGate.id,
      {
        name: "Temporary Approver",
        email: "temporary-approver@example.invalid",
        roleFunction: "Test",
        approvalRole: "Test",
        approvalLevel: 2,
      },
    );
    assert.ok(temporaryApprover);
    assert.equal(
      await projectFacade.deleteProjectGateApprover(
        project.id,
        currentGate.id,
        temporaryApprover.id,
      ),
      true,
    );

    const submissions = await Promise.all([
      projectFacade.submitProjectGateForApproval(project.id, currentGate.id),
      projectFacade.submitProjectGateForApproval(project.id, currentGate.id),
    ]);
    const submitted = submissions.find((result) => result?.outcome === "submitted");
    assert.ok(submitted);
    assert.equal(
      submissions.filter((result) => result?.outcome === "submitted").length,
      1,
    );
    const cycle = submitted.reviewCycle;
    assert.equal(cycle.cycleNumber, 1);
    assert.equal(cycle.frozenEvidence.acceptedActions[0].actionId, gateAction.id);

    const protectedDeletion = await actionFacade.deleteProjectAction(project.id, gateAction.id);
    assert.equal(protectedDeletion.deleted, false);
    assert.match(protectedDeletion.reason, /active Review Cycle/);

    const claims = await Promise.all([
      projectFacade.claimProjectGateReviewInvitation(
        project.id,
        currentGate.id,
        cycle.id,
        approver.id,
      ),
      projectFacade.claimProjectGateReviewInvitation(
        project.id,
        currentGate.id,
        cycle.id,
        approver.id,
      ),
    ]);
    const claimed = claims.find(Boolean);
    assert.ok(claimed?.claimToken);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(
      await projectFacade.completeProjectGateReviewInvitation(
        project.id,
        currentGate.id,
        cycle.id,
        approver.id,
        claimed.attempt.id,
        { status: "sent", providerMessageId: "runtime-invalid" },
        "invalid-claim-token",
      ),
      false,
    );
    assert.equal(
      await projectFacade.completeProjectGateReviewInvitation(
        project.id,
        currentGate.id,
        cycle.id,
        approver.id,
        claimed.attempt.id,
        { status: "sent", providerMessageId: `runtime-${claimed.attempt.id}` },
        claimed.claimToken,
      ),
      true,
    );
    assert.deepEqual(
      await runtime.internalRecordIdentityBoundGateReviewResponse({
        projectId: project.id,
        packageId: null,
        gateId: currentGate.id,
        reviewCycleId: cycle.id,
        actorUserId: "00000000-0000-4000-8000-000000000000",
        outcome: "approved",
        comment: "Must fail closed.",
      }),
      { outcome: "approver_not_found" },
    );
    await assert.rejects(
      () => projectFacade.respondToProjectGateReview(
        project.id,
        currentGate.id,
        {
          reviewCycleId: cycle.id,
          gateApproverId: approver.id,
          outcome: "approved",
          comment: "Must remain disabled.",
        },
      ),
      /authenticated approver assignment/,
    );

    const withdrawal = await projectFacade.withdrawProjectGateSubmission(
      project.id,
      currentGate.id,
    );
    assert.equal(withdrawal?.outcome, "withdrawn");
    const resubmission = await projectFacade.submitProjectGateForApproval(
      project.id,
      currentGate.id,
    );
    assert.equal(resubmission?.outcome, "submitted");
    assert.equal(resubmission.reviewCycle.cycleNumber, 2);
    assert.equal(resubmission.reviewCycle.previousCycleId, cycle.id);

    const packageBeforeSubmission = await packageFacade.getPackage(
      project.id,
      projectPackage.id,
    );
    const packageGate = packageBeforeSubmission?.gates.find(
      (gate) => gate.stageId === packageBeforeSubmission.currentStage,
    );
    assert.ok(packageGate);
    for (const criterion of packageGate.criteria) {
      assert.ok(await packageFacade.updatePackageGateCriterion(
        project.id,
        projectPackage.id,
        packageGate.id,
        criterion.id,
        { description: criterion.description, status: "completed" },
      ));
    }
    for (const deliverable of await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      packageGate.id,
    )) {
      assert.ok(await deliverableFacade.updateDeliverable(deliverable.id, {
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: packageGate.id,
        criterionIds: deliverable.criterionIds,
        title: deliverable.title,
        description: deliverable.description,
        status: "completed",
        stageId: deliverable.stageId,
        scopeLevel: "package",
      }));
    }
    const packageApprover = await packageFacade.createPackageGateApprover(
      project.id,
      projectPackage.id,
      packageGate.id,
      {
        name: "Package Approver",
        email: "package-approver@example.invalid",
        roleFunction: "Package Sponsor",
        approvalRole: "Approver",
        approvalLevel: 1,
      },
    );
    assert.ok(packageApprover);
    const packageSubmissions = await Promise.all([
      packageFacade.submitPackageGateForApproval(
        project.id,
        projectPackage.id,
        packageGate.id,
      ),
      packageFacade.submitPackageGateForApproval(
        project.id,
        projectPackage.id,
        packageGate.id,
      ),
    ]);
    const packageSubmission = packageSubmissions.find(
      (result) => result?.outcome === "submitted",
    );
    assert.ok(packageSubmission);
    assert.equal(
      packageSubmissions.filter((result) => result?.outcome === "submitted").length,
      1,
    );
    await assert.rejects(
      () => packageFacade.respondToPackageGateReview(
        project.id,
        projectPackage.id,
        packageGate.id,
        {
          reviewCycleId: packageSubmission.reviewCycle.id,
          gateApproverId: packageApprover.id,
          outcome: "approved",
          comment: "Must remain disabled.",
        },
      ),
      /authenticated approver assignment/,
    );
    const packageClaim = await packageFacade.claimPackageGateReviewInvitation(
      project.id,
      projectPackage.id,
      packageGate.id,
      packageSubmission.reviewCycle.id,
      packageApprover.id,
    );
    assert.ok(packageClaim?.claimToken);
    assert.equal(
      await packageFacade.completePackageGateReviewInvitation(
        project.id,
        projectPackage.id,
        packageGate.id,
        packageSubmission.reviewCycle.id,
        packageApprover.id,
        packageClaim.attempt.id,
        {
          status: "failed",
          error: { code: "runtime_failure", message: "Expected runtime failure." },
        },
        packageClaim.claimToken,
      ),
      true,
    );
    const packageRetries = await Promise.all([
      packageFacade.claimPackageGateReviewInvitation(
        project.id,
        projectPackage.id,
        packageGate.id,
        packageSubmission.reviewCycle.id,
        packageApprover.id,
        true,
      ),
      packageFacade.claimPackageGateReviewInvitation(
        project.id,
        projectPackage.id,
        packageGate.id,
        packageSubmission.reviewCycle.id,
        packageApprover.id,
        true,
      ),
    ]);
    assert.equal(packageRetries.filter(Boolean).length, 1);
    const packageRetry = packageRetries.find(Boolean);
    assert.ok(packageRetry?.claimToken);
    assert.equal(
      await packageFacade.completePackageGateReviewInvitation(
        project.id,
        projectPackage.id,
        packageGate.id,
        packageSubmission.reviewCycle.id,
        packageApprover.id,
        packageRetry.attempt.id,
        { status: "sent", providerMessageId: `runtime-${packageRetry.attempt.id}` },
        packageRetry.claimToken,
      ),
      true,
    );
    assert.equal(
      (await packageFacade.withdrawPackageGateSubmission(
        project.id,
        projectPackage.id,
        packageGate.id,
      ))?.outcome,
      "withdrawn",
    );
    assert.equal(await packageFacade.deletePackage(project.id, projectPackage.id), true);
    assert.equal(await packageFacade.getPackage(project.id, projectPackage.id), null);
    assert.equal(
      (await runtime.getArchivedPackage(project.id, projectPackage.id))?.id,
      projectPackage.id,
    );

    const disposableProject = await projectFacade.createProject({
      projectNumber: `runtime-delete-${Date.now()}`,
      name: "Hard deletion verification",
      description: "No retained history.",
      projectManager: "Integration Test",
      customer: "Test Customer",
      reportsTo: "Test Sponsor",
      siteLocation: "Test Site",
      plannedStartDate: "",
      plannedCompletionDate: "",
      validationRequired: false,
      currentStage: "initiation",
    });
    const disposablePackage = await packageFacade.createPackage(
      disposableProject.id,
      { ...packageInput, packageCode: "PKG-DELETE" },
    );
    assert.ok(disposablePackage);
    assert.equal(
      await packageFacade.deletePackage(disposableProject.id, disposablePackage.id),
      true,
    );
    assert.equal(
      await runtime.getArchivedPackage(disposableProject.id, disposablePackage.id),
      null,
    );
    assert.equal(await projectFacade.deleteProject(disposableProject.id), true);
    assert.equal(await runtime.getArchivedProject(disposableProject.id), null);

    assert.equal(await projectFacade.deleteProject(project.id), true);
    assert.equal(await projectFacade.getProject(project.id), null);
    assert.equal((await runtime.getArchivedProject(project.id))?.id, project.id);
  } finally {
    if (previousBackend == null) {
      delete process.env.OPERATIONAL_DATA_BACKEND;
    } else {
      process.env.OPERATIONAL_DATA_BACKEND = previousBackend;
    }
    await database.getOperationalPool().end();
  }
}

async function verifyAdvisoryLock(connectionString, migrationsDirectory, logger) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_ADVISORY_LOCK_KEY]);
    await assert.rejects(
      () => runMigrations({
        connectionString,
        migrationsDirectory,
        statusOnly: true,
        lockTimeoutMs: 200,
        logger,
      }),
      /Could not acquire the database migration lock/,
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_ADVISORY_LOCK_KEY]);
    await client.end();
  }
}

async function verifyChecksumMismatch(connectionString, migrationsDirectory, logger) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kaizen-migrations-checksum-"));
  try {
    await cp(migrationsDirectory, temporaryDirectory, { recursive: true });
    const migrationPath = path.join(temporaryDirectory, "004_operational_data_foundation.sql");
    const migration = await readFile(migrationPath, "utf8");
    await writeFile(migrationPath, `${migration}\n-- altered by checksum test\n`, "utf8");
    await assert.rejects(
      () => runMigrations({
        connectionString,
        migrationsDirectory: temporaryDirectory,
        statusOnly: true,
        logger,
      }),
      /checksum mismatch/i,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function verifyTransactionalMigration(connectionString, migrationsDirectory, logger) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kaizen-migrations-transaction-"));
  try {
    await cp(migrationsDirectory, temporaryDirectory, { recursive: true });
    await writeFile(
      path.join(temporaryDirectory, "007_transaction_rollback_test.sql"),
      "CREATE TABLE migration_rollback_probe (id integer);\nSELECT * FROM missing_migration_relation;\n",
      "utf8",
    );
    await assert.rejects(
      () => runMigrations({ connectionString, migrationsDirectory: temporaryDirectory, logger }),
      /Failed to apply 007_transaction_rollback_test.sql/,
    );
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(
        "SELECT to_regclass('public.migration_rollback_probe') AS relation",
      );
      assert.equal(result.rows[0].relation, null);
      const ledger = await client.query(
        "SELECT 1 FROM identity_schema_migration WHERE name = '007_transaction_rollback_test.sql'",
      );
      assert.equal(ledger.rowCount, 0);
    } finally {
      await client.end();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function grantImporterPrivileges(connectionString, role) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe importer role name.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.query(`GRANT SELECT ON identity_schema_migration, app_user TO "${role}"`);
    await client.query(
      `GRANT SELECT, INSERT ON ${OPERATIONAL_TABLES.map((table) => `"${table}"`).join(", ")} TO "${role}"`,
    );
  } finally {
    await client.end();
  }
}

async function clearDisposableOperationalData(connectionString, expectedDatabase) {
  assert.match(expectedDatabase, /^kaizen_project_manager_migration_test_[ab]$/);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const database = await client.query("SELECT current_database() AS name");
    assert.equal(database.rows[0]?.name, expectedDatabase);
    await client.query(
      `TRUNCATE TABLE ${[...OPERATIONAL_TABLES].reverse().map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await client.end();
  }
}

async function verifyDatabaseConstraints(connectionString) {
  await expectDatabaseError(connectionString,
    "UPDATE project_action SET sequence = 5 WHERE sequence = 2",
    /unique|duplicate/i);
  await expectDatabaseError(connectionString,
    "UPDATE gate_review_cycle SET frozen_evidence = '{}'::jsonb WHERE cycle_number = 1",
    /immutable/i);
  await expectDatabaseError(connectionString,
    "DELETE FROM gate_review_cycle WHERE cycle_number = 1",
    /historical records/i);
  await expectDatabaseError(connectionString,
    "DELETE FROM action_gate_decision_reference",
    /immutable/i);
  await expectDatabaseError(connectionString,
    "UPDATE gate_review_invitation_attempt SET error_message = error_message WHERE status <> 'dispatching'",
    /immutable/i);
  await expectDatabaseError(connectionString,
    "DELETE FROM project_action_update WHERE action_id = (SELECT id FROM project_action ORDER BY sequence LIMIT 1)",
    /immutable/i);
  await expectDatabaseError(
    connectionString,
    `INSERT INTO deliverable_criterion (deliverable_id, criterion_id, gate_id, sequence)
     SELECT id, 'missing-criterion', gate_id, 999 FROM deliverable LIMIT 1`,
    /foreign key|violates/i,
  );
}

async function expectDatabaseError(connectionString, sql, pattern) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(() => client.query(sql), pattern);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

async function tableCount(connectionString, table) {
  if (!OPERATIONAL_TABLES.includes(table)) throw new Error("Unknown table.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`SELECT count(*)::integer AS count FROM "${table}"`);
    return result.rows[0].count;
  } finally {
    await client.end();
  }
}

async function countEmptyJsonChangeArrays(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT count(*)::integer AS count FROM project_action_update WHERE changes = '[]'::jsonb",
    );
    return result.rows[0].count;
  } finally {
    await client.end();
  }
}
