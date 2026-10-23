import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const testTenantId = "10000000-0000-4000-8000-000000000001";
const testOwnerUserId = "20000000-0000-4000-8000-000000000001";
const testOwnerObjectId = "30000000-0000-4000-8000-000000000001";
const testEditorUserId = "20000000-0000-4000-8000-000000000002";
const testViewerUserId = "20000000-0000-4000-8000-000000000003";
const testOutsiderUserId = "20000000-0000-4000-8000-000000000004";
const testExternalUserId = "20000000-0000-4000-8000-000000000005";

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
  for (const [connectionString, databaseName] of [
    [databaseUrlA, databaseNameA],
    [databaseUrlB, databaseNameB],
  ]) {
    await clearExistingDisposableOperationalData(connectionString, databaseName);
    const first = await runMigrations({ connectionString, migrationsDirectory, logger: silentLogger });
    const second = await runMigrations({ connectionString, migrationsDirectory, logger: silentLogger });
    assert.ok(first.every((migration) => migration.state === "applied"));
    assert.ok(second.every((migration) => migration.state === "applied"));
    await grantImporterPrivileges(connectionString, importerRole);
    await seedTestIdentity(connectionString);
  }
  await verifyBinaryApplicabilityMigration(
    databaseUrlA,
    path.join(migrationsDirectory, "011_binary_applicability.sql"),
  );
  await verifyApplicabilityDeliverableRenameMigration(
    databaseUrlA,
    path.join(
      migrationsDirectory,
      "012_rename_project_applicability_matrix_deliverable.sql",
    ),
  );
  await verifyPackageApplicabilityMatrixMigration(
    databaseUrlA,
    path.join(migrationsDirectory, "013_package_applicability_matrix_deliverable.sql"),
  );
  await verifyDeliverablesOnlyMigration(
    databaseUrlA,
    path.join(migrationsDirectory, "015_deliverables_only_methodology.sql"),
  );
  await verifyProjectSiteOrganizationEhsMigration(
    databaseUrlA,
    path.join(migrationsDirectory, "018_add_project_site_organization_ehs_plan.sql"),
  );
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
  const ownerRows = source.data.projects.map((project) => ({
    project_id: project.id,
    user_id: testOwnerUserId,
    role: "owner",
  }));
  const rows = buildRelationalRows(source.data, ownerRows);
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
  process.env.MICROSOFT_TENANT_ID = testTenantId;
  process.env.GATE_REVIEW_OTP_SECRET = "integration-test-gate-review-otp-secret-0001";
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
  const gateRules = await import("../src/lib/gates.ts");
  const previousBackend = process.env.OPERATIONAL_DATA_BACKEND;
  let otpDeliverySequence = 0;
  const issueOtpSession = async (reviewAccessId) => {
    const challenge = await runtime.claimGateReviewOtpChallenge(reviewAccessId);
    assert.equal(challenge.outcome, "created");
    otpDeliverySequence += 1;
    assert.equal(await runtime.completeGateReviewOtpDelivery(challenge.challengeId, {
      status: "sent",
      providerMessageId: `otp-integration-${otpDeliverySequence}`,
    }), true);
    const verification = await runtime.verifyGateReviewOtp(reviewAccessId, challenge.code);
    assert.equal(verification.outcome, "verified");
    return { challenge, verification };
  };

  try {
    delete process.env.OPERATIONAL_DATA_BACKEND;
    assert.equal(backend.getOperationalDataBackend(), "json");
    process.env.OPERATIONAL_DATA_BACKEND = "unsupported";
    assert.throws(() => backend.getOperationalDataBackend(), /must be exactly/);
    process.env.OPERATIONAL_DATA_BACKEND = "postgres";

    const expectedProjects = source.projects.map(withInactiveLegacyCriteria).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt));
    assert.deepEqual(await projectFacade.getProjects(), expectedProjects);
    for (const project of source.projects) {
      const expectedPackages = source.packages
        .filter((projectPackage) => projectPackage.projectId === project.id)
        .map(withInactiveLegacyCriteria)
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
    }, testOwnerUserId);
    assert.equal(project.plannedStartDate, "2026-01-15");
    assert.equal(project.plannedCompletionDate, "2026-12-15");
    await assert.rejects(
      () => runtime.deleteProjectMembership(project.id, testOwnerUserId),
      /active Owner/,
    );
    assert.equal(
      (await runtime.upsertProjectMembership(project.id, testEditorUserId, "editor"))?.role,
      "editor",
    );
    assert.equal(
      (await runtime.upsertProjectMembership(project.id, testViewerUserId, "viewer"))?.role,
      "viewer",
    );
    assert.equal(
      await runtime.upsertProjectMembership(project.id, testExternalUserId, "viewer"),
      null,
    );
    assert.ok((await runtime.getProjects(testViewerUserId)).some((item) => item.id === project.id));
    assert.equal(
      (await runtime.getProjects(testOutsiderUserId)).some((item) => item.id === project.id),
      false,
    );
    assert.equal(
      (await runtime.upsertProjectMembership(project.id, testEditorUserId, "owner"))?.role,
      "owner",
    );
    assert.equal(
      (await runtime.upsertProjectMembership(project.id, testOwnerUserId, "editor"))?.role,
      "editor",
    );

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
    const authenticatedActor = {
      id: testOwnerUserId,
      displayName: "Integration Test Owner",
      email: "integration-owner@example.invalid",
      normalizedEmail: "integration-owner@example.invalid",
      organizationId: null,
      status: "active",
      accessClass: "internal",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastAuthenticatedAt: new Date(0),
      providerTenantId: testTenantId,
      providerObjectId: testOwnerObjectId,
    };
    const authenticatedEditorActor = {
      ...authenticatedActor,
      id: testEditorUserId,
      displayName: "Integration Test Editor",
      email: "integration-editor@example.invalid",
      normalizedEmail: "integration-editor@example.invalid",
      providerObjectId: "30000000-0000-4000-8000-000000000002",
    };
    const withdrawalActor = {
      userId: authenticatedEditorActor.id,
      displayName: authenticatedEditorActor.displayName,
      email: authenticatedEditorActor.email,
      providerTenantId: authenticatedEditorActor.providerTenantId,
      providerObjectId: authenticatedEditorActor.providerObjectId,
    };
    const unauthorizedWithdrawalActor = {
      userId: authenticatedActor.id,
      displayName: authenticatedActor.displayName,
      email: authenticatedActor.email,
      providerTenantId: authenticatedActor.providerTenantId,
      providerObjectId: authenticatedActor.providerObjectId,
    };
    const projectApplicabilityReview = await runtime.getApplicabilityReview(project.id, null);
    assert.ok(projectApplicabilityReview);
    assert.ok(projectApplicabilityReview.gates.every((reviewGate) =>
      reviewGate.gate.criteria.length === 0));
    assert.ok(projectApplicabilityReview.gates.every((reviewGate) =>
      reviewGate.deliverables.every((item) => item.applicability === "applicable")));
    const initialProjectMatrixReview = await runtime.getGateMatrixReview(
      project.id,
      null,
      currentGate.id,
    );
    assert.equal(initialProjectMatrixReview.state.target.targetStageId, "definition_design");
    assert.equal(initialProjectMatrixReview.state.effectiveStatus, "not_confirmed");
    assert.ok(initialProjectMatrixReview.matrix.gates
      .find((matrixGate) => matrixGate.stageId === "definition_design")
      ?.items.some((item) => item.templateId === "project_site_organization_ehs_plan"));
    assert.equal(
      (await runtime.confirmGateMatrixReview(
        project.id,
        null,
        currentGate.id,
        authenticatedActor,
      )).effectiveStatus,
      "confirmed",
    );
    const definitionGateForCustomDeliverable = projectApplicabilityReview.gates.find(
      (reviewGate) => reviewGate.gate.stageId === "definition_design",
    )?.gate;
    assert.ok(definitionGateForCustomDeliverable);
    const descriptionFreeCustomDeliverableId = await runtime.createApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: definitionGateForCustomDeliverable.id,
      itemType: "deliverable",
      title: "Description-free custom Deliverable",
    }, authenticatedActor);
    assert.ok(descriptionFreeCustomDeliverableId);
    const reviewWithCustomDeliverable = await runtime.getApplicabilityReview(project.id, null);
    assert.equal(
      reviewWithCustomDeliverable.gates
        .flatMap((reviewGate) => reviewGate.deliverables)
        .find((deliverable) => deliverable.id === descriptionFreeCustomDeliverableId)
        ?.description,
      "",
    );
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, currentGate.id))
        .state.effectiveStatus,
      "outdated",
    );
    assert.equal(await runtime.deleteApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: definitionGateForCustomDeliverable.id,
      itemType: "deliverable",
      itemId: descriptionFreeCustomDeliverableId,
    }), true);
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, currentGate.id))
        .state.effectiveStatus,
      "confirmed",
    );
    const deliveryGateForMatrixReview = currentProject.gates.find(
      (candidate) => candidate.stageId === "delivery",
    );
    const closureGateForMatrixReview = currentProject.gates.find(
      (candidate) => candidate.stageId === "closure",
    );
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, deliveryGateForMatrixReview.id))
        .state.target.targetStageId,
      "closure",
    );
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, closureGateForMatrixReview.id))
        .state.target.reviewScope,
      "final_lifecycle",
    );
    const currentProjectDeliverables = await deliverableFacade.getGateDeliverables(
      project.id,
      null,
      currentGate.id,
    );
    const currentProjectActions = await actionFacade.getGateActions(project.id, currentGate.id);
    const expectedProjectReadiness = gateRules.getGateSubmissionIssues(
      currentGate,
      currentProjectDeliverables,
      currentProjectActions,
      {
        scopeLabel: "Project",
        items: projectApplicabilityReview.gates.flatMap((reviewGate) =>
          reviewGate.deliverables),
      },
    );
    const incompleteProjectSubmission = await projectFacade.submitProjectGateForApproval(
      project.id,
      currentGate.id,
    );
    assert.equal(incompleteProjectSubmission?.outcome, "blocked");
    assert.deepEqual(incompleteProjectSubmission.issues, expectedProjectReadiness);
    assert.ok(incompleteProjectSubmission.issues.some(
      (issue) => issue.code === "incomplete_deliverables",
    ));
    assert.ok(!incompleteProjectSubmission.issues.some(
      (issue) => issue.code === "unresolved_applicability",
    ));
    const projectNotApplicableItem = projectApplicabilityReview.gates
      .find((reviewGate) => reviewGate.gate.stageId === "definition_design")
      ?.deliverables.find((deliverable) =>
        deliverable.applicability === "applicable" && !deliverable.applicabilityLocked);
    assert.ok(projectNotApplicableItem);
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: null,
        gateId: projectApplicabilityReview.gates.find((reviewGate) =>
          reviewGate.deliverables.some((deliverable) => deliverable.id === projectNotApplicableItem.id)).gate.id,
        itemType: "deliverable",
        itemId: projectNotApplicableItem.id,
        applicability: "not_applicable",
        justification: "",
      }, authenticatedActor),
      /justification is required/,
    );
    const projectNotApplicableGate = projectApplicabilityReview.gates.find((reviewGate) =>
      reviewGate.deliverables.some((deliverable) => deliverable.id === projectNotApplicableItem.id));
    assert.ok(projectNotApplicableGate);
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: projectNotApplicableGate.gate.id,
      itemType: "deliverable",
      itemId: projectNotApplicableItem.id,
      applicability: "not_applicable",
      justification: "Not required for this Project scope.",
    }, authenticatedActor));
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, currentGate.id))
        .state.effectiveStatus,
      "outdated",
    );
    const customDeliverable = await deliverableFacade.createDeliverable({
      projectId: project.id,
      packageId: null,
      gateId: currentGate.id,
      criterionIds: [],
      title: "Runtime Deliverable",
      description: "",
      status: "in_progress",
      stageId: currentGate.stageId,
      scopeLevel: "project",
    });
    assert.deepEqual(customDeliverable.criterionIds, []);
    assert.equal(customDeliverable.applicability, "applicable");
    assert.equal(customDeliverable.description, "");
    assert.equal(
      (await deliverableFacade.updateDeliverable(customDeliverable.id, {
        ...customDeliverable,
        criterionIds: [],
        title: "Updated Runtime Deliverable",
        status: "completed",
      }))?.title,
      "Updated Runtime Deliverable",
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
    const secondGateAction = await actionFacade.createGateProjectAction(
      project.id,
      currentGate.id,
      [],
      false,
      {
        description: "Second frozen Gate Action",
        assignee: "Integration Test",
        dueDate: "2026-08-15",
        priority: "medium",
        initialUpdate: null,
      },
      actionActor,
    );
    const deliverables = await deliverableFacade.getGateDeliverables(
      project.id,
      null,
      currentGate.id,
    );
    const completionPreservationDeliverable = deliverables.find(
      (deliverable) => !deliverable.applicabilityLocked,
    );
    assert.ok(completionPreservationDeliverable);
    const preservedAcceptanceMetadata = completionPreservationDeliverable.description;
    assert.ok(await deliverableFacade.updateDeliverable(
      completionPreservationDeliverable.id,
      { ...completionPreservationDeliverable, description: "", status: "in_progress" },
    ));
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: currentGate.id,
      itemType: "deliverable",
      itemId: completionPreservationDeliverable.id,
      applicability: "not_applicable",
      justification: "Temporarily excluded to verify completion preservation.",
    }, authenticatedActor));
    let preservedDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      null,
      currentGate.id,
    )).find((deliverable) => deliverable.id === completionPreservationDeliverable.id);
    assert.equal(preservedDeliverable.status, "in_progress");
    assert.equal(preservedDeliverable.description, preservedAcceptanceMetadata);
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: currentGate.id,
      itemType: "deliverable",
      itemId: completionPreservationDeliverable.id,
      applicability: "applicable",
      justification: "",
    }, authenticatedActor));
    preservedDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      null,
      currentGate.id,
    )).find((deliverable) => deliverable.id === completionPreservationDeliverable.id);
    assert.equal(preservedDeliverable.status, "in_progress");
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
        name: "Contact-only Project Approver",
        email: "project-approver@example.invalid",
        organizationName: null,
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
          name: approver.name,
          email: approver.email,
          organizationName: "Independent Assurance",
          roleFunction: approver.roleFunction,
          approvalRole: "Executive Approver",
          approvalLevel: 1,
        },
      ))?.approvalRole,
      "Executive Approver",
    );
    assert.equal(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).approvers
        .find((candidate) => candidate.id === approver.id).approvalLevel,
      1,
    );
    assert.equal(
      (await projectFacade.updateProjectGateApprover(
        project.id,
        currentGate.id,
        approver.id,
        {
          name: "Updated Contact-only Approver",
          email: "updated-project-approver@example.invalid",
          organizationName: "Independent Assurance",
          roleFunction: approver.roleFunction,
          approvalRole: "Executive Approver",
          approvalLevel: 1,
        },
      ))?.email,
      "updated-project-approver@example.invalid",
    );
    const secondApprover = await projectFacade.createProjectGateApprover(
      project.id,
      currentGate.id,
      {
        name: "Second Contact-only Approver",
        email: "second-project-approver@example.invalid",
        organizationName: "Project Board",
        roleFunction: "Project Board",
        approvalRole: "Second Approver",
        approvalLevel: 2,
      },
    );
    assert.ok(secondApprover);

    const reconfirmedProjectMatrix = await runtime.confirmGateMatrixReview(
      project.id,
      null,
      currentGate.id,
      authenticatedEditorActor,
    );
    assert.equal(reconfirmedProjectMatrix.effectiveStatus, "confirmed");
    const targetCompletionUpdate = await deliverableFacade.updateDeliverable(
      projectNotApplicableItem.id,
      { ...projectNotApplicableItem, status: "completed" },
    );
    assert.ok(targetCompletionUpdate);
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, currentGate.id))
        .state.effectiveStatus,
      "confirmed",
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
    assert.equal(cycle.schemaVersion, 7);
    assert.deepEqual(cycle.frozenEvidence.criteria, []);
    assert.equal(cycle.frozenEvidence.matrixReviewConfirmation?.targetStageId,
      "definition_design");
    assert.equal(cycle.frozenEvidence.matrixReviewConfirmation?.reviewer.userId,
      authenticatedEditorActor.id);
    assert.ok(cycle.approvers.every(
      (candidate) => candidate.authenticationMethod === "email_otp"
        && /^[0-9a-f-]{36}$/i.test(candidate.reviewAccessId)
        && candidate.assignedUserId == null
        && candidate.expectedProviderTenantId == null
        && candidate.expectedProviderObjectId == null,
    ));
    assert.equal(
      new Set(cycle.approvers.map((candidate) => candidate.reviewAccessId)).size,
      cycle.approvers.length,
    );
    assert.equal(
      await projectFacade.updateProjectGateApprover(
        project.id,
        currentGate.id,
        approver.id,
        {
          name: "Frozen change must fail",
          email: "frozen-change@example.invalid",
          organizationName: null,
          roleFunction: approver.roleFunction,
          approvalRole: approver.approvalRole,
          approvalLevel: approver.approvalLevel,
        },
      ),
      null,
    );
    assert.equal(cycle.frozenEvidence.acceptedActions[0].actionId, gateAction.id);
    assert.equal(cycle.frozenEvidence.acceptedActions[1].actionId, secondGateAction.id);
    assert.equal(cycle.frozenEvidence.applicabilityMatrix?.scopeLevel, "project");
    assert.equal(
      cycle.frozenEvidence.applicabilityMatrix?.gates
        .flatMap((matrixGate) => matrixGate.items)
        .find((item) => item.itemId === projectNotApplicableItem.id)?.applicability,
      "not_applicable",
    );

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
    const firstOtpApprover = cycle.approvers.find(
      (candidate) => candidate.gateApproverId === approver.id,
    );
    const secondOtpApprover = cycle.approvers.find(
      (candidate) => candidate.gateApproverId === secondApprover.id,
    );
    assert.ok(firstOtpApprover?.reviewAccessId);
    assert.ok(secondOtpApprover?.reviewAccessId);
    const firstOtpAccess = await runtime.getGateReviewOtpAccess(firstOtpApprover.reviewAccessId);
    assert.equal(firstOtpAccess?.cycleStatus, "awaiting_approval");
    assert.equal(firstOtpAccess?.canRequestCode, true);
    assert.match(firstOtpAccess?.maskedEmail ?? "", /^up•+@example\.invalid$/);
    assert.doesNotMatch(firstOtpAccess?.maskedEmail ?? "", /updated-project-approver/);
    assert.deepEqual(await runtime.claimGateReviewOtpChallenge(secondOtpApprover.reviewAccessId), {
      outcome: "unavailable",
    });
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

    const firstChallenge = await runtime.claimGateReviewOtpChallenge(
      firstOtpApprover.reviewAccessId,
    );
    assert.equal(firstChallenge.outcome, "created");
    const otpStorageClient = new Client({ connectionString });
    await otpStorageClient.connect();
    try {
      const storedChallenge = await otpStorageClient.query(
        `SELECT code_digest, requested_at, expires_at
         FROM gate_review_otp_challenge WHERE id = $1`,
        [firstChallenge.challengeId],
      );
      assert.match(storedChallenge.rows[0].code_digest, /^[0-9a-f]{64}$/);
      assert.notEqual(storedChallenge.rows[0].code_digest, firstChallenge.code);
      assert.equal(
        new Date(storedChallenge.rows[0].expires_at).getTime()
          - new Date(storedChallenge.rows[0].requested_at).getTime(),
        10 * 60_000,
      );
    } finally {
      await otpStorageClient.end();
    }
    assert.equal(await runtime.completeGateReviewOtpDelivery(firstChallenge.challengeId, {
      status: "sent",
      providerMessageId: "otp-project-first",
    }), true);
    assert.deepEqual(
      await runtime.claimGateReviewOtpChallenge(firstOtpApprover.reviewAccessId),
      { outcome: "rate_limited" },
    );
    const invalidFirstCode = firstChallenge.code === "000000" ? "000001" : "000000";
    assert.deepEqual(
      await runtime.verifyGateReviewOtp(firstOtpApprover.reviewAccessId, invalidFirstCode),
      { outcome: "invalid_code" },
    );
    const firstVerification = await runtime.verifyGateReviewOtp(
      firstOtpApprover.reviewAccessId,
      firstChallenge.code,
    );
    assert.equal(firstVerification.outcome, "verified");
    const sessionStorageClient = new Client({ connectionString });
    await sessionStorageClient.connect();
    try {
      const storedSession = await sessionStorageClient.query(
        `SELECT token_hash, created_at, expires_at
         FROM gate_review_session WHERE otp_challenge_id = $1`,
        [firstChallenge.challengeId],
      );
      assert.equal(storedSession.rowCount, 1);
      assert.match(storedSession.rows[0].token_hash, /^[0-9a-f]{64}$/);
      assert.notEqual(storedSession.rows[0].token_hash, firstVerification.sessionToken);
      assert.equal(
        new Date(storedSession.rows[0].expires_at).getTime()
          - new Date(storedSession.rows[0].created_at).getTime(),
        30 * 60_000,
      );
      await assert.rejects(
        () => sessionStorageClient.query(
          "UPDATE gate_review_session SET expires_at = expires_at WHERE otp_challenge_id = $1",
          [firstChallenge.challengeId],
        ),
        /immutable/,
      );
    } finally {
      await sessionStorageClient.end();
    }
    assert.equal(
      await runtime.getOtpAssignedGateReview(
        secondOtpApprover.reviewAccessId,
        firstVerification.sessionToken,
      ),
      null,
    );
    assert.equal(
      (await runtime.getOtpAssignedGateReview(
        firstOtpApprover.reviewAccessId,
        firstVerification.sessionToken,
      ))?.assignedApprover.gateApproverId,
      approver.id,
    );
    assert.deepEqual(
      await runtime.verifyGateReviewOtp(firstOtpApprover.reviewAccessId, firstChallenge.code),
      { outcome: "unavailable" },
    );

    const firstOtpResponse = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: firstOtpApprover.reviewAccessId,
      sessionToken: firstVerification.sessionToken,
      outcome: "approved",
      comment: "OTP-authenticated first-level approval.",
    });
    assert.equal(firstOtpResponse?.outcome, "recorded");
    assert.equal(firstOtpResponse.completion, "pending");
    assert.deepEqual(firstOtpResponse.activatedApproverIds, [secondApprover.id]);
    assert.equal(
      firstOtpResponse.reviewCycle.approvers.find(
        (candidate) => candidate.gateApproverId === approver.id,
      )?.response?.respondedBy.authenticationMethod,
      "email_otp",
    );

    const secondSession = await issueOtpSession(secondOtpApprover.reviewAccessId);
    const partialFrozenEvidence = structuredClone(firstOtpResponse.reviewCycle.frozenEvidence);
    const partialApproverHistory = structuredClone(firstOtpResponse.reviewCycle.approvers);

    await assert.rejects(
      () => projectFacade.withdrawProjectGateSubmission(
        project.id,
        currentGate.id,
        "   ",
        withdrawalActor,
      ),
      /withdrawal reason is required/i,
    );
    await assert.rejects(
      () => projectFacade.withdrawProjectGateSubmission(
        project.id,
        currentGate.id,
        "An editor must not be able to withdraw.",
        unauthorizedWithdrawalActor,
      ),
      /only an authenticated Project Owner/i,
    );
    const withdrawal = await projectFacade.withdrawProjectGateSubmission(
      project.id,
      currentGate.id,
      "Project scope changed after the first OTP approval.",
      withdrawalActor,
    );
    assert.equal(withdrawal?.outcome, "withdrawn");
    assert.equal(withdrawal.reviewCycle.withdrawalReason, "Project scope changed after the first OTP approval.");
    assert.equal(withdrawal.reviewCycle.withdrawnBy.userId, testEditorUserId);
    assert.deepEqual(withdrawal.reviewCycle.frozenEvidence, partialFrozenEvidence);
    assert.deepEqual(withdrawal.reviewCycle.approvers, partialApproverHistory);
    assert.deepEqual(
      await runtime.claimGateReviewOtpChallenge(secondOtpApprover.reviewAccessId),
      { outcome: "unavailable" },
    );
    assert.deepEqual(
      await runtime.verifyGateReviewOtp(secondOtpApprover.reviewAccessId, secondSession.challenge.code),
      { outcome: "unavailable" },
    );
    assert.equal((await runtime.recordOtpGateReviewResponse({
      reviewAccessId: secondOtpApprover.reviewAccessId,
      sessionToken: secondSession.verification.sessionToken,
      outcome: "approved",
      comment: "Must not be accepted after withdrawal.",
    }))?.outcome, "not_submitted");
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, null, currentGate.id))
        .state.effectiveStatus,
      "confirmed",
    );

    const resubmission = await projectFacade.submitProjectGateForApproval(
      project.id,
      currentGate.id,
    );
    assert.equal(resubmission?.outcome, "submitted");
    assert.equal(resubmission.reviewCycle.cycleNumber, 2);
    assert.equal(resubmission.reviewCycle.previousCycleId, cycle.id);
    assert.ok(resubmission.reviewCycle.approvers.every((candidate) => candidate.response === null));
    assert.ok(resubmission.reviewCycle.approvers.every((candidate) =>
      !cycle.approvers.some((previous) => previous.reviewAccessId === candidate.reviewAccessId)));
    const resubmittedFirst = resubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === approver.id,
    );
    const resubmittedSecond = resubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === secondApprover.id,
    );
    assert.ok(resubmittedFirst?.reviewAccessId);
    assert.ok(resubmittedSecond?.reviewAccessId);
    const resubmittedFirstSession = await issueOtpSession(resubmittedFirst.reviewAccessId);
    const firstFinalResponse = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: resubmittedFirst.reviewAccessId,
      sessionToken: resubmittedFirstSession.verification.sessionToken,
      outcome: "approved",
      comment: "Approval for the new OTP Review Cycle only.",
    });
    assert.equal(firstFinalResponse?.outcome, "recorded");
    assert.equal(firstFinalResponse.completion, "pending");
    const resubmittedSecondSession = await issueOtpSession(resubmittedSecond.reviewAccessId);
    const finalApprovalAttempt = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: resubmittedSecond.reviewAccessId,
      sessionToken: resubmittedSecondSession.verification.sessionToken,
      outcome: "approved",
      comment: "Final OTP-authenticated approval.",
    });
    assert.equal(finalApprovalAttempt?.outcome, "recorded");
    assert.equal(finalApprovalAttempt.completion, "approved_with_actions");
    const approvedSubmission = resubmission;
    const projectStageAfterApproval = finalApprovalAttempt.entity.currentStage;
    const projectFrozenActions = structuredClone(
      finalApprovalAttempt.reviewCycle.frozenEvidence.acceptedActions,
    );
    assert.equal(
      finalApprovalAttempt.entity.gates.find((gate) => gate.id === currentGate.id)?.status,
      "approved_with_actions",
    );
    const approvedGateAction = await actionFacade.getProjectAction(project.id, gateAction.id);
    const approvedReference = approvedGateAction.gateDecisionReferences.find(
      (reference) => reference.reviewCycleId === approvedSubmission.reviewCycle.id,
    );
    assert.deepEqual(approvedReference.approvalSnapshot, {
      sequence: gateAction.sequence,
      description: "Frozen Gate Action",
      assignee: "Integration Test",
      dueDate: "2026-08-01",
      status: "new",
    });
    const finalizedDeletion = await actionFacade.deleteProjectAction(project.id, gateAction.id);
    assert.equal(finalizedDeletion.deleted, false);
    assert.match(finalizedDeletion.reason, /finalized Gate decision/);

    const finishedGateAction = await actionFacade.updateProjectAction(
      project.id,
      gateAction.id,
      {
        description: "Live Gate Action description changed after approval",
        assignee: gateAction.assignee,
        dueDate: gateAction.dueDate,
        status: "finished",
        priority: gateAction.priority,
        packageIds: gateAction.packageIds,
        governanceTierId: gateAction.governanceTierId,
        gateId: gateAction.gateId,
        initialUpdate: null,
      },
      actionActor,
    );
    assert.equal(finishedGateAction.status, "finished");
    assert.equal(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).status,
      "approved_with_actions",
    );
    const unrelatedAction = await actionFacade.createManualProjectAction(
      project.id,
      {
        description: "Unrelated post-approval Action",
        assignee: "Integration Test",
        dueDate: "2026-09-01",
        status: "new",
        priority: "low",
        packageIds: [],
        governanceTierId: null,
        gateId: null,
        initialUpdate: null,
      },
      actionActor,
    );
    await actionFacade.closeProjectAction(
      project.id,
      unrelatedAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    assert.equal(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).status,
      "approved_with_actions",
    );
    await actionFacade.closeProjectAction(
      project.id,
      gateAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    assert.equal(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).status,
      "approved_with_actions",
    );
    await actionFacade.closeProjectAction(
      project.id,
      secondGateAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    let reconciledProject = await projectFacade.getProject(project.id);
    assert.equal(
      reconciledProject.gates.find((gate) => gate.id === currentGate.id).status,
      "approved",
    );
    assert.equal(reconciledProject.currentStage, projectStageAfterApproval);
    let reconciledProjectCycle = reconciledProject.gates
      .find((gate) => gate.id === currentGate.id).reviewCycles
      .find((reviewCycle) => reviewCycle.id === approvedSubmission.reviewCycle.id);
    assert.equal(reconciledProjectCycle.decision, "approved_with_actions");
    assert.equal(reconciledProjectCycle.status, "approved_with_actions");
    assert.deepEqual(reconciledProjectCycle.frozenEvidence.acceptedActions, projectFrozenActions);

    await actionFacade.reopenProjectAction(
      project.id,
      gateAction.id,
      "in_progress",
      actionActor,
      null,
      authenticatedActor,
    );
    assert.equal(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).status,
      "approved_with_actions",
    );
    await actionFacade.closeProjectAction(
      project.id,
      gateAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    assert.equal(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).status,
      "approved",
    );
    await actionFacade.reopenProjectAction(
      project.id,
      gateAction.id,
      "new",
      actionActor,
      null,
      authenticatedActor,
    );
    await actionFacade.reopenProjectAction(
      project.id,
      secondGateAction.id,
      "new",
      actionActor,
      null,
      authenticatedActor,
    );
    await Promise.all([
      actionFacade.closeProjectAction(
        project.id,
        gateAction.id,
        actionActor,
        null,
        authenticatedActor,
      ),
      actionFacade.closeProjectAction(
        project.id,
        secondGateAction.id,
        actionActor,
        null,
        authenticatedActor,
      ),
    ]);
    reconciledProject = await projectFacade.getProject(project.id);
    assert.equal(
      reconciledProject.gates.find((gate) => gate.id === currentGate.id).status,
      "approved",
    );
    assert.equal(reconciledProject.currentStage, projectStageAfterApproval);
    reconciledProjectCycle = reconciledProject.gates
      .find((gate) => gate.id === currentGate.id).reviewCycles
      .find((reviewCycle) => reviewCycle.id === approvedSubmission.reviewCycle.id);
    assert.deepEqual(reconciledProjectCycle.frozenEvidence.acceptedActions, projectFrozenActions);
    const reconciliationAudits = (await runtime.getProjectAuditEvents(project.id)).filter(
      (event) => event.eventType === "gate.follow_up_status_reconciled"
        && event.resourceId === currentGate.id,
    );
    assert.equal(reconciliationAudits.length, 5);
    assert.ok(reconciliationAudits.every(
      (event) => event.actorUserId === authenticatedActor.id
        && event.metadata.reviewCycleId === approvedSubmission.reviewCycle.id,
    ));
    const reviewAuditEvents = (await runtime.getProjectAuditEvents(project.id)).filter(
      (event) => event.eventType === "gate_review.responded"
        && event.resourceId === approvedSubmission.reviewCycle.id,
    );
    assert.equal(reviewAuditEvents.length, 2);
    assert.ok(reviewAuditEvents.every((event) => event.actorUserId === null));
    assert.ok(reviewAuditEvents.every(
      (event) => event.metadata.authenticationMethod === "email_otp"
        && typeof event.metadata.reviewSessionId === "string",
    ));
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: projectNotApplicableGate.gate.id,
      itemType: "deliverable",
      itemId: projectNotApplicableItem.id,
      applicability: "applicable",
      justification: "",
    }, authenticatedActor));
    const changedProjectReview = await runtime.getApplicabilityReview(project.id, null);
    assert.equal(
      changedProjectReview.changes.find((change) =>
        change.itemId === projectNotApplicableItem.id)?.changeReason,
      null,
    );
    assert.equal(
      approvedSubmission.reviewCycle.frozenEvidence.applicabilityMatrix?.gates
        .flatMap((matrixGate) => matrixGate.items)
        .find((item) => item.itemId === projectNotApplicableItem.id)?.applicability,
      "not_applicable",
    );

    const packageBeforeSubmission = await packageFacade.getPackage(
      project.id,
      projectPackage.id,
    );
    const packageGate = packageBeforeSubmission?.gates.find(
      (gate) => gate.stageId === packageBeforeSubmission.currentStage,
    );
    assert.ok(packageGate);
    const packageApplicabilityReview = await runtime.getApplicabilityReview(
      project.id,
      projectPackage.id,
    );
    assert.ok(packageApplicabilityReview);
    assert.ok(packageApplicabilityReview.gates.every((reviewGate) =>
      reviewGate.gate.criteria.length === 0));
    assert.ok(packageApplicabilityReview.gates.every((reviewGate) =>
      reviewGate.deliverables.every((item) => item.applicability === "applicable")));
    const initialPackageMatrixReview = await runtime.getGateMatrixReview(
      project.id,
      projectPackage.id,
      packageGate.id,
    );
    assert.equal(initialPackageMatrixReview.state.target.targetStageId, "tendering");
    assert.equal(
      (await runtime.confirmGateMatrixReview(
        project.id,
        projectPackage.id,
        packageGate.id,
        authenticatedActor,
      )).effectiveStatus,
      "confirmed",
    );
    const packageClosureGate = packageBeforeSubmission.gates.find(
      (candidate) => candidate.stageId === "closure",
    );
    assert.equal(
      (await runtime.getGateMatrixReview(
        project.id,
        projectPackage.id,
        packageClosureGate.id,
      )).state.target.reviewScope,
      "final_lifecycle",
    );
    const packageApplicabilityMatrices = packageApplicabilityReview.gates
      .flatMap((reviewGate) => reviewGate.deliverables)
      .filter((deliverable) =>
        deliverable.templateId === "package_stage_gate_applicability_matrix");
    assert.equal(packageApplicabilityMatrices.length, 1);
    assert.equal(
      packageApplicabilityMatrices[0].id,
      `${packageGate.id}:deliverable:package_stage_gate_applicability_matrix`,
    );
    assert.equal(packageApplicabilityMatrices[0].title,
      "Package Stage-Gate Deliverable Applicability Matrix");
    assert.equal(packageApplicabilityMatrices[0].status, "not_started");
    const packageDeliverablesBeforeReadiness = await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      packageGate.id,
    );
    const packageActionsBeforeReadiness = await actionFacade.getGateActions(
      project.id,
      packageGate.id,
    );
    const expectedPackageReadiness = gateRules.getGateSubmissionIssues(
      packageGate,
      packageDeliverablesBeforeReadiness,
      packageActionsBeforeReadiness,
      {
        scopeLabel: "Package",
        items: packageApplicabilityReview.gates.flatMap((reviewGate) =>
          reviewGate.deliverables),
      },
    );
    const incompletePackageSubmission = await packageFacade.submitPackageGateForApproval(
      project.id,
      projectPackage.id,
      packageGate.id,
    );
    assert.equal(incompletePackageSubmission?.outcome, "blocked");
    assert.deepEqual(incompletePackageSubmission.issues, expectedPackageReadiness);
    assert.ok(!incompletePackageSubmission.issues.some(
      (issue) => issue.code === "unresolved_applicability",
    ));
    const packageNotApplicableItem = packageApplicabilityReview.gates
      .find((reviewGate) => reviewGate.gate.stageId === "execution")
      ?.deliverables.find((deliverable) =>
        deliverable.applicability === "applicable" && !deliverable.applicabilityLocked);
    assert.ok(packageNotApplicableItem);
    const packageNotApplicableGate = packageApplicabilityReview.gates.find((reviewGate) =>
      reviewGate.deliverables.some((deliverable) => deliverable.id === packageNotApplicableItem.id));
    assert.ok(packageNotApplicableGate);
    assert.ok(await deliverableFacade.updateDeliverable(
      packageNotApplicableItem.id,
      { ...packageNotApplicableItem, status: "completed" },
    ));
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: packageNotApplicableGate.gate.id,
      itemType: "deliverable",
      itemId: packageNotApplicableItem.id,
      applicability: "not_applicable",
      justification: "Not required for this Package scope.",
    }, authenticatedActor));
    let preservedPackageDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      packageNotApplicableGate.gate.id,
    )).find((deliverable) => deliverable.id === packageNotApplicableItem.id);
    assert.equal(preservedPackageDeliverable.status, "completed");
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: packageNotApplicableGate.gate.id,
      itemType: "deliverable",
      itemId: packageNotApplicableItem.id,
      applicability: "applicable",
      justification: "",
    }, authenticatedActor));
    preservedPackageDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      packageNotApplicableGate.gate.id,
    )).find((deliverable) => deliverable.id === packageNotApplicableItem.id);
    assert.equal(preservedPackageDeliverable.status, "completed");
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: packageNotApplicableGate.gate.id,
      itemType: "deliverable",
      itemId: packageNotApplicableItem.id,
      applicability: "not_applicable",
      justification: "Not required for this Package scope.",
    }, authenticatedActor));
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
        name: "Package Contact Approver",
        email: "package-approver@example.invalid",
        organizationName: "Equipment Supplier",
        roleFunction: "Package Sponsor",
        approvalRole: "Approver",
        approvalLevel: 1,
      },
    );
    assert.ok(packageApprover);
    const packageSecondApprover = await packageFacade.createPackageGateApprover(
      project.id,
      projectPackage.id,
      packageGate.id,
      {
        name: "Package Second Approver",
        email: "package-second-approver@example.invalid",
        organizationName: null,
        roleFunction: "Package Engineering",
        approvalRole: "Second-level Approver",
        approvalLevel: 2,
      },
    );
    assert.ok(packageSecondApprover);
    const packageLockedApprover = await packageFacade.createPackageGateApprover(
      project.id,
      projectPackage.id,
      packageGate.id,
      {
        name: "Package Locked-code Approver",
        email: "package-locked@example.invalid",
        organizationName: null,
        roleFunction: "Package Quality",
        approvalRole: "Second-level Quality Approver",
        approvalLevel: 2,
      },
    );
    assert.ok(packageLockedApprover);
    const packageHourlyLimitedApprover = await packageFacade.createPackageGateApprover(
      project.id,
      projectPackage.id,
      packageGate.id,
      {
        name: "Package Rate-limit Approver",
        email: "package-rate-limit@example.invalid",
        organizationName: null,
        roleFunction: "Package Controls",
        approvalRole: "Second-level Controls Approver",
        approvalLevel: 2,
      },
    );
    assert.ok(packageHourlyLimitedApprover);
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, projectPackage.id, packageGate.id))
        .state.effectiveStatus,
      "confirmed",
    );
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
    assert.equal(packageSubmission.reviewCycle.schemaVersion, 7);
    assert.equal(
      packageSubmission.reviewCycle.frozenEvidence.matrixReviewConfirmation?.targetStageId,
      "tendering",
    );
    assert.equal(
      packageSubmission.reviewCycle.frozenEvidence.applicabilityMatrix?.scopeLevel,
      "package",
    );
    assert.equal(
      packageSubmission.reviewCycle.frozenEvidence.applicabilityMatrix?.gates
        .flatMap((matrixGate) => matrixGate.items)
        .find((item) => item.itemId === packageNotApplicableItem.id)?.applicability,
      "not_applicable",
    );
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
    const packageFirstOtpApprover = packageSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === packageApprover.id,
    );
    const packageSecondOtpApprover = packageSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === packageSecondApprover.id,
    );
    const packageLockedOtpApprover = packageSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === packageLockedApprover.id,
    );
    const packageHourlyLimitedOtpApprover = packageSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === packageHourlyLimitedApprover.id,
    );
    assert.ok(packageFirstOtpApprover?.reviewAccessId);
    assert.ok(packageSecondOtpApprover?.reviewAccessId);
    assert.ok(packageLockedOtpApprover?.reviewAccessId);
    assert.ok(packageHourlyLimitedOtpApprover?.reviewAccessId);
    assert.ok(packageSubmission.reviewCycle.approvers.every(
      (candidate) => candidate.authenticationMethod === "email_otp",
    ));
    const packageFirstSession = await issueOtpSession(packageFirstOtpApprover.reviewAccessId);
    const packagePartialResponse = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: packageFirstOtpApprover.reviewAccessId,
      sessionToken: packageFirstSession.verification.sessionToken,
      outcome: "approved",
      comment: "Package first-level OTP approval.",
    });
    assert.equal(packagePartialResponse?.outcome, "recorded");
    assert.equal(packagePartialResponse.completion, "pending");
    assert.deepEqual(packagePartialResponse.activatedApproverIds, [
      packageSecondApprover.id,
      packageLockedApprover.id,
      packageHourlyLimitedApprover.id,
    ]);
    const packageSecondSession = await issueOtpSession(packageSecondOtpApprover.reviewAccessId);
    const lockedChallenge = await runtime.claimGateReviewOtpChallenge(
      packageLockedOtpApprover.reviewAccessId,
    );
    assert.equal(lockedChallenge.outcome, "created");
    assert.equal(await runtime.completeGateReviewOtpDelivery(lockedChallenge.challengeId, {
      status: "sent",
      providerMessageId: "otp-package-lock-test",
    }), true);
    const invalidLockedCode = lockedChallenge.code === "999999" ? "999998" : "999999";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.deepEqual(
        await runtime.verifyGateReviewOtp(
          packageLockedOtpApprover.reviewAccessId,
          invalidLockedCode,
        ),
        { outcome: attempt === 5 ? "locked" : "invalid_code" },
      );
    }
    assert.deepEqual(
      await runtime.verifyGateReviewOtp(
        packageLockedOtpApprover.reviewAccessId,
        lockedChallenge.code,
      ),
      { outcome: "locked" },
    );

    const hourlyLimitClient = new Client({ connectionString });
    await hourlyLimitClient.connect();
    try {
      for (let index = 1; index <= 5; index += 1) {
        const requestedAt = new Date(Date.now() - (index + 1) * 60_000);
        await hourlyLimitClient.query(
          `INSERT INTO gate_review_otp_challenge (
             id, review_cycle_id, gate_approver_id, sequence, code_digest,
             requested_at, expires_at, delivery_status, delivery_completed_at,
             error_code, error_message
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed', $8,
             'integration_delivery_failure', 'Expected integration delivery failure.')`,
          [
            `71000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            packageSubmission.reviewCycle.id,
            packageHourlyLimitedApprover.id,
            index,
            "0".repeat(64),
            requestedAt.toISOString(),
            new Date(requestedAt.getTime() + 10 * 60_000).toISOString(),
            new Date(requestedAt.getTime() + 1_000).toISOString(),
          ],
        );
      }
    } finally {
      await hourlyLimitClient.end();
    }
    assert.deepEqual(
      await runtime.claimGateReviewOtpChallenge(packageHourlyLimitedOtpApprover.reviewAccessId),
      { outcome: "rate_limited" },
    );
    const packageFrozenEvidence = structuredClone(packagePartialResponse.reviewCycle.frozenEvidence);
    const packageApproverHistory = structuredClone(packagePartialResponse.reviewCycle.approvers);
    const packageWithdrawal = await packageFacade.withdrawPackageGateSubmission(
      project.id,
      projectPackage.id,
      packageGate.id,
      "Package scope changed after partial approval.",
      withdrawalActor,
    );
    assert.equal(packageWithdrawal?.outcome, "withdrawn");
    assert.equal(packageWithdrawal.reviewCycle.withdrawalReason, "Package scope changed after partial approval.");
    assert.deepEqual(packageWithdrawal.reviewCycle.frozenEvidence, packageFrozenEvidence);
    assert.deepEqual(packageWithdrawal.reviewCycle.approvers, packageApproverHistory);
    assert.deepEqual(
      await runtime.claimGateReviewOtpChallenge(packageSecondOtpApprover.reviewAccessId),
      { outcome: "unavailable" },
    );
    assert.equal((await runtime.recordOtpGateReviewResponse({
      reviewAccessId: packageSecondOtpApprover.reviewAccessId,
      sessionToken: packageSecondSession.verification.sessionToken,
      outcome: "approved",
      comment: "Must not be accepted after Package withdrawal.",
    }))?.outcome, "not_submitted");
    assert.equal(
      (await runtime.getGateMatrixReview(project.id, projectPackage.id, packageGate.id))
        .state.effectiveStatus,
      "confirmed",
    );

    const packageFollowUpAction = await actionFacade.createGateProjectAction(
      project.id,
      packageGate.id,
      [projectPackage.id],
      true,
      {
        description: "Package approved follow-up Action",
        assignee: "Package Integration Test",
        dueDate: "2026-10-01",
        priority: "high",
        initialUpdate: null,
      },
      actionActor,
    );
    const packageReconciliationCycleId = randomUUID();
    const packageReconciliationFrozenEvidence = {
      frozenAt: new Date().toISOString(),
      criteria: [],
      deliverables: [],
      acceptedActions: [{
        actionId: packageFollowUpAction.id,
        sequence: packageFollowUpAction.sequence,
        description: packageFollowUpAction.description,
        assignee: packageFollowUpAction.assignee,
        dueDate: packageFollowUpAction.dueDate,
        status: packageFollowUpAction.status,
        priority: packageFollowUpAction.priority,
        packageIds: packageFollowUpAction.packageIds,
      }],
      documents: [],
      baselines: [],
      applicabilityMatrix: null,
    };
    const packageFixtureClient = new Client({ connectionString });
    await packageFixtureClient.connect();
    try {
      await packageFixtureClient.query("BEGIN");
      const recordedAt = new Date().toISOString();
      await packageFixtureClient.query(
        `INSERT INTO gate_review_cycle (
           id, gate_id, schema_version, cycle_number, previous_cycle_id,
           project_snapshot, package_snapshot, gate_snapshot, status,
           submitted_at, submitted_by, decision, decision_comments,
           completed_at, frozen_evidence
         ) VALUES ($1, $2, 5, 2, $3, $4::jsonb, $5::jsonb, $6::jsonb,
           'approved_with_actions', $7, $8::jsonb, 'approved_with_actions',
           'Package reconciliation fixture.', $7, $9::jsonb)`,
        [
          packageReconciliationCycleId,
          packageGate.id,
          packageSubmission.reviewCycle.id,
          JSON.stringify({
            id: project.id,
            projectNumber: project.projectNumber,
            name: project.name,
          }),
          JSON.stringify({
            id: projectPackage.id,
            packageCode: projectPackage.packageCode,
            name: projectPackage.packageName,
          }),
          JSON.stringify({
            id: packageGate.id,
            name: packageGate.name,
            stageId: packageGate.stageId,
            stageLabel: "Definition",
          }),
          recordedAt,
          JSON.stringify({
            userId: authenticatedActor.id,
            displayName: authenticatedActor.displayName,
            email: authenticatedActor.email,
          }),
          JSON.stringify(packageReconciliationFrozenEvidence),
        ],
      );
      await packageFixtureClient.query(
        `INSERT INTO action_gate_decision_reference (
           id, action_id, gate_id, project_id, sequence, decision, recorded_at,
           review_cycle_id, action_sequence_at_approval,
           description_at_approval, assignee_at_approval,
           due_date_at_approval, status_at_approval
         ) VALUES ($1, $2, $3, $4, 1, 'approved_with_actions', $5, $6,
           $7, $8, $9, $10::date, $11)`,
        [
          randomUUID(),
          packageFollowUpAction.id,
          packageGate.id,
          project.id,
          recordedAt,
          packageReconciliationCycleId,
          packageFollowUpAction.sequence,
          packageFollowUpAction.description,
          packageFollowUpAction.assignee,
          packageFollowUpAction.dueDate,
          packageFollowUpAction.status,
        ],
      );
      await packageFixtureClient.query(
        "UPDATE gate SET status = 'approved_with_actions' WHERE id = $1",
        [packageGate.id],
      );
      await packageFixtureClient.query(
        "UPDATE project_package SET current_stage = 'tendering' WHERE id = $1",
        [projectPackage.id],
      );
      await packageFixtureClient.query("COMMIT");
    } catch (error) {
      await packageFixtureClient.query("ROLLBACK");
      throw error;
    } finally {
      await packageFixtureClient.end();
    }

    await actionFacade.closeProjectAction(
      project.id,
      packageFollowUpAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    let reconciledPackage = await packageFacade.getPackage(project.id, projectPackage.id);
    assert.equal(
      reconciledPackage.gates.find((gate) => gate.id === packageGate.id).status,
      "approved",
    );
    assert.equal(reconciledPackage.currentStage, "tendering");
    await actionFacade.reopenProjectAction(
      project.id,
      packageFollowUpAction.id,
      "in_progress",
      actionActor,
      null,
      authenticatedActor,
    );
    reconciledPackage = await packageFacade.getPackage(project.id, projectPackage.id);
    assert.equal(
      reconciledPackage.gates.find((gate) => gate.id === packageGate.id).status,
      "approved_with_actions",
    );
    assert.equal(reconciledPackage.currentStage, "tendering");
    await actionFacade.closeProjectAction(
      project.id,
      packageFollowUpAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    reconciledPackage = await packageFacade.getPackage(project.id, projectPackage.id);
    const reconciledPackageCycle = reconciledPackage.gates
      .find((gate) => gate.id === packageGate.id).reviewCycles
      .find((reviewCycle) => reviewCycle.id === packageReconciliationCycleId);
    assert.equal(
      reconciledPackage.gates.find((gate) => gate.id === packageGate.id).status,
      "approved",
    );
    assert.equal(reconciledPackage.currentStage, "tendering");
    assert.equal(reconciledPackageCycle.decision, "approved_with_actions");
    assert.deepEqual(
      reconciledPackageCycle.frozenEvidence,
      packageReconciliationFrozenEvidence,
    );
    const packageFinalizedDeletion = await actionFacade.deleteProjectAction(
      project.id,
      packageFollowUpAction.id,
    );
    assert.equal(packageFinalizedDeletion.deleted, false);
    assert.match(packageFinalizedDeletion.reason, /finalized Gate decision/);
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

function withInactiveLegacyCriteria(scope) {
  return {
    ...scope,
    gates: scope.gates.map((gate) => ({ ...gate, criteria: [] })),
  };
}

async function clearExistingDisposableOperationalData(connectionString, expectedDatabase) {
  assert.match(expectedDatabase, /^kaizen_project_manager_migration_test_[ab]$/);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const database = await client.query("SELECT current_database() AS name");
    assert.equal(database.rows[0]?.name, expectedDatabase);
    const existing = await client.query(
      `SELECT tablename
       FROM pg_catalog.pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [OPERATIONAL_TABLES],
    );
    const tables = existing.rows.map((row) => String(row.tablename));
    if (tables.length > 0) {
      await client.query(
        `TRUNCATE TABLE ${tables.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await client.end();
  }
}

async function verifyBinaryApplicabilityMigration(connectionString, migrationPath) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      ALTER TABLE gate_criterion
        DROP CONSTRAINT gate_criterion_applicability_check,
        DROP CONSTRAINT gate_criterion_applicability_state_check,
        ALTER COLUMN applicability SET DEFAULT 'to_be_determined',
        ADD CONSTRAINT gate_criterion_applicability_check CHECK (
          applicability IN ('applicable', 'not_applicable', 'to_be_determined')
        ),
        ADD CONSTRAINT gate_criterion_applicability_state_check CHECK (
          (applicability = 'applicable' OR status = 'pending')
          AND (applicability = 'not_applicable' OR applicability_justification IS NULL)
        );
      ALTER TABLE deliverable
        DROP CONSTRAINT deliverable_applicability_check,
        DROP CONSTRAINT deliverable_applicability_state_check,
        ALTER COLUMN applicability SET DEFAULT 'to_be_determined',
        ADD CONSTRAINT deliverable_applicability_check CHECK (
          applicability IN ('applicable', 'not_applicable', 'to_be_determined')
        ),
        ADD CONSTRAINT deliverable_applicability_state_check CHECK (
          (applicability = 'applicable' OR status = 'not_started')
          AND (applicability = 'not_applicable' OR applicability_justification IS NULL)
        )
    `);
    await client.query(`
      INSERT INTO project (
        id, project_number, name, description, project_manager, customer,
        reports_to, site_location, validation_required, current_stage,
        created_at, updated_at
      ) VALUES (
        'binary-migration-project', 'MIG-011', 'Binary migration probe', '',
        'Migration test', 'Test', 'Test', 'Test', false, 'initiation', now(), now()
      );
      INSERT INTO gate (
        id, project_id, package_id, scope_level, sequence, template_version,
        name, stage_id, status
      ) VALUES (
        'binary-migration-gate', 'binary-migration-project', NULL, 'project',
        1, 1, 'Migration Gate', 'initiation', 'not_submitted'
      );
      INSERT INTO gate_criterion (
        id, gate_id, sequence, template_id, description, status, applicability,
        applicability_justification, applicability_decided_at,
        applicability_decided_by_display_name, applicability_origin
      ) VALUES
        ('binary-criterion-tbd', 'binary-migration-gate', 1, 'tbd', 'TBD criterion',
          'pending', 'to_be_determined', NULL, NULL, NULL, 'template'),
        ('binary-criterion-complete', 'binary-migration-gate', 2, 'complete', 'Complete criterion',
          'completed', 'applicable', NULL, NULL, NULL, 'template'),
        ('binary-criterion-na', 'binary-migration-gate', 3, 'na', 'N/A criterion',
          'pending', 'not_applicable', 'Historical justification', now(), 'Migration test', 'user');
      INSERT INTO deliverable (
        id, template_id, template_version, project_id, package_id, gate_id,
        sequence, title, description, status, stage_id, scope_level,
        created_at, updated_at, applicability, applicability_justification,
        applicability_decided_at, applicability_decided_by_display_name,
        applicability_origin
      ) VALUES
        ('binary-deliverable-tbd', 'tbd', 1, 'binary-migration-project', NULL,
          'binary-migration-gate', 1, 'TBD Deliverable', '', 'not_started',
          'initiation', 'project', now(), now(), 'to_be_determined', NULL, NULL, NULL, 'template'),
        ('binary-deliverable-progress', 'progress', 1, 'binary-migration-project', NULL,
          'binary-migration-gate', 2, 'In-progress Deliverable', '', 'in_progress',
          'initiation', 'project', now(), now(), 'applicable', NULL, NULL, NULL, 'template'),
        ('binary-deliverable-na', 'na', 1, 'binary-migration-project', NULL,
          'binary-migration-gate', 3, 'N/A Deliverable', '', 'not_started',
          'initiation', 'project', now(), now(), 'not_applicable',
          'Historical justification', now(), 'Migration test', 'user');
      INSERT INTO applicability_change (
        id, project_id, package_id, gate_id, item_type, item_id, template_id,
        previous_applicability, applicability, justification, change_reason,
        previous_completion_status, completion_status, changed_at,
        changed_by_display_name
      ) VALUES
        ('51000000-0000-4000-8000-000000000001', 'binary-migration-project', NULL,
          'binary-migration-gate', 'criterion', 'binary-criterion-na', 'na',
          'applicable', 'not_applicable', 'Historical justification', 'Historical reason',
          'completed', 'pending', now(), 'Migration test'),
        ('51000000-0000-4000-8000-000000000002', 'binary-migration-project', NULL,
          'binary-migration-gate', 'deliverable', 'binary-deliverable-na', 'na',
          'applicable', 'not_applicable', 'Historical justification', 'Historical reason',
          'in_progress', 'not_started', now(), 'Migration test');
      INSERT INTO gate_review_cycle (
        id, gate_id, schema_version, cycle_number, project_snapshot,
        package_snapshot, gate_snapshot, status, submitted_at, submitted_by,
        decision, decision_comments, completed_at, frozen_evidence
      ) VALUES (
        'binary-migration-cycle', 'binary-migration-gate', 5, 1,
        '{"id":"binary-migration-project","projectNumber":"MIG-011","name":"Binary migration probe"}'::jsonb,
        NULL,
        '{"id":"binary-migration-gate","name":"Migration Gate","stageId":"initiation","stageLabel":"Initiation"}'::jsonb,
        'returned_for_rework', now(), '{"userId":null,"displayName":"Migration test","email":null}'::jsonb,
        NULL, '', now(),
        '{"frozenAt":"2026-01-01T00:00:00.000Z","criteria":[{"criterionId":"binary-criterion-tbd","applicability":"to_be_determined"}],"deliverables":[],"acceptedActions":[],"documents":[],"baselines":[]}'::jsonb
      )
    `);
    const historyBefore = await client.query(`
      SELECT id, previous_applicability, applicability, justification,
        change_reason, previous_completion_status, completion_status
      FROM applicability_change
      WHERE project_id = 'binary-migration-project'
      ORDER BY id
    `);

    await client.query(await readFile(migrationPath, "utf8"));

    const criteria = await client.query(`
      SELECT id, applicability, status
      FROM gate_criterion
      WHERE gate_id = 'binary-migration-gate'
      ORDER BY id
    `);
    assert.deepEqual(criteria.rows, [
      { id: "binary-criterion-complete", applicability: "applicable", status: "completed" },
      { id: "binary-criterion-na", applicability: "not_applicable", status: "completed" },
      { id: "binary-criterion-tbd", applicability: "applicable", status: "pending" },
    ]);
    const deliverables = await client.query(`
      SELECT id, applicability, status
      FROM deliverable
      WHERE gate_id = 'binary-migration-gate'
      ORDER BY id
    `);
    assert.deepEqual(deliverables.rows, [
      { id: "binary-deliverable-na", applicability: "not_applicable", status: "in_progress" },
      { id: "binary-deliverable-progress", applicability: "applicable", status: "in_progress" },
      { id: "binary-deliverable-tbd", applicability: "applicable", status: "not_started" },
    ]);
    const defaults = await client.query(`
      SELECT table_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('gate_criterion', 'deliverable')
        AND column_name = 'applicability'
      ORDER BY table_name
    `);
    assert.ok(defaults.rows.every((row) => row.column_default.includes("applicable")));
    assert.deepEqual((await client.query(`
      SELECT id, previous_applicability, applicability, justification,
        change_reason, previous_completion_status, completion_status
      FROM applicability_change
      WHERE project_id = 'binary-migration-project'
      ORDER BY id
    `)).rows, historyBefore.rows);
    assert.equal((await client.query(`
      SELECT frozen_evidence #>> '{criteria,0,applicability}' AS applicability
      FROM gate_review_cycle WHERE id = 'binary-migration-cycle'
    `)).rows[0].applicability, "to_be_determined");
    assert.equal(criteria.rowCount, 3);
    assert.equal(deliverables.rowCount, 3);

    await client.query("SAVEPOINT binary_applicability_reject");
    await assert.rejects(
      () => client.query(`
        UPDATE gate_criterion
        SET applicability = 'to_be_determined'
        WHERE id = 'binary-criterion-tbd'
      `),
      /gate_criterion_applicability_check/,
    );
    await client.query("ROLLBACK TO SAVEPOINT binary_applicability_reject");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function verifyApplicabilityDeliverableRenameMigration(connectionString, migrationPath) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO project (
        id, project_number, name, description, project_manager, customer,
        reports_to, site_location, validation_required, current_stage,
        created_at, updated_at
      ) VALUES
        ('rename-default-project', 'REN-001', 'Default-title probe', '',
          'Migration test', 'Test', 'Test', 'Test', false, 'initiation', now(), now()),
        ('rename-custom-project', 'REN-002', 'Custom-title probe', '',
          'Migration test', 'Test', 'Test', 'Test', false, 'initiation', now(), now());
      INSERT INTO gate (
        id, project_id, package_id, scope_level, sequence, template_version,
        name, stage_id, status
      ) VALUES
        ('rename-default-gate', 'rename-default-project', NULL, 'project',
          1, 3, 'Project Authorization', 'initiation', 'returned_for_rework'),
        ('rename-custom-gate', 'rename-custom-project', NULL, 'project',
          1, 3, 'Project Authorization', 'initiation', 'not_submitted');
      INSERT INTO deliverable (
        id, template_id, template_version, project_id, package_id, gate_id,
        sequence, title, description, status, stage_id, scope_level,
        created_at, updated_at, applicability, applicability_origin,
        applicability_locked
      ) VALUES
        ('rename-default-deliverable', 'project_stage_gate_applicability_matrix', 3,
          'rename-default-project', NULL, 'rename-default-gate', 1,
          'Project Stage-Gate Applicability Matrix', 'Default description',
          'completed', 'initiation', 'project', now(), now(), 'applicable',
          'template', true),
        ('rename-custom-deliverable', 'project_stage_gate_applicability_matrix', 3,
          'rename-custom-project', NULL, 'rename-custom-gate', 1,
          'PM Custom Applicability Register', 'Customized description',
          'in_progress', 'initiation', 'project', now(), now(), 'applicable',
          'template', false);
      INSERT INTO gate_review_cycle (
        id, gate_id, schema_version, cycle_number, project_snapshot,
        package_snapshot, gate_snapshot, status, submitted_at, submitted_by,
        decision, decision_comments, completed_at, frozen_evidence
      ) VALUES (
        'rename-frozen-cycle', 'rename-default-gate', 5, 1,
        '{"id":"rename-default-project","projectNumber":"REN-001","name":"Default-title probe"}'::jsonb,
        NULL,
        '{"id":"rename-default-gate","name":"Project Authorization","stageId":"initiation","stageLabel":"Initiation"}'::jsonb,
        'returned_for_rework', now(),
        '{"userId":null,"displayName":"Migration test","email":null}'::jsonb,
        NULL, '', now(),
        '{"frozenAt":"2026-01-01T00:00:00.000Z","criteria":[],"deliverables":[{"deliverableId":"rename-default-deliverable","title":"Project Stage-Gate Applicability Matrix","status":"completed","applicability":"applicable"}],"acceptedActions":[],"documents":[],"baselines":[]}'::jsonb
      )
    `);
    const frozenBefore = (await client.query(`
      SELECT frozen_evidence
      FROM gate_review_cycle
      WHERE id = 'rename-frozen-cycle'
    `)).rows[0].frozen_evidence;

    await client.query(await readFile(migrationPath, "utf8"));

    const deliverables = await client.query(`
      SELECT id, title, status, applicability
      FROM deliverable
      WHERE id IN ('rename-default-deliverable', 'rename-custom-deliverable')
      ORDER BY id
    `);
    assert.deepEqual(deliverables.rows, [
      {
        id: "rename-custom-deliverable",
        title: "PM Custom Applicability Register",
        status: "in_progress",
        applicability: "applicable",
      },
      {
        id: "rename-default-deliverable",
        title: "Project Stage-Gate Deliverable Applicability Matrix",
        status: "completed",
        applicability: "applicable",
      },
    ]);
    assert.equal(deliverables.rowCount, 2);
    assert.deepEqual((await client.query(`
      SELECT frozen_evidence
      FROM gate_review_cycle
      WHERE id = 'rename-frozen-cycle'
    `)).rows[0].frozen_evidence, frozenBefore);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function verifyPackageApplicabilityMatrixMigration(connectionString, migrationPath) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO project (
        id, project_number, name, description, project_manager, customer,
        reports_to, site_location, validation_required, current_stage,
        created_at, updated_at
      ) VALUES (
        'package-matrix-project', 'PKG-MATRIX', 'Package matrix probe', '',
        'Migration test', 'Test', 'Test', 'Test', false, 'initiation', now(), now()
      );
      INSERT INTO project_package (
        id, project_id, package_code, package_name, description, package_owner,
        execution_model, current_stage, status, created_at, updated_at
      ) VALUES
        ('package-matrix-eligible', 'package-matrix-project', 'PKG-ELIGIBLE',
          'Eligible Package', '', 'Migration test', NULL, 'definition',
          'not_assessed', now(), now()),
        ('package-matrix-submitted', 'package-matrix-project', 'PKG-SUBMITTED',
          'Submitted Package', '', 'Migration test', 'external', 'definition',
          'not_assessed', now(), now()),
        ('package-matrix-approved', 'package-matrix-project', 'PKG-APPROVED',
          'Approved Package', '', 'Migration test', 'internal', 'definition',
          'green', now(), now());
      INSERT INTO gate (
        id, project_id, package_id, scope_level, sequence, template_version,
        name, stage_id, status
      ) VALUES
        ('package-matrix-eligible-gate', 'package-matrix-project',
          'package-matrix-eligible', 'package', 1, 4, 'Definition Complete',
          'definition', 'not_submitted'),
        ('package-matrix-submitted-gate', 'package-matrix-project',
          'package-matrix-submitted', 'package', 1, 4, 'Definition Complete',
          'definition', 'submitted_for_approval'),
        ('package-matrix-approved-gate', 'package-matrix-project',
          'package-matrix-approved', 'package', 1, 4, 'Definition Complete',
          'definition', 'approved');
      INSERT INTO deliverable (
        id, template_id, template_version, project_id, package_id, gate_id,
        sequence, title, description, status, stage_id, scope_level,
        created_at, updated_at, applicability, applicability_origin,
        applicability_locked
      ) VALUES (
        'package-matrix-existing-deliverable', 'package_scope', 4,
        'package-matrix-project', 'package-matrix-eligible',
        'package-matrix-eligible-gate', 1, 'Package Scope', '', 'completed',
        'definition', 'package', now(), now(), 'applicable', 'template', false
      );
      INSERT INTO gate_review_cycle (
        id, gate_id, schema_version, cycle_number, project_snapshot,
        package_snapshot, gate_snapshot, status, submitted_at, submitted_by,
        decision, decision_comments, completed_at, frozen_evidence
      ) VALUES
        ('package-matrix-submitted-cycle', 'package-matrix-submitted-gate', 5, 1,
          '{"id":"package-matrix-project","projectNumber":"PKG-MATRIX","name":"Package matrix probe"}'::jsonb,
          '{"id":"package-matrix-submitted","packageCode":"PKG-SUBMITTED","name":"Submitted Package"}'::jsonb,
          '{"id":"package-matrix-submitted-gate","name":"Definition Complete","stageId":"definition","stageLabel":"Definition"}'::jsonb,
          'awaiting_approval', now(),
          '{"userId":null,"displayName":"Migration test","email":null}'::jsonb,
          NULL, '', NULL,
          '{"frozenAt":"2026-01-01T00:00:00.000Z","criteria":[],"deliverables":[],"acceptedActions":[],"documents":[],"baselines":[],"applicabilityMatrix":{"scopeLevel":"package","scopeId":"package-matrix-submitted","generatedAt":"2026-01-01T00:00:00.000Z","gates":[]}}'::jsonb),
        ('package-matrix-approved-cycle', 'package-matrix-approved-gate', 5, 1,
          '{"id":"package-matrix-project","projectNumber":"PKG-MATRIX","name":"Package matrix probe"}'::jsonb,
          '{"id":"package-matrix-approved","packageCode":"PKG-APPROVED","name":"Approved Package"}'::jsonb,
          '{"id":"package-matrix-approved-gate","name":"Definition Complete","stageId":"definition","stageLabel":"Definition"}'::jsonb,
          'approved', now(),
          '{"userId":null,"displayName":"Migration test","email":null}'::jsonb,
          'approved', '', now(),
          '{"frozenAt":"2026-01-01T00:00:00.000Z","criteria":[],"deliverables":[],"acceptedActions":[],"documents":[],"baselines":[],"applicabilityMatrix":{"scopeLevel":"package","scopeId":"package-matrix-approved","generatedAt":"2026-01-01T00:00:00.000Z","gates":[]}}'::jsonb)
    `);
    const frozenBefore = (await client.query(`
      SELECT id, frozen_evidence
      FROM gate_review_cycle
      WHERE id LIKE 'package-matrix-%-cycle'
      ORDER BY id
    `)).rows;

    const migration = await readFile(migrationPath, "utf8");
    await client.query(migration);
    await client.query(migration);

    const matrices = await client.query(`
      SELECT id, package_id, gate_id, sequence, title, status, applicability,
        applicability_locked
      FROM deliverable
      WHERE template_id = 'package_stage_gate_applicability_matrix'
        AND project_id = 'package-matrix-project'
      ORDER BY package_id
    `);
    assert.deepEqual(matrices.rows, [
      {
        id: "package-matrix-approved-gate:deliverable:package_stage_gate_applicability_matrix",
        package_id: "package-matrix-approved",
        gate_id: "package-matrix-approved-gate",
        sequence: 1,
        title: "Package Stage-Gate Deliverable Applicability Matrix",
        status: "not_started",
        applicability: "applicable",
        applicability_locked: true,
      },
      {
        id: "package-matrix-eligible-gate:deliverable:package_stage_gate_applicability_matrix",
        package_id: "package-matrix-eligible",
        gate_id: "package-matrix-eligible-gate",
        sequence: 2,
        title: "Package Stage-Gate Deliverable Applicability Matrix",
        status: "not_started",
        applicability: "applicable",
        applicability_locked: true,
      },
    ]);
    assert.equal(matrices.rowCount, 2);
    assert.equal((await client.query(`
      SELECT count(*)::int AS count
      FROM deliverable
      WHERE gate_id = 'package-matrix-submitted-gate'
        AND template_id = 'package_stage_gate_applicability_matrix'
    `)).rows[0].count, 0);
    assert.deepEqual((await client.query(`
      SELECT title, status, applicability
      FROM deliverable
      WHERE id = 'package-matrix-existing-deliverable'
    `)).rows[0], {
      title: "Package Scope",
      status: "completed",
      applicability: "applicable",
    });
    assert.deepEqual((await client.query(`
      SELECT id, frozen_evidence
      FROM gate_review_cycle
      WHERE id LIKE 'package-matrix-%-cycle'
      ORDER BY id
    `)).rows, frozenBefore);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
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
      path.join(temporaryDirectory, "019_transaction_rollback_test.sql"),
      "CREATE TABLE migration_rollback_probe (id integer);\nSELECT * FROM missing_migration_relation;\n",
      "utf8",
    );
    await assert.rejects(
      () => runMigrations({ connectionString, migrationsDirectory: temporaryDirectory, logger }),
      /Failed to apply 019_transaction_rollback_test.sql/,
    );
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(
        "SELECT to_regclass('public.migration_rollback_probe') AS relation",
      );
      assert.equal(result.rows[0].relation, null);
      const ledger = await client.query(
        "SELECT 1 FROM identity_schema_migration WHERE name = '019_transaction_rollback_test.sql'",
      );
      assert.equal(ledger.rowCount, 0);
    } finally {
      await client.end();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function verifyDeliverablesOnlyMigration(connectionString, migrationPath) {
  const migration = await readFile(migrationPath, "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO project (
        id, project_number, name, description, project_manager, customer,
        reports_to, site_location, validation_required, current_stage,
        created_at, updated_at
      ) VALUES
        ('methodology-project', 'M-015', 'Methodology migration fixture', '', 'PM',
         'Customer', 'Sponsor', 'Test', true, 'definition_design', now(), now()),
        ('methodology-matrix-project', 'M-015-M', 'Matrix fixture', '', 'PM',
         'Customer', 'Sponsor', 'Test', false, 'initiation', now(), now());

      INSERT INTO gate (
        id, project_id, package_id, scope_level, sequence, template_version,
        name, stage_id, status
      ) VALUES
        ('methodology-submitted-gate', 'methodology-project', NULL, 'project', 1, 2,
         'Project Authorization', 'initiation', 'submitted_for_approval'),
        ('methodology-prep-gate', 'methodology-project', NULL, 'project', 2, 3,
         'Project Baseline Approval', 'definition_design', 'not_submitted'),
        ('methodology-approved-gate', 'methodology-project', NULL, 'project', 3, 2,
         'Project Delivery Complete', 'delivery', 'approved'),
        ('methodology-matrix-gate', 'methodology-matrix-project', NULL, 'project', 1, 2,
         'Project Authorization', 'initiation', 'not_submitted');

      INSERT INTO deliverable (
        id, template_id, template_version, project_id, package_id, gate_id,
        sequence, title, description, status, stage_id, scope_level,
        created_at, updated_at, applicability, applicability_origin,
        applicability_locked
      ) VALUES
        ('methodology-governance-survivor', 'project_governance_escalation_plan', 3,
         'methodology-project', NULL, 'methodology-prep-gate', 1,
         'Old governance plan', 'Old requirements', 'in_progress',
         'definition_design', 'project', now(), now(), 'applicable', 'template', false),
        ('methodology-raci-source', 'project_raci', 3,
         'methodology-project', NULL, 'methodology-prep-gate', 2,
         'Old RACI', 'Old requirements', 'completed',
         'definition_design', 'project', now(), now(), 'applicable', 'template', false),
        ('methodology-approved-deliverable', 'package_handover_records', 2,
         'methodology-project', NULL, 'methodology-approved-gate', 1,
         'Historical Package Handover Records', 'Historical acceptance', 'completed',
         'delivery', 'project', now(), now(), 'applicable', 'template', false),
        ('methodology-covered-custom-deliverable', NULL, NULL,
         'methodology-project', NULL, 'methodology-prep-gate', 3,
         'Covered custom Deliverable', 'Accepted when covered.', 'in_progress',
         'definition_design', 'project', now(), now(), 'applicable', 'legacy', false);

      INSERT INTO gate_criterion (
        id, gate_id, sequence, template_id, description, status,
        applicability, applicability_origin, applicability_locked
      ) VALUES
        ('methodology-independent-criterion', 'methodology-prep-gate', 1, NULL,
         'Independent migrated requirement', 'completed', 'applicable', 'legacy', false),
        ('methodology-covered-criterion', 'methodology-prep-gate', 2, NULL,
         'Requirement already covered', 'completed', 'applicable', 'legacy', false);

      INSERT INTO deliverable_criterion (deliverable_id, criterion_id, gate_id, sequence)
      VALUES ('methodology-covered-custom-deliverable', 'methodology-covered-criterion',
              'methodology-prep-gate', 1);

      INSERT INTO gate_review_cycle (
        id, gate_id, schema_version, cycle_number, project_snapshot,
        package_snapshot, gate_snapshot, status, submitted_at, submitted_by,
        decision, decision_comments, completed_at, frozen_evidence
      ) VALUES (
        'methodology-historical-cycle', 'methodology-approved-gate', 5, 1,
        '{"id":"methodology-project","projectNumber":"M-015","name":"Fixture"}'::jsonb,
        NULL, '{"id":"methodology-approved-gate","name":"Project Delivery Complete"}'::jsonb,
        'approved', now(), '{"displayName":"Historical Approver"}'::jsonb,
        'approved', 'Approved before migration 015.', now(),
        '{"frozenAt":"2026-01-01T00:00:00.000Z","criteria":[{"criterionId":"historical-criterion","description":"Historical only","status":"completed"}],"deliverables":[],"acceptedActions":[],"documents":[],"baselines":[]}'::jsonb
      );
    `);

    const historicalFingerprint = await client.query(
      "SELECT md5(frozen_evidence::text) AS value FROM gate_review_cycle WHERE id = 'methodology-historical-cycle'",
    );

    await client.query("BEGIN");
    await client.query(`
      INSERT INTO gate_review_cycle (
        id, gate_id, schema_version, cycle_number, project_snapshot,
        package_snapshot, gate_snapshot, status, submitted_at, submitted_by,
        decision_comments, frozen_evidence
      ) VALUES (
        'methodology-awaiting-cycle', 'methodology-submitted-gate', 5, 1,
        '{"id":"methodology-project","projectNumber":"M-015","name":"Fixture"}'::jsonb,
        NULL, '{"id":"methodology-submitted-gate","name":"Project Authorization"}'::jsonb,
        'awaiting_approval', now(), '{"displayName":"Submitter"}'::jsonb, '',
        '{"frozenAt":"2026-01-01T00:00:00.000Z","criteria":[],"deliverables":[],"acceptedActions":[],"documents":[],"baselines":[]}'::jsonb
      )
    `);
    await assert.rejects(
      () => client.query(migration),
      /M-015.*Project Authorization.*Review Cycle 1/s,
    );
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query(`
      INSERT INTO deliverable (
        id, template_id, template_version, project_id, package_id, gate_id,
        sequence, title, description, status, stage_id, scope_level,
        created_at, updated_at, applicability, applicability_origin,
        applicability_locked
      ) VALUES (
        'methodology-ambiguous-custom-deliverable', NULL, NULL,
        'methodology-project', NULL, 'methodology-prep-gate', 4,
        'Ambiguous custom Deliverable', 'Accepted when ambiguous.', 'not_started',
        'definition_design', 'project', now(), now(), 'applicable', 'legacy', false
      );
      INSERT INTO deliverable_criterion (deliverable_id, criterion_id, gate_id, sequence)
      VALUES ('methodology-ambiguous-custom-deliverable', 'methodology-covered-criterion',
              'methodology-prep-gate', 1);
    `);
    await assert.rejects(
      () => client.query(migration),
      /custom Criteria linked to multiple custom Deliverables/,
    );
    await client.query("ROLLBACK");

    await client.query(migration);

    const result = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM deliverable
         WHERE gate_id = 'methodology-prep-gate' AND template_id IS NOT NULL) AS default_count,
        (SELECT count(*)::integer FROM gate_criterion
         WHERE gate_id = 'methodology-prep-gate') AS legacy_criterion_count,
        (SELECT count(*)::integer FROM deliverable
         WHERE gate_id = 'methodology-prep-gate' AND template_id IS NULL) AS custom_count,
        (SELECT status FROM deliverable
         WHERE id = 'methodology-governance-survivor') AS consolidated_status,
        (SELECT template_id FROM deliverable
         WHERE id = 'methodology-governance-survivor') AS consolidated_template_id,
        (SELECT status FROM deliverable
         WHERE id = 'methodology-independent-criterion:legacy-deliverable') AS converted_status,
        (SELECT count(*)::integer FROM deliverable_criterion
         WHERE criterion_id = 'methodology-independent-criterion') AS converted_trace_count,
        (SELECT template_version FROM gate
         WHERE id = 'methodology-prep-gate') AS prep_template_version,
        (SELECT template_version FROM gate
         WHERE id = 'methodology-approved-gate') AS approved_template_version,
        (SELECT title FROM deliverable
         WHERE id = 'methodology-approved-deliverable') AS approved_title,
        (SELECT applicability FROM deliverable
         WHERE gate_id = 'methodology-prep-gate'
           AND template_id = 'initial_traceability_structure') AS rtm_applicability,
        (SELECT applicability_locked FROM deliverable
         WHERE gate_id = 'methodology-matrix-gate'
           AND template_id = 'project_stage_gate_applicability_matrix') AS matrix_locked,
        (SELECT applicability FROM deliverable
         WHERE gate_id = 'methodology-matrix-gate'
           AND template_id = 'project_stage_gate_applicability_matrix') AS matrix_applicability,
        (SELECT md5(frozen_evidence::text) FROM gate_review_cycle
         WHERE id = 'methodology-historical-cycle') AS historical_fingerprint,
        to_regclass('public.gate_criterion')::text AS criterion_table,
        to_regclass('public.deliverable_criterion')::text AS link_table
    `);
    assert.deepEqual(result.rows[0], {
      default_count: 17,
      legacy_criterion_count: 2,
      custom_count: 2,
      consolidated_status: "in_progress",
      consolidated_template_id: "project_governance_escalation_plan",
      converted_status: "completed",
      converted_trace_count: 1,
      prep_template_version: 6,
      approved_template_version: 2,
      approved_title: "Historical Package Handover Records",
      rtm_applicability: "applicable",
      matrix_locked: true,
      matrix_applicability: "applicable",
      historical_fingerprint: historicalFingerprint.rows[0].value,
      criterion_table: "gate_criterion",
      link_table: "deliverable_criterion",
    });
  } finally {
    await client.end();
  }
}

