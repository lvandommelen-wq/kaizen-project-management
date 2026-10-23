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
  await verifyAccessMigrationsFromLegacyState(
    databaseUrlA,
    databaseNameA,
    migrationsDirectory,
    silentLogger,
  );
  await verifyAmbiguousActionScopeFailsClosed(
    databaseUrlB,
    databaseNameB,
    migrationsDirectory,
    silentLogger,
  );
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
      if (specifier === "next/headers") {
        return {
          url: "data:text/javascript,export async function headers(){throw new Error('Request headers are unavailable in this integration test.')} ",
          shortCircuit: true,
        };
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
  const governanceTemplates = await import("../src/lib/governance-templates.ts");
  const accessAuthorization = await import("../src/lib/access-authorization.ts");
  const accessManagement = await import("../src/lib/access-management.ts");
  const actionRegister = await import("../src/lib/action-register.ts");
  const authorization = await import("../src/lib/authorization.ts");
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

    const projectCreatorClient = await database.getOperationalPool().connect();
    try {
      await projectCreatorClient.query(
        `INSERT INTO project_creation_authorization (user_id)
         VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET
           revoked_at = NULL, revoked_by_user_id = NULL`,
        [testOwnerUserId],
      );
    } finally {
      projectCreatorClient.release();
    }
    assert.equal(await authorization.canCreateProject({
      id: testOwnerUserId,
      displayName: "Integration Test Owner",
      email: "integration-owner@example.invalid",
      normalizedEmail: "integration-owner@example.invalid",
      organizationName: null,
      accessClass: "internal",
      status: "active",
      providerTenantId: testTenantId,
      providerObjectId: testOwnerObjectId,
    }), true);
    assert.equal(await authorization.canCreateProject({
      id: testOutsiderUserId,
      displayName: "Integration Test Outsider",
      email: "integration-outsider@example.invalid",
      normalizedEmail: "integration-outsider@example.invalid",
      organizationName: null,
      accessClass: "internal",
      status: "active",
      providerTenantId: testTenantId,
      providerObjectId: "30000000-0000-4000-8000-000000000004",
    }), false);

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
    const projectTemplates = governanceTemplates.getProjectGateTemplates(
      project.validationRequired,
    );
    assert.equal(project.gates.length, projectTemplates.length);
    assert.equal(
      (await Promise.all(project.gates.map((gate) =>
        deliverableFacade.getGateDeliverables(project.id, null, gate.id))))
        .flat().filter((deliverable) => deliverable.templateId).length,
      projectTemplates.reduce(
        (count, template) => count + template.deliverables.length,
        0,
      ),
      "Project creation must initialize every default Deliverable before any Applicability read.",
    );
    await assert.rejects(
      () => projectFacade.createProject({
        projectNumber: `runtime-unauthorized-${Date.now()}`,
        name: "Unauthorized creation probe",
        description: "Must not persist.",
        projectManager: "Integration Test",
        customer: "Test Customer",
        reportsTo: "Test Sponsor",
        siteLocation: "Test Site",
        plannedStartDate: "",
        plannedCompletionDate: "",
        validationRequired: false,
        currentStage: "initiation",
      }, testOutsiderUserId),
      /not authorized to create Projects/,
    );
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
    assert.equal(projectPackage.gates.length, governanceTemplates.packageGateTemplates.length);
    assert.equal(
      (await Promise.all(projectPackage.gates.map((gate) =>
        deliverableFacade.getGateDeliverables(project.id, projectPackage.id, gate.id))))
        .flat().filter((deliverable) => deliverable.templateId).length,
      governanceTemplates.packageGateTemplates.reduce(
        (count, template) => count + template.deliverables.length,
        0,
      ),
      "Package creation must initialize every default Deliverable before any Applicability read.",
    );
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
    const authorizationPackage = await packageFacade.createPackage(project.id, {
      ...packageInput,
      packageCode: "PKG-ACCESS",
      packageName: "Authorization Package",
    });

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
    const authenticatedPackageLeadActor = {
      ...authenticatedActor,
      id: testViewerUserId,
      displayName: "Integration Test Viewer",
      email: "integration-viewer@example.invalid",
      normalizedEmail: "integration-viewer@example.invalid",
      providerObjectId: "30000000-0000-4000-8000-000000000003",
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
    await verifyAccessAuthorizationService({
      accessAuthorization,
      database,
      projectId: project.id,
      packageId: projectPackage.id,
      otherPackageId: authorizationPackage.id,
      crossProjectPackageId: source.packages.find(
        (item) => item.projectId !== project.id,
      )?.id ?? source.packages[0]?.id,
      owner: authenticatedEditorActor,
      accessManager: authenticatedActor,
    });
    await verifyInternalAccessManagement({
      accessAuthorization,
      accessManagement,
      database,
      projectId: project.id,
      packageId: projectPackage.id,
      otherPackageId: authorizationPackage.id,
      owner: authenticatedEditorActor,
      accessManager: authenticatedActor,
    });
    await verifyAuthorizedActionRegister({
      accessAuthorization,
      actionFacade,
      actionRegister,
      database,
      projectId: project.id,
      packageId: projectPackage.id,
      otherPackageId: authorizationPackage.id,
      projectGateId: currentGate.id,
      owner: authenticatedEditorActor,
    });
    await assertScopeOperationIsReadOnly({
      database,
      projectId: project.id,
      packageId: null,
      label: "Repeated Project Applicability reads",
      operation: async () => {
        await runtime.getApplicabilityReview(project.id, null);
        await runtime.getApplicabilityReview(project.id, null);
      },
    });
    await assertScopeOperationIsReadOnly({
      database,
      projectId: project.id,
      packageId: null,
      label: "Repeated Project Gate page reads",
      operation: async () => {
        for (let index = 0; index < 2; index += 1) {
          await projectFacade.getProject(project.id);
          await packageFacade.getPackages(project.id);
          await runtime.getGateMatrixReview(project.id, null, currentGate.id);
          await runtime.getApplicabilityReview(project.id, null);
        }
      },
    });
    await assertScopeOperationIsReadOnly({
      database,
      projectId: project.id,
      packageId: null,
      label: "Repeated Project Gate Matrix Review loading",
      operation: async () => {
        await runtime.getGateMatrixReview(project.id, null, currentGate.id);
        await runtime.getGateMatrixReview(project.id, null, currentGate.id);
      },
    });
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
    const protectedProjectCustomDeliverable = await deliverableFacade.createDeliverable({
      projectId: project.id,
      packageId: null,
      gateId: currentGate.id,
      criterionIds: [],
      title: "Protected completed Stage custom Deliverable",
      description: "",
      status: "not_started",
      stageId: currentGate.stageId,
      scopeLevel: "project",
    });
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
      /authorized Project Owner or Package Lead/i,
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
    assert.equal(
      reconciledProject.gates.find((gate) => gate.id === currentGate.id)
        .deliverableConfigurationLocked,
      true,
    );
    assert.equal(
      reconciledProject.gates.find((gate) => gate.id === currentGate.id)
        .deliverableCompletionLocked,
      true,
    );
    assert.equal(
      reconciledProject.gates.find((gate) => gate.id === projectNotApplicableGate.gate.id)
        .deliverableConfigurationLocked,
      true,
    );
    assert.equal(
      reconciledProject.gates.find((gate) => gate.id === projectNotApplicableGate.gate.id)
        .deliverableCompletionLocked,
      false,
    );
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
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: null,
        gateId: currentGate.id,
        itemType: "deliverable",
        itemId: completionPreservationDeliverable.id,
        applicability: "not_applicable",
        justification: "An approved completed Stage must reject this change.",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => runtime.createApplicabilityItem({
        projectId: project.id,
        packageId: null,
        gateId: currentGate.id,
        itemType: "deliverable",
        title: "Blocked completed Project Stage addition",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => deliverableFacade.deleteDeliverable(protectedProjectCustomDeliverable.id, {
        projectId: project.id,
        packageId: null,
        gateId: currentGate.id,
      }),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => deliverableFacade.updateDeliverable(
        completionPreservationDeliverable.id,
        { ...completionPreservationDeliverable, status: "in_progress" },
      ),
      /completion evidence is protected by its submitted or approved Gate/,
    );
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: null,
        gateId: projectNotApplicableGate.gate.id,
        itemType: "deliverable",
        itemId: projectNotApplicableItem.id,
        applicability: "applicable",
        justification: "",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => runtime.createApplicabilityItem({
        projectId: project.id,
        packageId: null,
        gateId: projectNotApplicableGate.gate.id,
        itemType: "deliverable",
        title: "Blocked Project baseline addition",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    const projectStatusUpdate = await deliverableFacade.updateDeliverable(
      projectNotApplicableItem.id,
      { ...projectNotApplicableItem, status: "in_progress" },
    );
    assert.equal(projectStatusUpdate?.status, "in_progress");
    await assert.rejects(
      () => deliverableFacade.updateDeliverable(
        projectNotApplicableItem.id,
        { ...projectNotApplicableItem, title: "Blocked Project baseline title" },
      ),
      /protected by a submitted or approved Gate/,
    );
    const futureProjectGate = projectApplicabilityReview.gates.find(
      (reviewGate) => reviewGate.gate.stageId === "delivery",
    )?.gate;
    assert.ok(futureProjectGate);
    const futureProjectItemId = await runtime.createApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: futureProjectGate.id,
      itemType: "deliverable",
      title: "Editable future Project Deliverable",
    }, authenticatedActor);
    assert.ok(futureProjectItemId);
    assert.equal(await runtime.deleteApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: futureProjectGate.id,
      itemType: "deliverable",
      itemId: futureProjectItemId,
    }), true);
    await assert.rejects(
      () => projectFacade.reopenProjectGate(project.id, currentGate.id, "   "),
      /reopening reason is required/i,
    );
    const projectReviewCyclesBeforeReopening = structuredClone(
      (await projectFacade.getProject(project.id)).gates
        .find((gate) => gate.id === currentGate.id).reviewCycles,
    );
    const projectReopening = await projectFacade.reopenProjectGate(
      project.id,
      currentGate.id,
      "Revise the approved Definition and Design baseline.",
    );
    assert.equal(projectReopening?.previousStage, "definition_design");
    assert.equal(projectReopening?.targetStage, "initiation");
    assert.equal(projectReopening?.entity.currentStage, "initiation");
    assert.equal(
      projectReopening?.entity.gates.find((gate) => gate.id === currentGate.id)
        ?.reapprovalRequired,
      true,
    );
    assert.equal(
      projectReopening?.entity.gates.find((gate) => gate.id === currentGate.id)
        ?.deliverableConfigurationLocked,
      false,
    );
    assert.equal(
      projectReopening?.entity.gates.find((gate) => gate.id === currentGate.id)
        ?.deliverableCompletionLocked,
      false,
    );
    assert.equal(
      projectReopening?.entity.gates.find((gate) => gate.id === projectNotApplicableGate.gate.id)
        ?.deliverableConfigurationLocked,
      false,
    );
    assert.deepEqual(
      projectReopening?.entity.gates.find((gate) => gate.id === currentGate.id)
        ?.reviewCycles,
      projectReviewCyclesBeforeReopening,
    );
    assert.equal(
      (await deliverableFacade.getGateDeliverables(
        project.id,
        null,
        projectNotApplicableGate.gate.id,
      )).find((deliverable) => deliverable.id === projectNotApplicableItem.id)?.status,
      "in_progress",
    );
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: null,
      gateId: projectNotApplicableGate.gate.id,
      itemType: "deliverable",
      itemId: projectNotApplicableItem.id,
      applicability: "applicable",
      justification: "",
    }, authenticatedActor));
    await assert.rejects(
      () => projectFacade.reopenProjectGate(
        project.id,
        currentGate.id,
        "Attempt a repeated backward transition.",
      ),
      /must be formally approved before another Gate can be reopened/,
    );
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
    const reopenedProjectDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      null,
      currentGate.id,
    )).find((deliverable) => deliverable.id === completionPreservationDeliverable.id);
    assert.ok(reopenedProjectDeliverable);
    assert.equal(
      (await deliverableFacade.updateDeliverable(
        reopenedProjectDeliverable.id,
        { ...reopenedProjectDeliverable, status: "in_progress" },
      ))?.status,
      "in_progress",
    );
    assert.equal(
      (await deliverableFacade.updateDeliverable(
        reopenedProjectDeliverable.id,
        { ...reopenedProjectDeliverable, status: "completed" },
      ))?.status,
      "completed",
    );
    assert.equal(
      (await runtime.confirmGateMatrixReview(
        project.id,
        null,
        currentGate.id,
        authenticatedActor,
      )).effectiveStatus,
      "confirmed",
    );
    const renewedProjectSubmission = await projectFacade.submitProjectGateForApproval(
      project.id,
      currentGate.id,
    );
    assert.equal(renewedProjectSubmission?.outcome, "submitted");
    assert.equal(
      renewedProjectSubmission.reviewCycle.previousCycleId,
      approvedSubmission.reviewCycle.id,
    );
    const submittedReopenedProject = await projectFacade.getProject(project.id);
    assert.equal(
      submittedReopenedProject.gates.find((gate) => gate.id === currentGate.id)
        .deliverableConfigurationLocked,
      true,
    );
    assert.equal(
      submittedReopenedProject.gates.find((gate) => gate.id === currentGate.id)
        .deliverableCompletionLocked,
      true,
    );
    assert.equal(
      submittedReopenedProject.gates.find((gate) => gate.id === projectNotApplicableGate.gate.id)
        .deliverableConfigurationLocked,
      true,
    );
    await assert.rejects(
      () => deliverableFacade.updateDeliverable(
        reopenedProjectDeliverable.id,
        { ...reopenedProjectDeliverable, status: "in_progress" },
      ),
      /completion evidence is protected by its submitted or approved Gate/,
    );
    const renewedProjectFirstApprover = renewedProjectSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === approver.id,
    );
    const renewedProjectSecondApprover = renewedProjectSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === secondApprover.id,
    );
    assert.ok(renewedProjectFirstApprover?.reviewAccessId);
    assert.ok(renewedProjectSecondApprover?.reviewAccessId);
    const renewedProjectFirstSession = await issueOtpSession(
      renewedProjectFirstApprover.reviewAccessId,
    );
    const renewedProjectFirstResponse = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: renewedProjectFirstApprover.reviewAccessId,
      sessionToken: renewedProjectFirstSession.verification.sessionToken,
      outcome: "approved",
      comment: "Approve the revised completed Stage and next-Stage baselines.",
    });
    assert.equal(renewedProjectFirstResponse?.completion, "pending");
    const renewedProjectSecondSession = await issueOtpSession(
      renewedProjectSecondApprover.reviewAccessId,
    );
    const renewedProjectApproval = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: renewedProjectSecondApprover.reviewAccessId,
      sessionToken: renewedProjectSecondSession.verification.sessionToken,
      outcome: "approved",
      comment: "Complete renewed formal Project approval.",
    });
    assert.equal(renewedProjectApproval?.completion, "approved");
    assert.equal(renewedProjectApproval.entity.currentStage, "definition_design");
    assert.equal(
      renewedProjectApproval.entity.gates.find((gate) => gate.id === currentGate.id)
        ?.reapprovalRequired,
      false,
    );
    assert.equal(
      renewedProjectApproval.entity.gates.find((gate) => gate.id === currentGate.id)
        ?.deliverableCompletionLocked,
      true,
    );
    for (const historicalCycle of projectReviewCyclesBeforeReopening) {
      assert.deepEqual(
        renewedProjectApproval.entity.gates.find((gate) => gate.id === currentGate.id)
          ?.reviewCycles.find((cycleCandidate) => cycleCandidate.id === historicalCycle.id),
        historicalCycle,
      );
    }

    const packageBeforeSubmission = await packageFacade.getPackage(
      project.id,
      projectPackage.id,
    );
    const packageGate = packageBeforeSubmission?.gates.find(
      (gate) => gate.stageId === packageBeforeSubmission.currentStage,
    );
    assert.ok(packageGate);
    await assertScopeOperationIsReadOnly({
      database,
      projectId: project.id,
      packageId: projectPackage.id,
      label: "Repeated Package Applicability reads",
      operation: async () => {
        await runtime.getApplicabilityReview(project.id, projectPackage.id);
        await runtime.getApplicabilityReview(project.id, projectPackage.id);
      },
    });
    await assertScopeOperationIsReadOnly({
      database,
      projectId: project.id,
      packageId: projectPackage.id,
      label: "Repeated Package Gate page reads",
      operation: async () => {
        for (let index = 0; index < 2; index += 1) {
          await packageFacade.getPackage(project.id, projectPackage.id);
          await runtime.getGateMatrixReview(
            project.id,
            projectPackage.id,
            packageGate.id,
          );
          await runtime.getApplicabilityReview(project.id, projectPackage.id);
        }
      },
    });
    await assertScopeOperationIsReadOnly({
      database,
      projectId: project.id,
      packageId: projectPackage.id,
      label: "Repeated Package Gate Matrix Review loading",
      operation: async () => {
        await runtime.getGateMatrixReview(project.id, projectPackage.id, packageGate.id);
        await runtime.getGateMatrixReview(project.id, projectPackage.id, packageGate.id);
      },
    });
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
    preservedPackageDeliverable = await deliverableFacade.updateDeliverable(
      packageNotApplicableItem.id,
      {
        ...packageNotApplicableItem,
        title: "User-customized Package Deliverable title",
        status: "completed",
      },
    );
    assert.equal(
      preservedPackageDeliverable.title,
      "User-customized Package Deliverable title",
    );
    const protectedPackageCustomItemId = await runtime.createApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: packageGate.id,
      itemType: "deliverable",
      title: "Protected completed Package Stage custom Deliverable",
    }, authenticatedActor);
    assert.ok(protectedPackageCustomItemId);
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
    preservedPackageDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      packageNotApplicableGate.gate.id,
    )).find((deliverable) => deliverable.id === packageNotApplicableItem.id);
    assert.equal(
      preservedPackageDeliverable.title,
      "User-customized Package Deliverable title",
      "Gate submission must not reset a same-version customized Deliverable.",
    );
    assert.equal(preservedPackageDeliverable.status, "completed");
    assert.equal(preservedPackageDeliverable.applicability, "not_applicable");
    assert.equal(
      preservedPackageDeliverable.applicabilityJustification,
      "Not required for this Package scope.",
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
    const packageWithdrawal = await accessAuthorization.withAuthorizedPackageGovernanceMutation({
      user: authenticatedPackageLeadActor,
      projectId: project.id,
      packageId: projectPackage.id,
      audit: {
        eventType: "gate.withdrawn.integration_test",
        resourceType: "gate",
        resourceId: packageGate.id,
      },
      operation: () => packageFacade.withdrawPackageGateSubmission(
        project.id,
        projectPackage.id,
        packageGate.id,
        "Package scope changed after partial approval.",
        {
          userId: authenticatedPackageLeadActor.id,
          displayName: authenticatedPackageLeadActor.displayName,
          email: authenticatedPackageLeadActor.email,
          providerTenantId: authenticatedPackageLeadActor.providerTenantId,
          providerObjectId: authenticatedPackageLeadActor.providerObjectId,
        },
      ),
      isSuccess: (candidate) => candidate?.outcome === "withdrawn",
    });
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

    const synchronizationPackage = await packageFacade.getPackage(
      project.id,
      projectPackage.id,
    );
    const synchronizationGate = synchronizationPackage.gates.find(
      (gate) => gate.id === packageNotApplicableGate.gate.id,
    );
    assert.ok(synchronizationGate);
    const customSynchronizationDeliverable = await deliverableFacade.createDeliverable({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: synchronizationGate.id,
      criterionIds: [],
      title: "Custom Deliverable preserved during methodology synchronization",
      description: "Must remain outside template synchronization.",
      status: "in_progress",
      stageId: synchronizationGate.stageId,
      scopeLevel: "package",
    });
    const sameVersionStateBefore = await loadScopeMutationState(
      database,
      project.id,
      projectPackage.id,
    );
    await runtime.ensureDefaultDeliverables({
      projectId: project.id,
      packageId: projectPackage.id,
      gates: synchronizationPackage.gates,
      templates: governanceTemplates.packageGateTemplates,
    });
    assert.deepEqual(
      await loadScopeMutationState(database, project.id, projectPackage.id),
      sameVersionStateBefore,
      "Unchanged controlled synchronization must not update timestamps or row versions.",
    );

    const synchronizedTemplate = governanceTemplates.packageGateTemplates.find(
      (template) => template.stageId === synchronizationGate.stageId,
    );
    assert.ok(synchronizedTemplate);
    const synchronizedDefinition = synchronizedTemplate.deliverables.find(
      (definition) => definition.id === packageNotApplicableItem.templateId,
    );
    assert.ok(synchronizedDefinition);
    const controlledTargetBefore = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      synchronizationGate.id,
    )).find((deliverable) => deliverable.id === packageNotApplicableItem.id);
    assert.ok(controlledTargetBefore);
    const controlledTemplateVersion = synchronizedTemplate.templateVersion + 1;
    const controlledTitle = `${synchronizedDefinition.title} — approved methodology update`;
    const controlledDescription = `${synchronizedDefinition.description}\nApproved methodology update.`;
    const controlledTemplates = governanceTemplates.packageGateTemplates.map((template) =>
      template.stageId === synchronizationGate.stageId
        ? {
            ...template,
            templateVersion: controlledTemplateVersion,
            deliverables: template.deliverables.map((definition) =>
              definition.id === synchronizedDefinition.id
                ? {
                    ...definition,
                    title: controlledTitle,
                    description: controlledDescription,
                  }
                : definition),
          }
        : template);
    await runtime.ensureDefaultDeliverables({
      projectId: project.id,
      packageId: projectPackage.id,
      gates: synchronizationPackage.gates,
      templates: controlledTemplates,
    });
    const controlledTargetAfter = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      synchronizationGate.id,
    )).find((deliverable) => deliverable.id === packageNotApplicableItem.id);
    assert.equal(controlledTargetAfter.templateVersion, controlledTemplateVersion);
    assert.equal(controlledTargetAfter.title, controlledTitle);
    assert.equal(controlledTargetAfter.description, controlledDescription);
    assert.equal(controlledTargetAfter.status, controlledTargetBefore.status);
    assert.equal(controlledTargetAfter.applicability, controlledTargetBefore.applicability);
    assert.equal(
      controlledTargetAfter.applicabilityJustification,
      controlledTargetBefore.applicabilityJustification,
    );
    assert.equal(
      controlledTargetAfter.applicabilityDecidedAt,
      controlledTargetBefore.applicabilityDecidedAt,
    );
    assert.equal(
      controlledTargetAfter.applicabilityDecidedByUserId,
      controlledTargetBefore.applicabilityDecidedByUserId,
    );
    assert.equal(
      controlledTargetAfter.applicabilityDecidedByDisplayName,
      controlledTargetBefore.applicabilityDecidedByDisplayName,
    );
    assert.notEqual(controlledTargetAfter.updatedAt, controlledTargetBefore.updatedAt);
    assert.deepEqual(
      (await deliverableFacade.getGateDeliverables(
        project.id,
        projectPackage.id,
        synchronizationGate.id,
      )).find((deliverable) => deliverable.id === customSynchronizationDeliverable.id),
      customSynchronizationDeliverable,
      "Controlled template synchronization must not modify custom Deliverables.",
    );
    const changedSynchronizationState = await loadScopeMutationState(
      database,
      project.id,
      projectPackage.id,
    );
    assert.deepEqual(
      changedSynchronizationState.reviewCycles,
      sameVersionStateBefore.reviewCycles,
      "Controlled synchronization must not alter frozen Review Cycle evidence.",
    );
    assert.equal(
      changedSynchronizationState.gates.find((gate) => gate.id === synchronizationGate.id)
        ?.template_version,
      controlledTemplateVersion,
    );
    await runtime.ensureDefaultDeliverables({
      projectId: project.id,
      packageId: projectPackage.id,
      gates: synchronizationPackage.gates,
      templates: controlledTemplates,
    });
    assert.deepEqual(
      await loadScopeMutationState(database, project.id, projectPackage.id),
      changedSynchronizationState,
      "Repeated controlled synchronization must be physically idempotent.",
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
    assert.equal(
      reconciledPackage.gates.find((gate) => gate.id === packageGate.id)
        .deliverableConfigurationLocked,
      true,
    );
    assert.equal(
      reconciledPackage.gates.find((gate) => gate.id === packageGate.id)
        .deliverableCompletionLocked,
      true,
    );
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
    const packageReviewCyclesBeforeReopening = structuredClone(
      reconciledPackage.gates.find((gate) => gate.id === packageGate.id).reviewCycles,
    );
    const tenderingGate = reconciledPackage.gates.find(
      (gate) => gate.stageId === "tendering",
    );
    const procurementGate = reconciledPackage.gates.find(
      (gate) => gate.stageId === "procurement",
    );
    assert.ok(tenderingGate);
    assert.ok(procurementGate);
    assert.equal(tenderingGate.deliverableConfigurationLocked, true);
    assert.equal(tenderingGate.deliverableCompletionLocked, false);
    const packageCompletedStageDeliverable = packageDeliverablesBeforeReadiness.find(
      (deliverable) => !deliverable.applicabilityLocked,
    );
    assert.ok(packageCompletedStageDeliverable);
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: packageGate.id,
        itemType: "deliverable",
        itemId: packageCompletedStageDeliverable.id,
        applicability: "not_applicable",
        justification: "An approved completed Package Stage must reject this change.",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => deliverableFacade.updateDeliverable(
        packageCompletedStageDeliverable.id,
        { ...packageCompletedStageDeliverable, status: "in_progress" },
      ),
      /completion evidence is protected by its submitted or approved Gate/,
    );
    await assert.rejects(
      () => runtime.deleteApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: packageGate.id,
        itemType: "deliverable",
        itemId: protectedPackageCustomItemId,
      }),
      /protected by a submitted or approved Gate/,
    );
    const tenderingDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      tenderingGate.id,
    )).find((deliverable) => !deliverable.applicabilityLocked);
    assert.ok(tenderingDeliverable);
    const completedTenderingDeliverable = await deliverableFacade.updateDeliverable(
      tenderingDeliverable.id,
      { ...tenderingDeliverable, status: "completed" },
    );
    assert.equal(completedTenderingDeliverable?.status, "completed");
    await assert.rejects(
      () => deliverableFacade.updateDeliverable(
        tenderingDeliverable.id,
        { ...tenderingDeliverable, title: "Blocked Package baseline title" },
      ),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: tenderingGate.id,
        itemType: "deliverable",
        itemId: tenderingDeliverable.id,
        applicability: "not_applicable",
        justification: "This direct baseline bypass must fail.",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    await assert.rejects(
      () => runtime.createApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: tenderingGate.id,
        itemType: "deliverable",
        title: "Blocked Package baseline addition",
      }, authenticatedActor),
      /protected by a submitted or approved Gate/,
    );
    const futurePackageItemId = await runtime.createApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: procurementGate.id,
      itemType: "deliverable",
      title: "Editable future Package Deliverable",
    }, authenticatedActor);
    assert.ok(futurePackageItemId);
    assert.equal(await runtime.deleteApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: procurementGate.id,
      itemType: "deliverable",
      itemId: futurePackageItemId,
    }), true);
    await assert.rejects(
      () => packageFacade.reopenPackageGate(
        project.id,
        projectPackage.id,
        packageGate.id,
        "  ",
      ),
      /reopening reason is required/i,
    );
    await assert.rejects(
      () => accessAuthorization.withAuthorizedPackageGovernanceMutation({
        user: authenticatedActor,
        projectId: project.id,
        packageId: projectPackage.id,
        audit: {
          eventType: "gate.reopened.unauthorized_integration_test",
          resourceType: "gate",
          resourceId: packageGate.id,
        },
        operation: () => packageFacade.reopenPackageGate(
          project.id,
          projectPackage.id,
          packageGate.id,
          "An ordinary contributor must not reopen this Gate.",
        ),
      }),
      /governance authority/,
    );
    const packageReopening = await accessAuthorization.withAuthorizedPackageGovernanceMutation({
      user: authenticatedPackageLeadActor,
      projectId: project.id,
      packageId: projectPackage.id,
      audit: (result) => ({
        eventType: "gate.reopened.integration_test",
        resourceType: "gate",
        resourceId: packageGate.id,
        changeSummary: {
          reopeningReason: result.reason,
          stage: { from: result.previousStage, to: result.targetStage },
        },
        metadata: {
          reviewCycleId: result.reviewCycleId,
          reopenedAt: result.reopenedAt,
        },
      }),
      operation: () => packageFacade.reopenPackageGate(
        project.id,
        projectPackage.id,
        packageGate.id,
        "Revise the approved Tendering Deliverable baseline.",
      ),
    });
    assert.equal(packageReopening?.previousStage, "tendering");
    assert.equal(packageReopening?.targetStage, "definition");
    assert.equal(packageReopening?.entity.currentStage, "definition");
    assert.equal(
      packageReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.reapprovalRequired,
      true,
    );
    assert.equal(
      packageReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.deliverableConfigurationLocked,
      false,
    );
    assert.equal(
      packageReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.deliverableCompletionLocked,
      false,
    );
    assert.equal(
      packageReopening?.entity.gates.find((gate) => gate.id === tenderingGate.id)
        ?.deliverableConfigurationLocked,
      false,
    );
    assert.deepEqual(
      packageReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.reviewCycles,
      packageReviewCyclesBeforeReopening,
    );
    assert.equal(
      (await deliverableFacade.getGateDeliverables(
        project.id,
        projectPackage.id,
        tenderingGate.id,
      )).find((deliverable) => deliverable.id === tenderingDeliverable.id)?.status,
      "completed",
    );
    const reopenedPackageStageDeliverable = (await deliverableFacade.getGateDeliverables(
      project.id,
      projectPackage.id,
      packageGate.id,
    )).find((deliverable) => deliverable.id === packageCompletedStageDeliverable.id);
    assert.ok(reopenedPackageStageDeliverable);
    assert.equal(
      (await deliverableFacade.updateDeliverable(
        reopenedPackageStageDeliverable.id,
        { ...reopenedPackageStageDeliverable, status: "in_progress" },
      ))?.status,
      "in_progress",
    );
    assert.equal(
      (await deliverableFacade.updateDeliverable(
        reopenedPackageStageDeliverable.id,
        { ...reopenedPackageStageDeliverable, status: "completed" },
      ))?.status,
      "completed",
    );
    await assert.rejects(
      () => packageFacade.reopenPackageGate(
        project.id,
        projectPackage.id,
        packageGate.id,
        "Attempt another backward transition before renewed approval.",
      ),
      /must be formally approved before another Gate can be reopened/,
    );
    const duplicateReapprovalClient = await database.getOperationalPool().connect();
    try {
      await assert.rejects(
        () => duplicateReapprovalClient.query(
          "UPDATE gate SET reapproval_required = true WHERE id = $1",
          [tenderingGate.id],
        ),
        /gate_one_package_reapproval_required_idx|duplicate key/i,
      );
    } finally {
      duplicateReapprovalClient.release();
    }
    await actionFacade.reopenProjectAction(
      project.id,
      packageFollowUpAction.id,
      "in_progress",
      actionActor,
      null,
      authenticatedActor,
    );
    await actionFacade.closeProjectAction(
      project.id,
      packageFollowUpAction.id,
      actionActor,
      null,
      authenticatedActor,
    );
    assert.equal(
      (await packageFacade.getPackage(project.id, projectPackage.id)).gates
        .find((gate) => gate.id === packageGate.id).status,
      "not_submitted",
      "Gate Action reconciliation must not reapprove a reopened Gate.",
    );
    const revisedTenderingTitle = "Revised baselined Tendering Deliverable";
    assert.equal(
      (await deliverableFacade.updateDeliverable(
        tenderingDeliverable.id,
        { ...tenderingDeliverable, title: revisedTenderingTitle, status: "completed" },
      ))?.title,
      revisedTenderingTitle,
    );
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: tenderingGate.id,
      itemType: "deliverable",
      itemId: tenderingDeliverable.id,
      applicability: "not_applicable",
      justification: "Removed from the revised Tendering baseline.",
    }, authenticatedPackageLeadActor));
    const revisedCustomTenderingItemId = await runtime.createApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: tenderingGate.id,
      itemType: "deliverable",
      title: "Revised custom Tendering Deliverable",
    }, authenticatedPackageLeadActor);
    assert.ok(revisedCustomTenderingItemId);
    for (const obsoleteApprover of [
      packageSecondApprover,
      packageLockedApprover,
      packageHourlyLimitedApprover,
    ]) {
      assert.equal(await packageFacade.deletePackageGateApprover(
        project.id,
        projectPackage.id,
        packageGate.id,
        obsoleteApprover.id,
      ), true);
    }
    assert.equal(
      (await runtime.confirmGateMatrixReview(
        project.id,
        projectPackage.id,
        packageGate.id,
        authenticatedPackageLeadActor,
      )).effectiveStatus,
      "confirmed",
    );
    const renewedPackageSubmission = await packageFacade.submitPackageGateForApproval(
      project.id,
      projectPackage.id,
      packageGate.id,
      {
        userId: authenticatedPackageLeadActor.id,
        displayName: authenticatedPackageLeadActor.displayName,
        email: authenticatedPackageLeadActor.email,
        providerTenantId: authenticatedPackageLeadActor.providerTenantId,
        providerObjectId: authenticatedPackageLeadActor.providerObjectId,
      },
    );
    assert.equal(renewedPackageSubmission?.outcome, "submitted");
    assert.equal(
      renewedPackageSubmission.reviewCycle.previousCycleId,
      packageReconciliationCycleId,
    );
    assert.equal(
      (await packageFacade.getPackage(project.id, projectPackage.id)).gates
        .find((gate) => gate.id === packageGate.id).deliverableCompletionLocked,
      true,
    );
    const resubmittedPackage = await packageFacade.getPackage(project.id, projectPackage.id);
    assert.equal(
      resubmittedPackage.gates.find((gate) => gate.id === packageGate.id)
        .deliverableConfigurationLocked,
      true,
    );
    assert.equal(
      resubmittedPackage.gates.find((gate) => gate.id === tenderingGate.id)
        .deliverableConfigurationLocked,
      true,
    );
    assert.equal(
      resubmittedPackage.gates.find((gate) => gate.id === tenderingGate.id)
        .deliverableCompletionLocked,
      false,
    );
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: tenderingGate.id,
        itemType: "deliverable",
        itemId: tenderingDeliverable.id,
        applicability: "applicable",
        justification: "",
      }, authenticatedPackageLeadActor),
      /protected by a submitted or approved Gate/,
    );
    assert.equal(
      renewedPackageSubmission.reviewCycle.frozenEvidence.applicabilityMatrix?.gates
        .flatMap((matrixGate) => matrixGate.items)
        .find((item) => item.itemId === tenderingDeliverable.id)?.title,
      revisedTenderingTitle,
    );
    const renewedPackageApprover = renewedPackageSubmission.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === packageApprover.id,
    );
    assert.ok(renewedPackageApprover?.reviewAccessId);
    const renewedPackageSession = await issueOtpSession(
      renewedPackageApprover.reviewAccessId,
    );
    const renewedPackageApproval = await runtime.recordOtpGateReviewResponse({
      reviewAccessId: renewedPackageApprover.reviewAccessId,
      sessionToken: renewedPackageSession.verification.sessionToken,
      outcome: "approved",
      comment: "Approve the revised Tendering baseline.",
    });
    assert.equal(renewedPackageApproval?.outcome, "recorded");
    assert.equal(renewedPackageApproval.completion, "approved");
    assert.equal(renewedPackageApproval.entity.currentStage, "tendering");
    assert.equal(
      renewedPackageApproval.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.reapprovalRequired,
      false,
    );
    assert.equal(
      renewedPackageApproval.entity.gates.find((gate) => gate.id === tenderingGate.id)
        ?.deliverableConfigurationLocked,
      true,
    );
    await assert.rejects(
      () => runtime.deleteApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: tenderingGate.id,
        itemType: "deliverable",
        itemId: revisedCustomTenderingItemId,
      }),
      /protected by a submitted or approved Gate/,
    );
    for (const historicalCycle of packageReviewCyclesBeforeReopening) {
      assert.deepEqual(
        renewedPackageApproval.entity.gates.find((gate) => gate.id === packageGate.id)
          ?.reviewCycles.find((cycle) => cycle.id === historicalCycle.id),
        historicalCycle,
      );
    }
    const nonImmediateGateClient = await database.getOperationalPool().connect();
    try {
      await nonImmediateGateClient.query(
        "UPDATE project_package SET current_stage = 'procurement' WHERE id = $1",
        [projectPackage.id],
      );
      await nonImmediateGateClient.query(
        "UPDATE gate SET status = 'approved' WHERE id = $1",
        [tenderingGate.id],
      );
      await assert.rejects(
        () => packageFacade.reopenPackageGate(
          project.id,
          projectPackage.id,
          packageGate.id,
          "Attempt to bypass the immediately preceding Gate.",
        ),
        /Only the immediately preceding approved Gate/,
      );
    } finally {
      await nonImmediateGateClient.query(
        "UPDATE project_package SET current_stage = 'tendering' WHERE id = $1",
        [projectPackage.id],
      );
      await nonImmediateGateClient.query(
        "UPDATE gate SET status = 'not_submitted' WHERE id = $1",
        [tenderingGate.id],
      );
      nonImmediateGateClient.release();
    }
    const definitionCyclesBeforeTenderingReopening = structuredClone(
      (await packageFacade.getPackage(project.id, projectPackage.id)).gates
        .find((gate) => gate.id === packageGate.id).reviewCycles,
    );
    const tenderingApprovalCycleId = randomUUID();
    const tenderingApprovalFixtureClient = await database.getOperationalPool().connect();
    try {
      const insertedCycle = await tenderingApprovalFixtureClient.query(
        `INSERT INTO gate_review_cycle (
           id, gate_id, schema_version, cycle_number, previous_cycle_id,
           project_snapshot, package_snapshot, gate_snapshot, status,
           submitted_at, submitted_by, decision, decision_comments,
           completed_at, frozen_evidence
         )
         SELECT $1, $2, schema_version, 1, NULL,
                project_snapshot, package_snapshot,
                jsonb_build_object(
                  'id', $2::text,
                  'name', $3::text,
                  'stageId', 'tendering',
                  'stageLabel', 'Tendering'
                ),
                'approved', now(), submitted_by, 'approved',
                'Tendering completed-Stage reopening fixture.', now(), frozen_evidence
         FROM gate_review_cycle
         WHERE id = $4
         RETURNING id`,
        [
          tenderingApprovalCycleId,
          tenderingGate.id,
          tenderingGate.name,
          renewedPackageSubmission.reviewCycle.id,
        ],
      );
      assert.equal(insertedCycle.rowCount, 1);
      await tenderingApprovalFixtureClient.query(
        "UPDATE gate SET status = 'approved' WHERE id = $1",
        [tenderingGate.id],
      );
      await tenderingApprovalFixtureClient.query(
        "UPDATE project_package SET current_stage = 'procurement' WHERE id = $1",
        [projectPackage.id],
      );
    } finally {
      tenderingApprovalFixtureClient.release();
    }
    const tenderingReopening = await packageFacade.reopenPackageGate(
      project.id,
      projectPackage.id,
      tenderingGate.id,
      "Revise Tendering completion evidence after progressing to Procurement.",
    );
    assert.equal(tenderingReopening?.previousStage, "procurement");
    assert.equal(tenderingReopening?.targetStage, "tendering");
    assert.equal(tenderingReopening?.entity.currentStage, "tendering");
    assert.equal(
      tenderingReopening?.entity.gates.find((gate) => gate.id === tenderingGate.id)
        ?.reapprovalRequired,
      true,
    );
    assert.equal(
      tenderingReopening?.entity.gates.find((gate) => gate.id === tenderingGate.id)
        ?.deliverableConfigurationLocked,
      false,
      "The exact reopened Stage must override its preceding approved configuration baseline.",
    );
    assert.equal(
      tenderingReopening?.entity.gates.find((gate) => gate.id === tenderingGate.id)
        ?.deliverableCompletionLocked,
      false,
    );
    assert.equal(
      tenderingReopening?.entity.gates.find((gate) => gate.id === procurementGate.id)
        ?.deliverableConfigurationLocked,
      false,
    );
    assert.equal(
      tenderingReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.deliverableConfigurationLocked,
      true,
      "The earlier approved Definition Stage must remain protected.",
    );
    assert.equal(
      tenderingReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.deliverableCompletionLocked,
      true,
    );
    assert.deepEqual(
      tenderingReopening?.entity.gates.find((gate) => gate.id === packageGate.id)
        ?.reviewCycles,
      definitionCyclesBeforeTenderingReopening,
    );
    assert.ok(await runtime.updateApplicabilityItem({
      projectId: project.id,
      packageId: projectPackage.id,
      gateId: tenderingGate.id,
      itemType: "deliverable",
      itemId: tenderingDeliverable.id,
      applicability: "applicable",
      justification: "",
    }, authenticatedPackageLeadActor));
    assert.equal(
      (await deliverableFacade.updateDeliverable(
        tenderingDeliverable.id,
        { ...tenderingDeliverable, status: "in_progress" },
      ))?.status,
      "in_progress",
    );
    await assert.rejects(
      () => runtime.updateApplicabilityItem({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: packageGate.id,
        itemType: "deliverable",
        itemId: packageCompletedStageDeliverable.id,
        applicability: "not_applicable",
        justification: "An unrelated earlier Stage must remain protected.",
      }, authenticatedPackageLeadActor),
      /protected by a submitted or approved Gate/,
    );
    const reopeningAuditClient = await database.getOperationalPool().connect();
    let reopeningAudit;
    try {
      reopeningAudit = await reopeningAuditClient.query(
        `SELECT actor_user_id::text, change_summary, metadata
         FROM audit_event
         WHERE event_type = 'gate.reopened.integration_test'
           AND resource_id = $1`,
        [packageGate.id],
      );
    } finally {
      reopeningAuditClient.release();
    }
    assert.equal(reopeningAudit.rows[0]?.actor_user_id, authenticatedPackageLeadActor.id);
    assert.equal(
      reopeningAudit.rows[0]?.change_summary.reopeningReason,
      "Revise the approved Tendering Deliverable baseline.",
    );
    assert.equal(reopeningAudit.rows[0]?.change_summary.stage.from, "tendering");
    assert.equal(reopeningAudit.rows[0]?.change_summary.stage.to, "definition");
    await verifyOptionalValidationGateReopening({
      database,
      projectFacade,
      sourceReviewCycleId: packageReconciliationCycleId,
    });
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
    }, testOwnerUserId);
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

async function verifyOptionalValidationGateReopening({
  database,
  projectFacade,
  sourceReviewCycleId,
}) {
  const project = await projectFacade.createProject({
    projectNumber: `runtime-validation-${Date.now()}`,
    name: "Optional Validation reopening verification",
    description: "Disposable active-lifecycle ordering fixture.",
    projectManager: "Integration Test",
    customer: "Test Customer",
    reportsTo: "Test Sponsor",
    siteLocation: "Test Site",
    plannedStartDate: "",
    plannedCompletionDate: "",
    validationRequired: true,
    currentStage: "initiation",
  }, testOwnerUserId);
  const validationGate = project.gates.find((gate) => gate.stageId === "validation");
  const closureGate = project.gates.find((gate) => gate.stageId === "closure");
  assert.ok(validationGate);
  assert.ok(closureGate);
  const validationCycleId = randomUUID();
  const client = await database.getOperationalPool().connect();
  try {
    const cycleInsert = await client.query(
      `INSERT INTO gate_review_cycle (
         id, gate_id, schema_version, cycle_number, previous_cycle_id,
         project_snapshot, package_snapshot, gate_snapshot, status,
         submitted_at, submitted_by, decision, decision_comments,
         completed_at, frozen_evidence
       )
       SELECT $1, $2, schema_version, 1, NULL,
              jsonb_build_object(
                'id', $3::text,
                'projectNumber', $4::text,
                'name', $5::text
              ),
              NULL,
              jsonb_build_object(
                'id', $2::text,
                'name', $6::text,
                'stageId', 'validation',
                'stageLabel', 'Validation'
              ),
              'approved', now(), submitted_by, 'approved',
              'Optional Validation fixture approval.', now(), frozen_evidence
       FROM gate_review_cycle
       WHERE id = $7
       RETURNING id`,
      [
        validationCycleId,
        validationGate.id,
        project.id,
        project.projectNumber,
        project.name,
        validationGate.name,
        sourceReviewCycleId,
      ],
    );
    assert.equal(cycleInsert.rowCount, 1);
    await client.query(
      "UPDATE gate SET status = 'approved' WHERE id = $1",
      [validationGate.id],
    );
    await client.query(
      "UPDATE project SET current_stage = 'closure' WHERE id = $1",
      [project.id],
    );
    await client.query(
      "UPDATE gate SET status = 'submitted_for_approval' WHERE id = $1",
      [closureGate.id],
    );
  } finally {
    client.release();
  }
  const submittedClosureProject = await projectFacade.getProject(project.id);
  assert.equal(
    submittedClosureProject.gates.find((gate) => gate.id === validationGate.id)
      .deliverableConfigurationLocked,
    true,
  );
  assert.equal(
    submittedClosureProject.gates.find((gate) => gate.id === validationGate.id)
      .deliverableCompletionLocked,
    true,
  );
  assert.equal(
    submittedClosureProject.gates.find((gate) => gate.id === closureGate.id)
      .deliverableConfigurationLocked,
    true,
  );
  assert.equal(
    submittedClosureProject.gates.find((gate) => gate.id === closureGate.id)
      .deliverableCompletionLocked,
    true,
  );

  await assert.rejects(
    () => projectFacade.reopenProjectGate(
      project.id,
      validationGate.id,
      "Current Stage governance must block reopening.",
    ),
    /current Stage already has an active or approved Gate Review/i,
  );
  const restoreClient = await database.getOperationalPool().connect();
  try {
    await restoreClient.query(
      "UPDATE gate SET status = 'not_submitted' WHERE id = $1",
      [closureGate.id],
    );
  } finally {
    restoreClient.release();
  }
  const withdrawnClosureProject = await projectFacade.getProject(project.id);
  assert.equal(
    withdrawnClosureProject.gates.find((gate) => gate.id === closureGate.id)
      .deliverableConfigurationLocked,
    true,
  );
  assert.equal(
    withdrawnClosureProject.gates.find((gate) => gate.id === closureGate.id)
      .deliverableCompletionLocked,
    false,
  );
  const reopening = await projectFacade.reopenProjectGate(
    project.id,
    validationGate.id,
    "Repeat Validation before Project closure.",
  );
  assert.equal(reopening?.previousStage, "closure");
  assert.equal(reopening?.targetStage, "validation");
  assert.equal(reopening?.entity.currentStage, "validation");
  assert.equal(
    reopening?.entity.gates.find((gate) => gate.id === validationGate.id)
      ?.reapprovalRequired,
    true,
  );
  assert.equal(
    reopening?.entity.gates.find((gate) => gate.id === validationGate.id)
      ?.deliverableConfigurationLocked,
    false,
  );
  assert.equal(
    reopening?.entity.gates.find((gate) => gate.id === validationGate.id)
      ?.deliverableCompletionLocked,
    false,
  );
  assert.equal(
    reopening?.entity.gates.find((gate) => gate.id === closureGate.id)
      ?.deliverableConfigurationLocked,
    false,
  );
  assert.equal(await projectFacade.deleteProject(project.id), true);
}