async function verifyProjectSiteOrganizationEhsMigration(connectionString, migrationPath) {
  const migration = await readFile(migrationPath, "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existingDeliverables = await client.query(`
      SELECT id, template_id, title, description, status, applicability,
             applicability_justification, applicability_decided_at,
             applicability_decided_by_user_id,
             applicability_decided_by_display_name
      FROM deliverable
      WHERE gate_id = 'methodology-prep-gate'
      ORDER BY id
    `);
    const historicalFingerprint = await client.query(
      "SELECT md5(frozen_evidence::text) AS value FROM gate_review_cycle WHERE id = 'methodology-historical-cycle'",
    );

    await client.query(migration);

    const preservedDeliverables = await client.query(`
      SELECT id, template_id, title, description, status, applicability,
             applicability_justification, applicability_decided_at,
             applicability_decided_by_user_id,
             applicability_decided_by_display_name
      FROM deliverable
      WHERE gate_id = 'methodology-prep-gate'
        AND template_id IS DISTINCT FROM 'project_site_organization_ehs_plan'
      ORDER BY id
    `);
    assert.deepEqual(preservedDeliverables.rows, existingDeliverables.rows);

    const result = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM deliverable
         WHERE gate_id = 'methodology-prep-gate'
           AND template_id IS NOT NULL) AS default_count,
        (SELECT count(*)::integer FROM deliverable
         WHERE template_id = 'project_site_organization_ehs_plan') AS site_plan_count,
        (SELECT title FROM deliverable
         WHERE template_id = 'project_site_organization_ehs_plan') AS title,
        (SELECT status FROM deliverable
         WHERE template_id = 'project_site_organization_ehs_plan') AS status,
        (SELECT applicability FROM deliverable
         WHERE template_id = 'project_site_organization_ehs_plan') AS applicability,
        (SELECT applicability_locked FROM deliverable
         WHERE template_id = 'project_site_organization_ehs_plan') AS applicability_locked,
        (SELECT template_version FROM gate
         WHERE id = 'methodology-prep-gate') AS template_version,
        (SELECT site_plan.sequence = governance.sequence + 1
         FROM deliverable AS site_plan
         JOIN deliverable AS governance ON governance.gate_id = site_plan.gate_id
         WHERE site_plan.template_id = 'project_site_organization_ehs_plan'
           AND governance.template_id = 'project_governance_escalation_plan') AS ordered_after_governance,
        (SELECT count(*)::integer
         FROM deliverable
         JOIN gate ON gate.id = deliverable.gate_id
         WHERE deliverable.template_id = 'project_site_organization_ehs_plan'
           AND gate.status NOT IN ('not_submitted', 'returned_for_rework')) AS protected_gate_count,
        (SELECT md5(frozen_evidence::text) FROM gate_review_cycle
         WHERE id = 'methodology-historical-cycle') AS historical_fingerprint
    `);
    assert.deepEqual(result.rows[0], {
      default_count: 18,
      site_plan_count: 1,
      title: "Project Site Organization & EHS Plan",
      status: "not_started",
      applicability: "applicable",
      applicability_locked: false,
      template_version: 7,
      ordered_after_governance: true,
      protected_gate_count: 0,
      historical_fingerprint: historicalFingerprint.rows[0].value,
    });
  } finally {
    await client.end();
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

async function seedTestIdentity(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const users = [
      [testOwnerUserId, testOwnerObjectId, "Owner", "internal"],
      [testEditorUserId, "30000000-0000-4000-8000-000000000002", "Editor", "internal"],
      [testViewerUserId, "30000000-0000-4000-8000-000000000003", "Viewer", "internal"],
      [testOutsiderUserId, "30000000-0000-4000-8000-000000000004", "Outsider", "internal"],
      [testExternalUserId, "30000000-0000-4000-8000-000000000005", "External", "external_reviewer"],
    ];
    for (const [index, [userId, objectId, label, accessClass]] of users.entries()) {
      const email = `integration-${label.toLowerCase()}@example.invalid`;
      await client.query(
        `INSERT INTO app_user (
           id, display_name, email, normalized_email, email_verified,
           status, access_class, created_at, updated_at
         ) VALUES ($1, $2, $3, $3, true, 'active', $4, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           status = 'active', access_class = EXCLUDED.access_class, updated_at = now()`,
        [userId, `Integration Test ${label}`, email, accessClass],
      );
      await client.query(
        `INSERT INTO user_identity (
           id, provider, provider_object_id, user_id, provider_tenant_id,
           provider_subject, provider_email_snapshot, entra_account_type,
           last_authenticated_at, created_at, updated_at
         ) VALUES ($1, 'microsoft', $2, $3, $4, $5, $6, $7, now(), now(), now())
         ON CONFLICT (provider, provider_object_id) DO UPDATE SET
           provider_tenant_id = EXCLUDED.provider_tenant_id,
           provider_subject = EXCLUDED.provider_subject,
           last_authenticated_at = now(), updated_at = now()`,
        [
          `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          objectId,
          userId,
          testTenantId,
          `integration-test-subject-${index + 1}`,
          email,
          accessClass === "internal" ? 0 : 1,
        ],
      );
    }
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
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const historicalOtpColumns = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM gate_review_cycle_approver) AS approver_count,
         (SELECT count(*)::integer FROM gate_review_cycle_approver
          WHERE authentication_method IS NOT NULL OR review_access_id IS NOT NULL) AS changed_approver_count,
         (SELECT count(*)::integer FROM gate_review_response
          WHERE authentication_method IS NOT NULL OR review_session_id IS NOT NULL) AS changed_response_count,
         (SELECT count(*)::integer FROM gate_review_otp_challenge) AS challenge_count,
         (SELECT count(*)::integer FROM gate_review_session) AS session_count`,
    );
    assert.ok(historicalOtpColumns.rows[0].approver_count > 0);
    assert.equal(historicalOtpColumns.rows[0].changed_approver_count, 0);
    assert.equal(historicalOtpColumns.rows[0].changed_response_count, 0);
    assert.equal(historicalOtpColumns.rows[0].challenge_count, 0);
    assert.equal(historicalOtpColumns.rows[0].session_count, 0);
    await client.query(
      `INSERT INTO audit_event (
         id, request_id, event_type, resource_type, resource_id,
         change_summary, metadata
       ) VALUES ($1, $2, 'integration.probe', 'test', 'probe', '{}'::jsonb, '{}'::jsonb)`,
      [
        "50000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
      ],
    );
  } finally {
    await client.end();
  }
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
  await expectDatabaseError(connectionString,
    "UPDATE audit_event SET event_type = 'changed' WHERE id = '50000000-0000-4000-8000-000000000001'",
    /append-only/i);
  await expectDatabaseError(connectionString,
    "DELETE FROM audit_event WHERE id = '50000000-0000-4000-8000-000000000001'",
    /append-only/i);
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