function withInactiveLegacyCriteria(scope) {
  return {
    ...scope,
    gates: scope.gates.map((gate) => ({ ...gate, criteria: [] })),
  };
}

async function assertScopeOperationIsReadOnly({
  database,
  projectId,
  packageId,
  label,
  operation,
}) {
  const before = await loadScopeMutationState(database, projectId, packageId);
  await operation();
  assert.deepEqual(
    await loadScopeMutationState(database, projectId, packageId),
    before,
    `${label} must not modify PostgreSQL rows.`,
  );
}

async function loadScopeMutationState(database, projectId, packageId) {
  const client = await database.getOperationalPool().connect();
  try {
    const scope = packageId
      ? await client.query(
          `SELECT package.id, package.xmin::text AS row_version,
                  md5(to_jsonb(package)::text) AS logical_fingerprint
           FROM project_package AS package
           WHERE package.project_id = $1 AND package.id = $2`,
          [projectId, packageId],
        )
      : await client.query(
          `SELECT project.id, project.xmin::text AS row_version,
                  md5(to_jsonb(project)::text) AS logical_fingerprint
           FROM project
           WHERE project.id = $1`,
          [projectId],
        );
    const gates = await client.query(
      `SELECT gate.id, gate.template_version, gate.xmin::text AS row_version,
              md5(to_jsonb(gate)::text) AS logical_fingerprint
       FROM gate
       WHERE gate.project_id = $1
         AND gate.package_id IS NOT DISTINCT FROM $2::text
       ORDER BY gate.sequence, gate.id`,
      [projectId, packageId],
    );
    const deliverables = await client.query(
      `SELECT deliverable.id, deliverable.template_version,
              deliverable.updated_at,
              deliverable.xmin::text AS row_version,
              md5(to_jsonb(deliverable)::text) AS logical_fingerprint
       FROM deliverable
       WHERE deliverable.project_id = $1
         AND deliverable.package_id IS NOT DISTINCT FROM $2::text
       ORDER BY deliverable.gate_id, deliverable.sequence, deliverable.id`,
      [projectId, packageId],
    );
    const reviewCycles = await client.query(
      `SELECT cycle.id, cycle.xmin::text AS row_version,
              md5(to_jsonb(cycle)::text) AS logical_fingerprint,
              md5(cycle.frozen_evidence::text) AS frozen_evidence_fingerprint
       FROM gate_review_cycle AS cycle
       JOIN gate ON gate.id = cycle.gate_id
       WHERE gate.project_id = $1
         AND gate.package_id IS NOT DISTINCT FROM $2::text
       ORDER BY cycle.id`,
      [projectId, packageId],
    );
    const matrixConfirmations = await client.query(
      `SELECT confirmation.gate_id,
              confirmation.xmin::text AS row_version,
              md5(to_jsonb(confirmation)::text) AS logical_fingerprint
       FROM gate_matrix_review_confirmation AS confirmation
       JOIN gate ON gate.id = confirmation.gate_id
       WHERE gate.project_id = $1
         AND gate.package_id IS NOT DISTINCT FROM $2::text
       ORDER BY confirmation.gate_id`,
      [projectId, packageId],
    );
    const auditEvents = await client.query(
      `SELECT audit_event.id, audit_event.xmin::text AS row_version,
              md5(to_jsonb(audit_event)::text) AS logical_fingerprint
       FROM audit_event
       WHERE audit_event.project_id = $1
       ORDER BY audit_event.id`,
      [projectId],
    );
    const applicabilityChanges = await client.query(
      `SELECT applicability_change.id,
              applicability_change.xmin::text AS row_version,
              md5(to_jsonb(applicability_change)::text) AS logical_fingerprint
       FROM applicability_change
       WHERE applicability_change.project_id = $1
         AND applicability_change.package_id IS NOT DISTINCT FROM $2::text
       ORDER BY applicability_change.id`,
      [projectId, packageId],
    );
    return {
      scope: scope.rows,
      gates: gates.rows,
      deliverables: deliverables.rows,
      reviewCycles: reviewCycles.rows,
      matrixConfirmations: matrixConfirmations.rows,
      auditEvents: auditEvents.rows,
      applicabilityChanges: applicabilityChanges.rows,
    };
  } finally {
    client.release();
  }
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
      path.join(temporaryDirectory, "023_transaction_rollback_test.sql"),
      "CREATE TABLE migration_rollback_probe (id integer);\nSELECT * FROM missing_migration_relation;\n",
      "utf8",
    );
    await assert.rejects(
      () => runMigrations({ connectionString, migrationsDirectory: temporaryDirectory, logger }),
      /Failed to apply 023_transaction_rollback_test.sql/,
    );
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(
        "SELECT to_regclass('public.migration_rollback_probe') AS relation",
      );
      assert.equal(result.rows[0].relation, null);
      const ledger = await client.query(
        "SELECT 1 FROM identity_schema_migration WHERE name = '023_transaction_rollback_test.sql'",
      );
      assert.equal(ledger.rowCount, 0);
    } finally {
      await client.end();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function verifyAuthorizedActionRegister({
  accessAuthorization,
  actionFacade,
  actionRegister,
  database,
  projectId,
  packageId,
  otherPackageId,
  projectGateId,
  owner,
}) {
  const userFixtures = [
    ["20000000-0000-4000-8000-000000000011", "Overall Actions Reader"],
    ["20000000-0000-4000-8000-000000000012", "Entire Project Actions Reader"],
    ["20000000-0000-4000-8000-000000000013", "Package Actions Reader"],
    ["20000000-0000-4000-8000-000000000014", "Package Actions Editor"],
    ["20000000-0000-4000-8000-000000000015", "Action Scope Mover"],
  ];
  const client = await database.getOperationalPool().connect();
  try {
    for (const [index, [userId, displayName]] of userFixtures.entries()) {
      const suffix = index + 11;
      const email = `action-register-${suffix}@example.invalid`;
      await client.query(
        `INSERT INTO app_user (
           id, display_name, email, normalized_email, email_verified, status,
           access_class, created_at, updated_at
         ) VALUES ($1, $2, $3, $3, true, 'active', 'internal', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           status = 'active', access_class = 'internal', email_verified = true,
           updated_at = now()`,
        [userId, displayName, email],
      );
      await client.query(
        `INSERT INTO user_identity (
           id, provider, provider_object_id, user_id, provider_tenant_id,
           provider_subject, provider_email_snapshot, entra_account_type,
           last_authenticated_at, created_at, updated_at
         ) VALUES ($1, 'microsoft', $2, $3, $4, $5, $6, 0, now(), now(), now())
         ON CONFLICT (provider, provider_object_id) DO UPDATE SET
           user_id = EXCLUDED.user_id, last_authenticated_at = now(), updated_at = now()`,
        [
          `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
          `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
          userId,
          testTenantId,
          `action-register-subject-${suffix}`,
          email,
        ],
      );
    }
  } finally {
    client.release();
  }

  const users = userFixtures.map(([id, displayName], index) => ({
    ...owner,
    id,
    displayName,
    email: `action-register-${index + 11}@example.invalid`,
    normalizedEmail: `action-register-${index + 11}@example.invalid`,
    providerObjectId: `30000000-0000-4000-8000-${String(index + 11).padStart(12, "0")}`,
  }));
  const [overallReader, entireReader, packageReader, packageEditor, scopeMover] = users;
  const actionActor = { userId: owner.id, displayName: owner.displayName };
  const frozenBefore = await accessManagementHistoricalFingerprint(
    database.getOperationalPool(),
  );

  const grantClient = await database.getOperationalPool().connect();
  let packageReaderGrantId;
  let moverDestinationGrantId;
  try {
    const insertGrant = async ({
      userId,
      scopeType,
      targetPackageId = null,
      permission,
      authorityRole = "collaborator",
    }) => {
      const grant = await grantClient.query(
        `INSERT INTO access_grant (
           project_id, user_id, scope_type, package_id, authority_role,
           created_by_user_id, updated_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id::text`,
        [projectId, userId, scopeType, targetPackageId, authorityRole, owner.id],
      );
      await grantClient.query(
        `INSERT INTO access_grant_permission (
           grant_id, module, permission, created_by_user_id, updated_by_user_id
         ) VALUES ($1, 'actions', $2, $3, $3)`,
        [grant.rows[0].id, permission, owner.id],
      );
      return grant.rows[0].id;
    };

    await insertGrant({
      userId: overallReader.id,
      scopeType: "overall_project",
      permission: "read",
    });
    await insertGrant({
      userId: entireReader.id,
      scopeType: "entire_project",
      permission: "read",
    });
    packageReaderGrantId = await insertGrant({
      userId: packageReader.id,
      scopeType: "specific_package",
      targetPackageId: packageId,
      permission: "read",
    });
    await insertGrant({
      userId: packageEditor.id,
      scopeType: "specific_package",
      targetPackageId: packageId,
      permission: "read_write",
      authorityRole: "package_lead",
    });
    await insertGrant({
      userId: scopeMover.id,
      scopeType: "specific_package",
      targetPackageId: packageId,
      permission: "read_write",
    });
    moverDestinationGrantId = await insertGrant({
      userId: scopeMover.id,
      scopeType: "specific_package",
      targetPackageId: otherPackageId,
      permission: "read",
    });
  } finally {
    grantClient.release();
  }

  const overallAction = await actionFacade.createManualProjectAction(
    projectId,
    {
      description: "Authorized Overall Action",
      assignee: "Overall Assignee",
      dueDate: "2026-11-01",
      status: "new",
      priority: "low",
      packageIds: [],
      governanceTierId: null,
      gateId: null,
      initialUpdate: null,
    },
    actionActor,
  );
  const packageAction = await actionFacade.createManualProjectAction(
    projectId,
    {
      description: "Authorized Package A Action",
      assignee: "Package A Assignee",
      dueDate: "2026-11-02",
      status: "new",
      priority: "medium",
      packageIds: [packageId],
      governanceTierId: null,
      gateId: null,
      initialUpdate: null,
    },
    actionActor,
  );
  const otherPackageAction = await actionFacade.createManualProjectAction(
    projectId,
    {
      description: "Unauthorized Package B Action",
      assignee: "Package B Assignee",
      dueDate: "2026-11-03",
      status: "new",
      priority: "high",
      packageIds: [otherPackageId],
      governanceTierId: null,
      gateId: null,
      initialUpdate: null,
    },
    actionActor,
  );
  await assert.rejects(
    () => actionFacade.createManualProjectAction(
      projectId,
      {
        description: "Invalid multi-Package Action",
        assignee: "Invalid",
        dueDate: null,
        status: "new",
        priority: null,
        packageIds: [packageId, otherPackageId],
        governanceTierId: null,
        gateId: null,
        initialUpdate: null,
      },
      actionActor,
    ),
    /at most one Package/,
  );

  const ownerView = await actionRegister.getActionRegisterView(owner, projectId, null);
  assert.ok(ownerView.actions.some((action) => action.id === overallAction.id));
  assert.ok(ownerView.actions.some((action) => action.id === packageAction.id));
  assert.ok(ownerView.actions.some((action) => action.id === otherPackageAction.id));
  assert.equal(ownerView.canWriteOverall, true);
  assert.ok(ownerView.packages.every((projectPackage) =>
    projectPackage.permission === "read_write"));

  const overallView = await actionRegister.getActionRegisterView(
    overallReader,
    projectId,
    null,
  );
  assert.equal(overallView.canReadOverall, true);
  assert.deepEqual(overallView.packages, []);
  assert.equal(overallView.actions.some((action) => action.id === overallAction.id), true);
  assert.equal(overallView.actions.some((action) => action.id === packageAction.id), false);
  assert.equal(overallView.actions.some((action) =>
    action.description.includes("Unauthorized Package B")), false);

  const entireView = await actionRegister.getActionRegisterView(
    entireReader,
    projectId,
    null,
  );
  assert.equal(entireView.canReadOverall, true);
  assert.ok(entireView.packages.some((entry) => entry.id === packageId));
  assert.ok(entireView.packages.some((entry) => entry.id === otherPackageId));
  assert.ok(entireView.actions.some((action) => action.id === overallAction.id));
  assert.ok(entireView.actions.some((action) => action.id === packageAction.id));
  assert.ok(entireView.actions.some((action) => action.id === otherPackageAction.id));
  assert.ok(entireView.actions.every((action) => action.canWrite === false));

  const packageProjectView = await actionRegister.getActionRegisterView(
    packageReader,
    projectId,
    null,
  );
  assert.equal(packageProjectView.canReadOverall, false);
  assert.deepEqual(packageProjectView.packages.map((entry) => entry.id), [packageId]);
  assert.deepEqual(packageProjectView.actions.map((action) => action.id), [packageAction.id]);
  assert.equal(packageProjectView.actions[0].canWrite, false);
  const fixedPackageView = await actionRegister.getActionRegisterView(
    packageReader,
    projectId,
    packageId,
  );
  assert.equal(fixedPackageView.fixedPackage.id, packageId);
  assert.deepEqual(fixedPackageView.actions.map((action) => action.id), [packageAction.id]);
  assert.equal(
    await actionRegister.getActionRegisterView(packageReader, projectId, otherPackageId),
    null,
  );
  assert.equal(
    await actionRegister.getAuthorizedProjectAction(
      packageReader,
      projectId,
      otherPackageAction.id,
    ),
    null,
  );

  await assert.rejects(
    () => actionRegister.withAuthorizedActionMutation({
      user: packageReader,
      projectId,
      actionId: packageAction.id,
      fixedPackageId: packageId,
      audit: {
        eventType: "action.integration_read_only_bypass",
        resourceType: "action",
        resourceId: packageAction.id,
      },
      operation: () => actionFacade.addProjectActionUpdate(
        projectId,
        packageAction.id,
        "Must not be written",
        { userId: packageReader.id, displayName: packageReader.displayName },
      ),
    }),
    /do not have permission/,
  );

  const commented = await actionRegister.withAuthorizedActionMutation({
    user: packageEditor,
    projectId,
    actionId: packageAction.id,
    fixedPackageId: packageId,
    audit: {
      eventType: "action.integration_comment",
      resourceType: "action",
      resourceId: packageAction.id,
    },
    operation: () => actionFacade.addProjectActionUpdate(
      projectId,
      packageAction.id,
      "Authorized Package comment",
      { userId: packageEditor.id, displayName: packageEditor.displayName },
    ),
  });
  assert.equal(commented.updates.at(-1).text, "Authorized Package comment");

  const moveInput = (action, targetPackageId) => ({
    description: action.description,
    assignee: action.assignee,
    dueDate: action.dueDate,
    status: action.status,
    priority: action.priority,
    packageIds: targetPackageId ? [targetPackageId] : [],
    governanceTierId: action.governanceTierId,
    gateId: action.gateId,
    initialUpdate: null,
  });
  await assert.rejects(
    () => actionRegister.withAuthorizedActionMutation({
      user: packageEditor,
      projectId,
      actionId: packageAction.id,
      fixedPackageId: packageId,
      destinationPackageId: null,
      audit: {
        eventType: "action.integration_fixed_scope_bypass",
        resourceType: "action",
        resourceId: packageAction.id,
      },
      operation: () => actionFacade.updateProjectAction(
        projectId,
        packageAction.id,
        moveInput(packageAction, null),
        { userId: packageEditor.id, displayName: packageEditor.displayName },
      ),
    }),
    /fixed Package Action scope/,
  );
  await assert.rejects(
    () => actionRegister.withAuthorizedActionMutation({
      user: scopeMover,
      projectId,
      actionId: packageAction.id,
      destinationPackageId: otherPackageId,
      audit: {
        eventType: "action.integration_scope_move",
        resourceType: "action",
        resourceId: packageAction.id,
      },
      operation: () => actionFacade.updateProjectAction(
        projectId,
        packageAction.id,
        moveInput(packageAction, otherPackageId),
        { userId: scopeMover.id, displayName: scopeMover.displayName },
      ),
    }),
    /do not have permission/,
  );
  assert.deepEqual(
    (await actionFacade.getProjectAction(projectId, packageAction.id)).packageIds,
    [packageId],
  );

  const permissionClient = await database.getOperationalPool().connect();
  try {
    await permissionClient.query(
      `UPDATE access_grant_permission
       SET permission = 'read_write', updated_by_user_id = $2, updated_at = now()
       WHERE grant_id = $1 AND module = 'actions'`,
      [moverDestinationGrantId, owner.id],
    );
  } finally {
    permissionClient.release();
  }
  const moved = await actionRegister.withAuthorizedActionMutation({
    user: scopeMover,
    projectId,
    actionId: packageAction.id,
    destinationPackageId: otherPackageId,
    audit: {
      eventType: "action.integration_scope_move",
      resourceType: "action",
      resourceId: packageAction.id,
    },
    operation: () => actionFacade.updateProjectAction(
      projectId,
      packageAction.id,
      moveInput(packageAction, otherPackageId),
      { userId: scopeMover.id, displayName: scopeMover.displayName },
    ),
  });
  assert.deepEqual(moved.packageIds, [otherPackageId]);
  await actionRegister.withAuthorizedActionMutation({
    user: owner,
    projectId,
    actionId: packageAction.id,
    destinationPackageId: packageId,
    audit: {
      eventType: "action.integration_owner_scope_move",
      resourceType: "action",
      resourceId: packageAction.id,
    },
    operation: () => actionFacade.updateProjectAction(
      projectId,
      packageAction.id,
      moveInput(moved, packageId),
      { userId: owner.id, displayName: owner.displayName },
    ),
  });

  const gateAction = await actionRegister.withAuthorizedActionCreation({
    user: owner,
    projectId,
    packageId: null,
    audit: (action) => ({
      eventType: "action.integration_gate_created",
      resourceType: "action",
      resourceId: action.id,
    }),
    operation: () => actionFacade.createGateProjectAction(
      projectId,
      projectGateId,
      [],
      true,
      {
        description: "Authorization Gate Action",
        assignee: "Gate Assignee",
        dueDate: "2026-11-04",
        priority: "high",
        initialUpdate: null,
      },
      actionActor,
    ),
  });
  let deniedGateCreationRan = false;
  await assert.rejects(
    () => actionRegister.withAuthorizedActionCreation({
      user: overallReader,
      projectId,
      packageId: null,
      audit: {
        eventType: "action.integration_gate_creation_bypass",
        resourceType: "action",
        resourceId: "denied",
      },
      operation: async () => {
        deniedGateCreationRan = true;
        return gateAction;
      },
    }),
    /do not have permission/,
  );
  assert.equal(deniedGateCreationRan, false);
  const authorizedGateView = await actionRegister.getAuthorizedGateActionView({
    user: overallReader,
    projectId,
    packageId: null,
    gateId: projectGateId,
    legacyPermission: "read_write",
  });
  assert.equal(authorizedGateView.permission, "read");
  assert.ok(authorizedGateView.actions.some((action) => action.id === gateAction.id));
  await assert.rejects(
    () => actionRegister.withAuthorizedActionMutation({
      user: owner,
      projectId,
      actionId: gateAction.id,
      destinationPackageId: packageId,
      audit: {
        eventType: "action.integration_gate_scope_bypass",
        resourceType: "action",
        resourceId: gateAction.id,
      },
      operation: () => actionFacade.updateProjectAction(
        projectId,
        gateAction.id,
        moveInput(gateAction, packageId),
        actionActor,
      ),
    }),
    /scope is fixed by its Gate/,
  );
  assert.deepEqual(
    (await actionFacade.getProjectAction(projectId, gateAction.id)).packageIds,
    [],
  );
  assert.deepEqual(await actionFacade.deleteProjectAction(projectId, gateAction.id), {
    deleted: true,
  });

  const revocationClient = await database.getOperationalPool().connect();
  try {
    await revocationClient.query(
      `UPDATE access_grant
       SET revoked_at = now(), revoked_by_user_id = $2,
           updated_by_user_id = $2, updated_at = now()
       WHERE id = $1`,
      [packageReaderGrantId, owner.id],
    );
  } finally {
    revocationClient.release();
  }
  assert.equal(
    await actionRegister.getActionRegisterView(packageReader, projectId, packageId),
    null,
  );
  await assert.rejects(
    () => actionRegister.withAuthorizedActionMutation({
      user: packageReader,
      projectId,
      actionId: packageAction.id,
      audit: {
        eventType: "action.integration_revoked_bypass",
        resourceType: "action",
        resourceId: packageAction.id,
      },
      operation: () => true,
    }),
    /do not have permission/,
  );

  const navigation = await actionRegister.getAuthorizedActionNavigation(packageEditor);
  const projectNavigation = navigation.find((entry) => entry.projectId === projectId);
  assert.equal(projectNavigation.canOpenProjectRegister, false);
  assert.deepEqual(projectNavigation.packages.map((entry) => entry.id), [packageId]);
  assert.equal(
    await actionRegister.getActionRegisterView(packageEditor, "missing-project", null),
    null,
  );
  assert.equal(await accessAuthorization.getEffectiveAccessPermission({
    user: owner,
    projectId,
    packageId: otherPackageId,
    module: "actions",
  }), "read_write");
  assert.deepEqual(
    await accessManagementHistoricalFingerprint(database.getOperationalPool()),
    frozenBefore,
  );
}

async function verifyInternalAccessManagement({
  accessAuthorization,
  accessManagement,
  database,
  projectId,
  packageId,
  otherPackageId,
  owner,
  accessManager,
}) {
  const users = [
    ["20000000-0000-4000-8000-000000000007", "Collaborator One", false, true],
    ["20000000-0000-4000-8000-000000000008", "Collaborator Two", true, true],
    ["20000000-0000-4000-8000-000000000009", "Incomplete Sign-in", false, false],
    ["20000000-0000-4000-8000-000000000010", "Second Access Manager", true, true],
  ];
  const client = await database.getOperationalPool().connect();
  try {
    for (const [index, [userId, displayName, emailVerified, completedSignIn]] of users.entries()) {
      const email = `access-management-${index + 7}@example.invalid`;
      await client.query(
        `INSERT INTO app_user (
           id, display_name, email, normalized_email, email_verified, status,
           access_class, last_authenticated_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $3, $4, 'active', 'internal',
           CASE WHEN $5::boolean THEN now() ELSE NULL END, now(), now())
         ON CONFLICT (id) DO UPDATE SET
            email_verified = EXCLUDED.email_verified, status = 'active',
            access_class = 'internal',
            last_authenticated_at = EXCLUDED.last_authenticated_at,
            updated_at = now()`,
        [userId, displayName, email, emailVerified, completedSignIn],
      );
      await client.query(
        `INSERT INTO user_identity (
           id, provider, provider_object_id, user_id, provider_tenant_id,
            provider_subject, provider_email_snapshot, entra_account_type,
            last_authenticated_at, created_at, updated_at
         ) VALUES ($1, 'microsoft', $2, $3, $4, $5, $6, 0, now(), now(), now())
         ON CONFLICT (provider, provider_object_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            last_authenticated_at = now(),
            updated_at = now()`,
        [
          `40000000-0000-4000-8000-${String(index + 7).padStart(12, "0")}`,
          `30000000-0000-4000-8000-${String(index + 7).padStart(12, "0")}`,
          userId,
          testTenantId,
          `access-management-subject-${index + 7}`,
          email,
        ],
      );
    }
  } finally {
    client.release();
  }

  const collaboratorOne = {
    ...owner,
    id: users[0][0],
    displayName: users[0][1],
    email: "access-management-7@example.invalid",
    normalizedEmail: "access-management-7@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000007",
  };
  const collaboratorTwo = {
    ...owner,
    id: users[1][0],
    displayName: users[1][1],
    email: "access-management-8@example.invalid",
    normalizedEmail: "access-management-8@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000008",
  };
  const secondManager = {
    ...owner,
    id: users[3][0],
    displayName: users[3][1],
    email: "access-management-10@example.invalid",
    normalizedEmail: "access-management-10@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000010",
  };
  const packageLead = {
    ...owner,
    id: testViewerUserId,
    displayName: "Integration Test Viewer",
    email: "integration-viewer@example.invalid",
    normalizedEmail: "integration-viewer@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000003",
  };
  const ordinaryCollaborator = {
    ...owner,
    id: testOutsiderUserId,
    displayName: "Integration Test Outsider",
    email: "integration-outsider@example.invalid",
    normalizedEmail: "integration-outsider@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000004",
  };
  const actionPermission = (permission) => [{ module: "actions", permission }];
  const fullPackagePermissions = ["overview", "actions", "deliverables", "gate_reviews"]
    .map((module) => ({ module, permission: "read_write" }));

  const historicalBefore = await accessManagementHistoricalFingerprint(
    database.getOperationalPool(),
  );
  const managerGrant = await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: accessManager.id,
    scopeType: "entire_project",
    packageId: null,
    authorityRole: "project_access_manager",
    permissions: [],
  });
  const secondManagerGrant = await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: secondManager.id,
    scopeType: "entire_project",
    packageId: null,
    authorityRole: "project_access_manager",
    permissions: [],
  });
  const entireGrant = await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: collaboratorOne.id,
    scopeType: "entire_project",
    packageId: null,
    authorityRole: "collaborator",
    permissions: actionPermission("read"),
  });
  const noAccessGrant = await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: collaboratorOne.id,
    scopeType: "overall_project",
    packageId: null,
    authorityRole: "collaborator",
    permissions: [],
  });
  const packageGrant = await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: collaboratorOne.id,
    scopeType: "specific_package",
    packageId,
    authorityRole: "collaborator",
    permissions: actionPermission("read_write"),
  });
  await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: collaboratorTwo.id,
    scopeType: "overall_project",
    packageId: null,
    authorityRole: "collaborator",
    permissions: actionPermission("read"),
  });
  const packageLeadGrant = await accessManagement.saveInternalAccessGrant(owner, {
    projectId,
    targetUserId: collaboratorTwo.id,
    scopeType: "specific_package",
    packageId: otherPackageId,
    authorityRole: "package_lead",
    permissions: fullPackagePermissions,
  });

  const projectView = await accessManagement.getProjectAccessManagementView(owner, projectId);
  assert.equal(projectView.authority, "owner");
  assert.ok(projectView.grants.some((grant) =>
    grant.id === managerGrant.grantId
    && grant.authorityRole === "project_access_manager"
    && grant.actionsPermission === null));
  assert.ok(projectView.grants.some((grant) =>
    grant.id === noAccessGrant.grantId && grant.actionsPermission === null));
  assert.equal(projectView.assignableUsers.some((user) => user.id === users[2][0]), false);
  assert.equal(projectView.owners.some((user) => user.id === owner.id), true);

  const packageView = await accessManagement.getPackageAccessManagementView(
    owner,
    projectId,
    packageId,
  );
  const inheritedAndDirect = packageView.users.find(
    (entry) => entry.user.id === collaboratorOne.id,
  );
  assert.equal(inheritedAndDirect.entireProjectGrant.id, entireGrant.grantId);
  assert.equal(inheritedAndDirect.packageGrant.id, packageGrant.grantId);
  assert.equal(inheritedAndDirect.effectivePermission, "read_write");

  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(owner, {
      projectId,
      targetUserId: users[2][0],
      scopeType: "overall_project",
      packageId: null,
      authorityRole: "collaborator",
      permissions: actionPermission("read"),
    }),
    /active authenticated application collaborator/,
  );
  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(accessManager, {
      projectId,
      existingGrantId: secondManagerGrant.grantId,
      targetUserId: secondManager.id,
      scopeType: "entire_project",
      packageId: null,
      authorityRole: "collaborator",
      permissions: actionPermission("read"),
    }),
    /Only a Project Owner may modify a Project Access Manager/,
  );
  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(accessManager, {
      projectId,
      targetUserId: owner.id,
      scopeType: "overall_project",
      packageId: null,
      authorityRole: "collaborator",
      permissions: actionPermission("read"),
    }),
    /Protected Project Owner/,
  );

  const leadManagedGrant = await accessManagement.saveInternalAccessGrant(packageLead, {
    projectId,
    targetUserId: ordinaryCollaborator.id,
    scopeType: "specific_package",
    packageId,
    authorityRole: "collaborator",
    permissions: actionPermission("read"),
  });
  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(packageLead, {
      projectId,
      existingGrantId: leadManagedGrant.grantId,
      targetUserId: ordinaryCollaborator.id,
      scopeType: "specific_package",
      packageId,
      authorityRole: "package_lead",
      permissions: fullPackagePermissions,
    }),
    /ordinary collaborators/,
  );
  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(packageLead, {
      projectId,
      targetUserId: ordinaryCollaborator.id,
      scopeType: "specific_package",
      packageId: otherPackageId,
      authorityRole: "collaborator",
      permissions: actionPermission("read"),
    }),
    /delegated authority/,
  );
  const leadGrant = projectView.grants.find((grant) =>
    grant.user.id === packageLead.id
    && grant.authorityRole === "package_lead"
    && grant.projectPackage?.id === packageId);
  assert.ok(leadGrant);
  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(packageLead, {
      projectId,
      existingGrantId: leadGrant.id,
      targetUserId: packageLead.id,
      scopeType: "specific_package",
      packageId,
      authorityRole: "package_lead",
      permissions: fullPackagePermissions,
    }),
    /themselves/,
  );

  const mutationClient = await database.getOperationalPool().connect();
  try {
    await mutationClient.query(
      `UPDATE access_grant_permission SET permission = 'read'
       WHERE grant_id = $1 AND module = 'actions'`,
      [leadGrant.id],
    );
  } finally {
    mutationClient.release();
  }
  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(packageLead, {
      projectId,
      existingGrantId: leadManagedGrant.grantId,
      targetUserId: ordinaryCollaborator.id,
      scopeType: "specific_package",
      packageId,
      authorityRole: "collaborator",
      permissions: actionPermission("read_write"),
    }),
    /cannot exceed/,
  );
  const restoreClient = await database.getOperationalPool().connect();
  try {
    await restoreClient.query(
      `UPDATE access_grant_permission SET permission = 'read_write'
       WHERE grant_id = $1 AND module = 'actions'`,
      [leadGrant.id],
    );
  } finally {
    restoreClient.release();
  }

  await assert.rejects(
    () => accessManagement.saveInternalAccessGrant(owner, {
      projectId,
      existingGrantId: packageGrant.grantId,
      targetUserId: collaboratorOne.id,
      scopeType: "specific_package",
      packageId: otherPackageId,
      authorityRole: "collaborator",
      permissions: actionPermission("read"),
      expectedExistingPackageId: otherPackageId,
    }),
    /does not belong to the selected Package/,
  );

  const managerPackageGrant = await accessManagement.saveInternalAccessGrant(accessManager, {
    projectId,
    targetUserId: ordinaryCollaborator.id,
    scopeType: "specific_package",
    packageId: otherPackageId,
    authorityRole: "collaborator",
    permissions: actionPermission("read"),
  });
  await accessManagement.saveInternalAccessGrant(accessManager, {
    projectId,
    existingGrantId: managerPackageGrant.grantId,
    targetUserId: ordinaryCollaborator.id,
    scopeType: "specific_package",
    packageId: otherPackageId,
    authorityRole: "package_lead",
    permissions: fullPackagePermissions,
  });
  await accessManagement.revokeInternalAccessGrant(accessManager, {
    projectId,
    grantId: managerPackageGrant.grantId,
    confirmNoPackageLead: false,
    expectedPackageId: otherPackageId,
  });

  await accessManagement.revokeInternalAccessGrant(owner, {
    projectId,
    grantId: packageGrant.grantId,
    confirmNoPackageLead: false,
    expectedPackageId: packageId,
  });
  assert.equal(await accessAuthorization.getEffectiveAccessPermission({
    user: collaboratorOne,
    projectId,
    packageId,
    module: "actions",
  }), "read");
  const inheritedAfterRevocation = await accessManagement.getPackageAccessManagementView(
    owner,
    projectId,
    packageId,
  );
  const remaining = inheritedAfterRevocation.users.find(
    (entry) => entry.user.id === collaboratorOne.id,
  );
  assert.equal(remaining.packageGrant, null);
  assert.equal(remaining.entireProjectGrant.id, entireGrant.grantId);
  assert.equal(remaining.effectivePermission, "read");

  await assert.rejects(
    () => accessManagement.revokeInternalAccessGrant(owner, {
      projectId,
      grantId: packageLeadGrant.grantId,
      confirmNoPackageLead: false,
      expectedPackageId: otherPackageId,
    }),
    /without a designated Package Lead/,
  );
  await accessManagement.revokeInternalAccessGrant(owner, {
    projectId,
    grantId: packageLeadGrant.grantId,
    confirmNoPackageLead: true,
    expectedPackageId: otherPackageId,
  });
  const revokedLeadPermission = await accessAuthorization.getEffectiveAccessPermission({
    user: collaboratorTwo,
    projectId,
    packageId: otherPackageId,
    module: "actions",
  });
  assert.equal(revokedLeadPermission, null);

  assert.equal(
    await accessManagement.getProjectAccessManagementView(collaboratorOne, projectId),
    null,
  );
  assert.equal(
    await accessManagement.getPackageAccessManagementView(
      ordinaryCollaborator,
      projectId,
      otherPackageId,
    ),
    null,
  );
  const managerView = await accessManagement.getProjectAccessManagementView(
    accessManager,
    projectId,
  );
  assert.equal(managerView.authority, "project_access_manager");

  const auditClient = await database.getOperationalPool().connect();
  try {
    const audit = await auditClient.query(
      `SELECT audit_event.event_type, audit_event.actor_user_id::text
       FROM audit_event
       WHERE audit_event.project_id = $1
         AND audit_event.resource_type = 'access_grant'
         AND audit_event.resource_id = $2
       ORDER BY audit_event.occurred_at`,
      [projectId, managerPackageGrant.grantId],
    );
    assert.deepEqual(audit.rows.map((row) => row.actor_user_id), [
      accessManager.id,
      accessManager.id,
      accessManager.id,
    ]);
    const revoked = await auditClient.query(
      `SELECT revoked_at IS NOT NULL AS revoked,
              EXISTS (
                SELECT 1 FROM access_grant_permission
                WHERE grant_id = access_grant.id AND module = 'actions'
              ) AS permission_retained
       FROM access_grant WHERE id = $1`,
      [managerPackageGrant.grantId],
    );
    assert.deepEqual(revoked.rows, [{ revoked: true, permission_retained: true }]);
    const ownerGrant = await auditClient.query(
      `SELECT 1 FROM access_grant
       WHERE project_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [projectId, owner.id],
    );
    assert.equal(ownerGrant.rowCount, 0);
  } finally {
    auditClient.release();
  }
  assert.deepEqual(
    await accessManagementHistoricalFingerprint(database.getOperationalPool()),
    historicalBefore,
  );
}

async function accessManagementHistoricalFingerprint(pool) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         (SELECT md5(coalesce(string_agg(
           gate_review_cycle.id || ':' || gate_review_cycle.frozen_evidence::text,
           '|' ORDER BY gate_review_cycle.id
         ), '')) FROM gate_review_cycle) AS frozen_reviews,
         (SELECT md5(coalesce(string_agg(
           project_action.id || ':' || coalesce(project_action_package.package_id, ''),
           '|' ORDER BY project_action.id, project_action_package.package_id
         ), ''))
          FROM project_action
          LEFT JOIN project_action_package
            ON project_action_package.action_id = project_action.id
          WHERE project_action.source = 'gate') AS gate_actions`,
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function verifyAccessAuthorizationService({
  accessAuthorization,
  database,
  projectId,
  packageId,
  otherPackageId,
  crossProjectPackageId,
  owner,
  accessManager,
}) {
  const externalCollaboratorUserId = "20000000-0000-4000-8000-000000000006";
  const externalCollaborator = {
    ...owner,
    id: externalCollaboratorUserId,
    displayName: "Integration Test External Collaborator",
    email: "integration-external-collaborator@example.invalid",
    normalizedEmail: "integration-external-collaborator@example.invalid",
    accessClass: "external_collaborator",
    providerObjectId: "30000000-0000-4000-8000-000000000006",
  };
  const packageLead = {
    ...owner,
    id: testViewerUserId,
    displayName: "Integration Test Viewer",
    email: "integration-viewer@example.invalid",
    normalizedEmail: "integration-viewer@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000003",
  };
  const collaborator = {
    ...owner,
    id: testOutsiderUserId,
    displayName: "Integration Test Outsider",
    email: "integration-outsider@example.invalid",
    normalizedEmail: "integration-outsider@example.invalid",
    providerObjectId: "30000000-0000-4000-8000-000000000004",
  };

  const client = await database.getOperationalPool().connect();
  try {
    await client.query(
       `INSERT INTO app_user (
          id, display_name, email, normalized_email, email_verified, status,
          access_class, last_authenticated_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $3, true, 'active', 'external_collaborator', now(), now(), now())
        ON CONFLICT (id) DO UPDATE SET
          status = 'active', access_class = 'external_collaborator',
          last_authenticated_at = now(), updated_at = now()`,
      [
        externalCollaboratorUserId,
        externalCollaborator.displayName,
        externalCollaborator.email,
      ],
    );
    await client.query(
      `INSERT INTO user_identity (
         id, provider, provider_object_id, user_id, provider_tenant_id,
         provider_subject, provider_email_snapshot, entra_account_type,
         last_authenticated_at, created_at, updated_at
       ) VALUES (
         '40000000-0000-4000-8000-000000000006', 'microsoft', $1, $2, $3,
         'integration-test-subject-6', $4, 1, now(), now(), now()
       ) ON CONFLICT (provider, provider_object_id) DO UPDATE SET
         user_id = EXCLUDED.user_id, provider_tenant_id = EXCLUDED.provider_tenant_id,
         last_authenticated_at = now(), updated_at = now()`,
      [
        externalCollaborator.providerObjectId,
        externalCollaboratorUserId,
        testTenantId,
        externalCollaborator.email,
      ],
    );

    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: externalCollaborator,
      projectId,
      packageId: null,
      module: "actions",
    }), null);
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: owner,
      projectId,
      packageId: otherPackageId,
      module: "risks",
    }), "read_write");

    await assert.rejects(
      () => client.query(
        `INSERT INTO access_grant (
           project_id, user_id, scope_type, authority_role,
           created_by_user_id, updated_by_user_id
         ) VALUES ($1, $2, 'overall_project', 'collaborator', $3, $3)`,
        [projectId, testExternalUserId, owner.id],
      ),
      /active verified application collaborator/,
    );

    const insertGrant = async ({
      userId,
      scopeType,
      targetPackageId = null,
      authorityRole = "collaborator",
      permission = null,
    }) => {
      const grant = await client.query(
        `INSERT INTO access_grant (
           project_id, user_id, scope_type, package_id, authority_role,
           created_by_user_id, updated_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id::text`,
        [projectId, userId, scopeType, targetPackageId, authorityRole, owner.id],
      );
      const grantId = grant.rows[0].id;
      if (permission) {
        const modules = authorityRole === "package_lead"
          ? ["overview", "actions", "deliverables", "gate_reviews"]
          : ["actions"];
        for (const accessModule of modules) {
          await client.query(
            `INSERT INTO access_grant_permission (
               grant_id, module, permission, created_by_user_id, updated_by_user_id
             ) VALUES ($1, $2, $3, $4, $4)`,
            [grantId, accessModule, permission, owner.id],
          );
        }
      }
      return grantId;
    };

    const packageLeadGrantId = await insertGrant({
      userId: packageLead.id,
      scopeType: "specific_package",
      targetPackageId: packageId,
      authorityRole: "package_lead",
      permission: "read_write",
    });
    const packageGrantId = await insertGrant({
      userId: collaborator.id,
      scopeType: "specific_package",
      targetPackageId: packageId,
      permission: "read",
    });
    await client.query(
      `INSERT INTO access_grant_permission (
         grant_id, module, permission, created_by_user_id, updated_by_user_id
       ) VALUES
         ($1, 'deliverables', 'read', $2, $2),
         ($1, 'gate_reviews', 'read_write', $2, $2)`,
      [packageGrantId, owner.id],
    );
    await insertGrant({
      userId: collaborator.id,
      scopeType: "overall_project",
      permission: "read_write",
    });
    const managerGrantId = await insertGrant({
      userId: accessManager.id,
      scopeType: "entire_project",
      authorityRole: "project_access_manager",
    });
    await insertGrant({
      userId: externalCollaborator.id,
      scopeType: "entire_project",
      permission: "read",
    });

    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "actions",
    }), "read");
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId: null,
      module: "actions",
    }), "read_write");
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId: otherPackageId,
      module: "actions",
    }), null);
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "deliverables",
    }), "read");
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "gate_reviews",
    }), "read_write");
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "overview",
    }), null);
    assert.deepEqual(
      await accessAuthorization.getPackageModulePermissions({
        user: packageLead,
        projectId,
        packageId,
      }),
      {
        overview: "read_write",
        actions: "read_write",
        deliverables: "read_write",
        gate_reviews: "read_write",
      },
    );
    assert.equal(await accessAuthorization.getPackageGovernanceAuthority({
      user: packageLead,
      projectId,
      packageId,
    }), "package_lead");
    assert.equal(await accessAuthorization.getPackageGovernanceAuthority({
      user: packageLead,
      projectId,
      packageId: otherPackageId,
    }), null);
    assert.equal(await accessAuthorization.getPackageGovernanceAuthority({
      user: collaborator,
      projectId,
      packageId,
    }), null);
    assert.equal(await accessAuthorization.getPackageGovernanceAuthority({
      user: externalCollaborator,
      projectId,
      packageId,
    }), null);
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "risks",
    }), null);
    await assert.rejects(
      () => accessAuthorization.requireAccessPermission({
        user: collaborator,
        projectId,
        packageId,
        module: "actions",
        requestedPermission: "read_write",
      }),
      /do not have permission/,
    );
    assert.equal((await accessAuthorization.requireAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "actions",
      requestedPermission: "read",
    })).permission, "read");

    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: externalCollaborator,
      projectId,
      packageId: otherPackageId,
      module: "actions",
    }), "read");
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: externalCollaborator,
      projectId,
      packageId: crossProjectPackageId,
      module: "actions",
    }), null);
    const otherProjectId = (await client.query(
      `SELECT project_id FROM project_package WHERE id = $1`,
      [crossProjectPackageId],
    )).rows[0]?.project_id;
    assert.ok(otherProjectId);
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: externalCollaborator,
      projectId: otherProjectId,
      packageId: crossProjectPackageId,
      module: "actions",
    }), null);

    const collaboratorScopes = await accessAuthorization.getAccessibleModuleScopes({
      user: collaborator,
      projectId,
      module: "actions",
    });
    assert.equal(collaboratorScopes.overallPermission, "read_write");
    assert.deepEqual(collaboratorScopes.packages, [{ packageId, permission: "read" }]);
    const externalNavigation = await accessAuthorization.getAuthorizedNavigation({
      user: externalCollaborator,
      module: "actions",
    });
    assert.ok(externalNavigation.some((item) => item.projectId === projectId));
    const managerNavigation = await accessAuthorization.getAuthorizedNavigation({
      user: accessManager,
      module: "actions",
    });
    assert.equal(managerNavigation.some((item) => item.projectId === projectId), false);

    const mutationResult = await accessAuthorization.withAuthorizedAccessMutation({
      user: collaborator,
      projectId,
      packageId: null,
      module: "actions",
      audit: {
        eventType: "access.integration_test",
        resourceType: "project",
        resourceId: projectId,
      },
      operation: async () => {
        const nestedPermission = await accessAuthorization.getEffectiveAccessPermission({
          user: collaborator,
          projectId,
          packageId: null,
          module: "actions",
        });
        assert.equal(nestedPermission, "read_write");
        return { authorized: true };
      },
    });
    assert.deepEqual(mutationResult, { authorized: true });
    const audit = await client.query(
      `SELECT actor_user_id::text FROM audit_event
       WHERE event_type = 'access.integration_test' AND resource_id = $1`,
      [projectId],
    );
    assert.deepEqual(audit.rows, [{ actor_user_id: collaborator.id }]);
    await assert.rejects(
      () => accessAuthorization.withAuthorizedAccessMutation({
        user: collaborator,
        projectId,
        packageId,
        module: "actions",
        operation: async () => true,
      }),
      /do not have permission/,
    );

    assert.deepEqual(await accessAuthorization.validateDelegatedAccessGrant(owner, {
      projectId,
      targetUserId: accessManager.id,
      scopeType: "entire_project",
      packageId: null,
      authorityRole: "project_access_manager",
      permissions: [],
    }), { authority: "owner" });
    await assert.rejects(
      () => accessAuthorization.validateDelegatedAccessGrant(accessManager, {
        projectId,
        targetUserId: owner.id,
        scopeType: "entire_project",
        packageId: null,
        authorityRole: "collaborator",
        permissions: [{ module: "actions", permission: "read" }],
      }),
      /Protected Project Owner/,
    );
    await assert.rejects(
      () => accessAuthorization.validateDelegatedAccessGrant(accessManager, {
        projectId,
        targetUserId: collaborator.id,
        scopeType: "entire_project",
        packageId: null,
        authorityRole: "project_access_manager",
        permissions: [],
      }),
      /Only a Project Owner/,
    );
    assert.deepEqual(await accessAuthorization.validateDelegatedAccessGrant(
      accessManager,
      {
        projectId,
        targetUserId: packageLead.id,
        scopeType: "specific_package",
        packageId,
        authorityRole: "package_lead",
        permissions: ["overview", "actions", "deliverables", "gate_reviews"].map(
          (module) => ({ module, permission: "read_write" }),
        ),
      },
    ), { authority: "project_access_manager" });
    assert.deepEqual(await accessAuthorization.validateDelegatedAccessGrant(packageLead, {
      projectId,
      targetUserId: collaborator.id,
      scopeType: "specific_package",
      packageId,
      authorityRole: "collaborator",
      permissions: [{ module: "actions", permission: "read" }],
    }), { authority: "package_lead" });
    await assert.rejects(
      () => accessAuthorization.validateDelegatedAccessGrant(packageLead, {
        projectId,
        targetUserId: collaborator.id,
        scopeType: "specific_package",
        packageId: otherPackageId,
        authorityRole: "collaborator",
        permissions: [{ module: "actions", permission: "read" }],
      }),
      /delegated authority/,
    );

    await client.query(
      `UPDATE access_grant_permission SET permission = 'read'
       WHERE grant_id = $1 AND module = 'actions'`,
      [packageLeadGrantId],
    );
    await assert.rejects(
      () => accessAuthorization.validateDelegatedAccessGrant(packageLead, {
        projectId,
        targetUserId: collaborator.id,
        scopeType: "specific_package",
        packageId,
        authorityRole: "collaborator",
        permissions: [{ module: "actions", permission: "read_write" }],
      }),
      /cannot exceed/,
    );
    await client.query(
      `UPDATE access_grant_permission SET permission = 'read_write'
       WHERE grant_id = $1 AND module = 'actions'`,
      [packageLeadGrantId],
    );

    await client.query(
      `UPDATE access_grant
       SET revoked_at = now(), revoked_by_user_id = $1, updated_at = now(),
           updated_by_user_id = $1
       WHERE id = $2`,
      [owner.id, packageGrantId],
    );
    assert.equal(await accessAuthorization.getEffectiveAccessPermission({
      user: collaborator,
      projectId,
      packageId,
      module: "actions",
    }), null);
    await client.query(
      `UPDATE access_grant
       SET revoked_at = now(), revoked_by_user_id = $1, updated_at = now(),
           updated_by_user_id = $1
       WHERE id = $2`,
      [owner.id, managerGrantId],
    );
    await assert.rejects(
      () => accessAuthorization.validateDelegatedAccessGrant(accessManager, {
        projectId,
        targetUserId: collaborator.id,
        scopeType: "specific_package",
        packageId,
        authorityRole: "collaborator",
        permissions: [{ module: "actions", permission: "read" }],
      }),
      /delegated authority|may manage only/,
    );
  } finally {
    client.release();
  }
}

async function verifyAccessMigrationsFromLegacyState(
  connectionString,
  expectedDatabase,
  migrationsDirectory,
  logger,
) {
  const temporaryDirectory = await mkdtemp(
    path.join("/tmp/opencode", "kaizen-access-migrations-018-"),
  );
  await resetDisposableDatabase(connectionString, expectedDatabase);
  try {
    await cp(migrationsDirectory, temporaryDirectory, { recursive: true });
    await rm(path.join(temporaryDirectory, "019_access_management_foundation.sql"));
    await rm(path.join(temporaryDirectory, "020_single_package_action_scope.sql"));
    await rm(path.join(temporaryDirectory, "021_full_package_access.sql"));
    await runMigrations({ connectionString, migrationsDirectory: temporaryDirectory, logger });
    await seedTestIdentity(connectionString);

    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(`
        INSERT INTO project (
          id, project_number, name, description, project_manager, customer,
          reports_to, site_location, validation_required, current_stage,
          created_at, updated_at
        ) VALUES (
          'access-legacy-project', 'ACCESS-019', 'Legacy access fixture', '',
          'Owner', 'Customer', 'Sponsor', 'Site', false, 'initiation', now(), now()
        );
        INSERT INTO project_membership (project_id, user_id, role) VALUES
          ('access-legacy-project', '${testOwnerUserId}', 'owner'),
          ('access-legacy-project', '${testEditorUserId}', 'editor'),
          ('access-legacy-project', '${testViewerUserId}', 'viewer');
        INSERT INTO project_package (
          id, project_id, package_code, package_name, description, package_owner,
          execution_model, current_stage, status, created_at, updated_at
        ) VALUES
          ('access-package-a', 'access-legacy-project', 'A', 'Package A', '',
           'A free-text owner who must not receive access', 'external', 'definition',
           'not_assessed', now(), now()),
          ('access-package-b', 'access-legacy-project', 'B', 'Package B', '',
           'Another free-text owner', 'internal', 'definition', 'not_assessed', now(), now());
        INSERT INTO gate (
          id, project_id, package_id, scope_level, sequence, template_version,
          name, stage_id, status
        ) VALUES
          ('access-project-gate', 'access-legacy-project', NULL, 'project', 1, 1,
           'Project Gate', 'initiation', 'approved'),
          ('access-package-gate', 'access-legacy-project', 'access-package-a',
           'package', 1, 1, 'Package Gate', 'definition', 'approved');
        INSERT INTO gate_approver (
          id, gate_id, sequence, name, email, role_function, approval_role,
          approval_level, assigned_user_id, expected_provider_tenant_id,
          expected_provider_object_id
        ) VALUES (
          'access-external-approver', 'access-project-gate', 1, 'External Approver',
          'integration-external@example.invalid', 'Reviewer', 'Approver', 1,
          '${testExternalUserId}', '${testTenantId}',
          '30000000-0000-4000-8000-000000000005'
        );
        INSERT INTO gate_review_cycle (
          id, gate_id, schema_version, cycle_number, project_snapshot,
          package_snapshot, gate_snapshot, status, submitted_at, submitted_by,
          submitted_by_user_id, decision, decision_comments, completed_at,
          frozen_evidence
        ) VALUES (
          'access-frozen-cycle', 'access-project-gate', 1, 1,
          '{"project":"frozen"}'::jsonb, NULL, '{"gate":"frozen"}'::jsonb,
          'approved', '2026-01-01T00:00:00Z', '{"name":"Owner"}'::jsonb,
          '${testOwnerUserId}', 'approved', 'Historical decision',
          '2026-01-02T00:00:00Z',
          '{"deliverables":[{"id":"historical","status":"completed"}]}'::jsonb
        );
        INSERT INTO project_action (
          id, project_id, sequence, description, assignee, status, priority,
          gate_id, source, package_association_locked, logged_by_display_name,
          date_logged, last_updated
        ) VALUES
          ('access-overall-gate-action', 'access-legacy-project', 1,
           'Overall Gate Action', 'Owner', 'new', 'high', 'access-project-gate',
           'gate', true, 'Owner', now(), now()),
          ('access-package-gate-action', 'access-legacy-project', 2,
           'Package Gate Action', 'Owner', 'new', 'high', 'access-package-gate',
           'gate', true, 'Owner', now(), now()),
          ('access-manual-action', 'access-legacy-project', 3,
           'Manual Package Action', 'Owner', 'new', 'medium', NULL,
           'manual', false, 'Owner', now(), now());
        INSERT INTO project_action_package (action_id, package_id, project_id, sequence)
        VALUES
          ('access-package-gate-action', 'access-package-a', 'access-legacy-project', 1),
          ('access-manual-action', 'access-package-b', 'access-legacy-project', 1);
      `);
      const frozenBefore = await client.query(
        `SELECT project_snapshot, gate_snapshot, frozen_evidence, status, decision
         FROM gate_review_cycle WHERE id = 'access-frozen-cycle'`,
      );

      await runMigrations({ connectionString, migrationsDirectory, logger });

      const memberships = await client.query(
        `SELECT user_id::text, role FROM project_membership
         WHERE project_id = 'access-legacy-project' ORDER BY role, user_id`,
      );
      assert.deepEqual(memberships.rows, [
        { user_id: testEditorUserId, role: "editor" },
        { user_id: testOwnerUserId, role: "owner" },
        { user_id: testViewerUserId, role: "viewer" },
      ]);
      const legacyGrants = await client.query(
        `SELECT access_grant.user_id::text, access_grant.scope_type,
                access_grant.authority_role, access_grant.origin,
                access_grant_permission.module, access_grant_permission.permission
         FROM access_grant
          JOIN access_grant_permission
            ON access_grant_permission.grant_id = access_grant.id
          WHERE access_grant.project_id = 'access-legacy-project'
         ORDER BY access_grant_permission.permission, access_grant.user_id,
                  access_grant_permission.module`,
      );
      assert.deepEqual(legacyGrants.rows, [
        ...["actions", "deliverables", "gate_reviews", "overview"].map((module) => ({
          user_id: testViewerUserId,
          scope_type: "entire_project",
          authority_role: "collaborator",
          origin: "legacy_membership",
          module,
          permission: "read",
        })),
        ...["actions", "deliverables", "gate_reviews", "overview"].map((module) => ({
          user_id: testEditorUserId,
          scope_type: "entire_project",
          authority_role: "collaborator",
          origin: "legacy_membership",
          module,
          permission: "read_write",
        })),
      ]);
      assert.equal(
        legacyGrants.rows.some((row) =>
          row.user_id === testOwnerUserId || row.user_id === testExternalUserId),
        false,
      );
      const projectCreators = await client.query(
        `SELECT user_id::text FROM project_creation_authorization
         WHERE revoked_at IS NULL ORDER BY user_id`,
      );
      assert.deepEqual(projectCreators.rows, [{ user_id: testOwnerUserId }]);

      const frozenAfter = await client.query(
        `SELECT project_snapshot, gate_snapshot, frozen_evidence, status, decision
         FROM gate_review_cycle WHERE id = 'access-frozen-cycle'`,
      );
      assert.deepEqual(frozenAfter.rows, frozenBefore.rows);

      await assert.rejects(
        () => client.query(
          `INSERT INTO project_action_package (action_id, package_id, project_id, sequence)
           VALUES ('access-manual-action', 'access-package-a', 'access-legacy-project', 2)`,
        ),
        /unique|duplicate/i,
      );
      await assertDeferredConstraintRejects(client, `
        INSERT INTO project_action_package (action_id, package_id, project_id, sequence)
        VALUES ('access-overall-gate-action', 'access-package-a', 'access-legacy-project', 1)
      `, /Overall Project scoped/);
      await assertDeferredConstraintRejects(client, `
        DELETE FROM project_action_package
        WHERE action_id = 'access-package-gate-action'
      `, /own Package/);
      await assertDeferredConstraintRejects(client, `
        UPDATE gate SET package_id = 'access-package-b'
        WHERE id = 'access-package-gate'
      `, /own Package/);

      const accessRequest = await client.query(
        `INSERT INTO access_request (
           project_id, collaborator_type, scope_type, package_id, name, email,
           normalized_email, organization_name, requested_by_user_id
         ) VALUES (
           'access-legacy-project', 'external', 'specific_package', 'access-package-a',
           'Proposed Collaborator', 'PROPOSED@example.invalid',
           'proposed@example.invalid', 'Supplier', '${testOwnerUserId}'
         ) RETURNING id::text`,
      );
      await client.query(
        `INSERT INTO access_request_permission (request_id, module, permission)
         VALUES ($1, 'actions', 'read')`,
        [accessRequest.rows[0].id],
      );
      const request = await client.query(
        `SELECT access_request.status, access_request.identity_link_status,
                access_request_permission.module, access_request_permission.permission
         FROM access_request
         JOIN access_request_permission
           ON access_request_permission.request_id = access_request.id
         WHERE access_request.project_id = 'access-legacy-project'`,
      );
      assert.deepEqual(request.rows, [{
        status: "pending",
        identity_link_status: "not_started",
        module: "actions",
        permission: "read",
      }]);
    } finally {
      await client.end();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await resetDisposableDatabase(connectionString, expectedDatabase);
  }
}

async function verifyAmbiguousActionScopeFailsClosed(
  connectionString,
  expectedDatabase,
  migrationsDirectory,
  logger,
) {
  const temporaryDirectory = await mkdtemp(
    path.join("/tmp/opencode", "kaizen-access-migrations-019-"),
  );
  await resetDisposableDatabase(connectionString, expectedDatabase);
  try {
    await cp(migrationsDirectory, temporaryDirectory, { recursive: true });
    await rm(path.join(temporaryDirectory, "020_single_package_action_scope.sql"));
    await runMigrations({ connectionString, migrationsDirectory: temporaryDirectory, logger });
    await seedTestIdentity(connectionString);

    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(`
        INSERT INTO project (
          id, project_number, name, description, project_manager, customer,
          reports_to, site_location, validation_required, current_stage,
          created_at, updated_at
        ) VALUES (
          'ambiguous-action-project', 'ACCESS-020', 'Ambiguous Action fixture', '',
          'Owner', 'Customer', 'Sponsor', 'Site', false, 'initiation', now(), now()
        );
        INSERT INTO project_membership (project_id, user_id, role)
        VALUES ('ambiguous-action-project', '${testOwnerUserId}', 'owner');
        INSERT INTO project_package (
          id, project_id, package_code, package_name, description, package_owner,
          execution_model, current_stage, status, created_at, updated_at
        ) VALUES
          ('ambiguous-package-a', 'ambiguous-action-project', 'A', 'Package A', '',
           'Owner', 'internal', 'definition', 'not_assessed', now(), now()),
          ('ambiguous-package-b', 'ambiguous-action-project', 'B', 'Package B', '',
           'Owner', 'internal', 'definition', 'not_assessed', now(), now());
        INSERT INTO project_action (
          id, project_id, sequence, description, assignee, status, priority,
          source, package_association_locked, logged_by_display_name,
          date_logged, last_updated
        ) VALUES (
          'ambiguous-action', 'ambiguous-action-project', 1, 'Ambiguous Action',
          'Owner', 'new', 'high', 'manual', false, 'Owner', now(), now()
        ), (
          'invalid-gate-action', 'ambiguous-action-project', 2, 'Invalid Gate Action',
          'Owner', 'new', 'high', 'gate', true, 'Owner', now(), now()
        );
        INSERT INTO project_action_package (action_id, package_id, project_id, sequence)
        VALUES
          ('ambiguous-action', 'ambiguous-package-a', 'ambiguous-action-project', 1),
          ('ambiguous-action', 'ambiguous-package-b', 'ambiguous-action-project', 2);
      `);
    } finally {
      await client.end();
    }

    await assert.rejects(
      () => runMigrations({ connectionString, migrationsDirectory, logger }),
      /Migration 020 requires each Action to reference at most one Package/,
    );

    const verificationClient = new Client({ connectionString });
    await verificationClient.connect();
    try {
      const ledger = await verificationClient.query(
        `SELECT 1 FROM identity_schema_migration
         WHERE name = '020_single_package_action_scope.sql'`,
      );
      assert.equal(ledger.rowCount, 0);
      const links = await verificationClient.query(
        `SELECT package_id FROM project_action_package
         WHERE action_id = 'ambiguous-action' ORDER BY package_id`,
      );
      assert.deepEqual(links.rows, [
        { package_id: "ambiguous-package-a" },
        { package_id: "ambiguous-package-b" },
      ]);
      await verificationClient.query(
        `DELETE FROM project_action_package
         WHERE action_id = 'ambiguous-action' AND package_id = 'ambiguous-package-b'`,
      );
    } finally {
      await verificationClient.end();
    }

    await assert.rejects(
      () => runMigrations({ connectionString, migrationsDirectory, logger }),
      /Gate Actions whose Package scope does not match their Gate/,
    );
    const finalClient = new Client({ connectionString });
    await finalClient.connect();
    try {
      const ledger = await finalClient.query(
        `SELECT 1 FROM identity_schema_migration
         WHERE name = '020_single_package_action_scope.sql'`,
      );
      assert.equal(ledger.rowCount, 0);
    } finally {
      await finalClient.end();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await resetDisposableDatabase(connectionString, expectedDatabase);
  }
}

async function assertDeferredConstraintRejects(client, statement, expected) {
  await client.query("BEGIN");
  try {
    await client.query(statement);
    await assert.rejects(
      () => client.query("SET CONSTRAINTS ALL IMMEDIATE"),
      expected,
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

async function resetDisposableDatabase(connectionString, expectedDatabase) {
  assert.match(expectedDatabase, /^kaizen_project_manager_migration_test_[ab]$/);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const database = await client.query("SELECT current_database() AS name");
    assert.equal(database.rows[0]?.name, expectedDatabase);
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
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
            status, access_class, last_authenticated_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $3, true, 'active', $4, now(), now(), now())
          ON CONFLICT (id) DO UPDATE SET
            status = 'active', access_class = EXCLUDED.access_class,
            last_authenticated_at = now(), updated_at = now()`,
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
    const reopeningMigration = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM gate WHERE reapproval_required) AS pending_count,
         (SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'gate'
            AND column_name = 'reapproval_required') AS column_default,
         (SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'gate'
            AND column_name = 'reapproval_required') AS is_nullable`,
    );
    assert.equal(reopeningMigration.rows[0].pending_count, 0);
    assert.equal(reopeningMigration.rows[0].column_default, "false");
    assert.equal(reopeningMigration.rows[0].is_nullable, "NO");
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
  await expectDatabaseError(
    connectionString,
    `UPDATE gate SET reapproval_required = true
     WHERE id IN (
       SELECT id FROM gate WHERE package_id IS NULL ORDER BY sequence LIMIT 2
     )`,
    /gate_one_project_reapproval_required_idx|duplicate key/i,
  );
  await expectDatabaseError(
    connectionString,
    `UPDATE gate SET reapproval_required = true
     WHERE id IN (
       SELECT id FROM gate
       WHERE package_id = (SELECT package_id FROM gate WHERE package_id IS NOT NULL LIMIT 1)
       ORDER BY sequence LIMIT 2
     )`,
    /gate_one_package_reapproval_required_idx|duplicate key/i,
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
