import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRelationalRows, loadOwnerMapping } from "./operational-database.mjs";
import {
  OPERATIONAL_SOURCE_FILES,
  canonicalJson,
  countEntities,
  historicalEvidenceFingerprint,
  loadOperationalSource,
  logicalFingerprint,
  sanitizeError,
  validateRelationships,
  validateSourceStructure,
} from "./operational-data.mjs";
import { loadMigrations } from "./migration-runner.mjs";

const root = process.cwd();
const sourceDirectory = path.join(root, ".data");
const projectionManifestPath = path.join(
  root,
  "database",
  "operational-runtime-projection-v1.json",
);

test("the approved runtime projection is exact and deterministic", async () => {
  const before = await sourceChecksums(sourceDirectory);
  const first = await loadSource(sourceDirectory);
  const second = await loadSource(sourceDirectory);
  const after = await sourceChecksums(sourceDirectory);

  assert.deepEqual(before, after);
  assert.equal(first.rawCounts.gateCriteria, 152);
  assert.equal(first.projectedCounts.gateCriteria, 155);
  assert.deepEqual(first.projection.summary, {
    addedCriteria: 3,
    templateVersionUpdates: 4,
    legacyNameUpdates: 2,
  });
  assert.equal(
    historicalEvidenceFingerprint(first.raw),
    historicalEvidenceFingerprint(first.data),
  );
  assert.equal(
    logicalFingerprint(buildRelationalRows(first.data)),
    logicalFingerprint(buildRelationalRows(second.data)),
  );
});

test("all five persisted Deliverable references resolve after projection", async () => {
  const source = await loadSource(sourceDirectory);
  const criterionIds = new Set([
    ...source.data.projects.flatMap((project) => project.gates),
    ...source.data.packages.flatMap((projectPackage) => projectPackage.gates),
  ].flatMap((gate) => gate.criteria.map((criterion) => criterion.id)));
  const derivedIds = new Set(
    source.projection.changes.addedCriteria.map((item) => item.criterion.id),
  );
  const affected = source.data.deliverables.filter((deliverable) =>
    deliverable.criterionIds.some((criterionId) => derivedIds.has(criterionId)));

  assert.equal(affected.length, 5);
  assert.ok(affected.every((deliverable) =>
    deliverable.criterionIds.every((criterionId) => criterionIds.has(criterionId))));
});

test("source structure validation rejects unknown persisted fields", async () => {
  const source = await loadSource(sourceDirectory);
  const malformed = structuredClone(source.raw);
  malformed.projects[0].unexpected = true;
  assert.throws(
    () => validateSourceStructure(malformed),
    /unexpected fields/,
  );
});

test("relationship validation rejects duplicate identifiers", async () => {
  const source = await loadSource(sourceDirectory);
  const malformed = structuredClone(source.data);
  malformed.deliverables.push(structuredClone(malformed.deliverables[0]));
  assert.throws(
    () => validateRelationships(malformed),
    /Duplicate deliverable ID/,
  );
});

test("projection rejects any difference outside the approved allowlist", async () => {
  const temporaryDirectory = await copySourceDirectory();
  try {
    const projectsPath = path.join(temporaryDirectory, "projects.json");
    const projects = JSON.parse(await readFile(projectsPath, "utf8"));
    const gate = projects[0].gates.find((candidate) =>
      candidate.id.endsWith(":project_baseline_approval"));
    gate.templateVersion = 4;
    await writeFile(projectsPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => loadSource(temporaryDirectory),
      /differs from the approved projection manifest/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("owner mapping is explicit, complete, and never inferred", async () => {
  const source = await loadSource(sourceDirectory);
  const absent = await loadOwnerMapping(null, source.data.projects);
  assert.deepEqual(absent.rows, []);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kaizen-owner-map-"));
  try {
    const ownerPath = path.join(temporaryDirectory, "owners.json");
    await writeFile(ownerPath, '{"owners":[]}\n', "utf8");
    await assert.rejects(
      () => loadOwnerMapping(ownerPath, source.data.projects),
      /missing Project ownership/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("relational mapping preserves all current operational counts", async () => {
  const source = await loadSource(sourceDirectory);
  const rows = buildRelationalRows(source.data);
  const counts = countEntities(source.data);

  assert.equal(rows.project.length, counts.projects);
  assert.equal(rows.project_package.length, counts.packages);
  assert.equal(rows.gate.length, counts.projectGates + counts.packageGates);
  assert.equal(rows.gate_criterion.length, counts.gateCriteria);
  assert.equal(rows.deliverable.length, counts.deliverables);
  assert.equal(rows.gate_review_cycle.length, counts.reviewCycles);
  assert.equal(rows.gate_review_cycle_approver.length, counts.reviewCycleApprovers);
  assert.equal(rows.gate_review_response.length, counts.reviewResponses);
  assert.equal(rows.gate_review_invitation_attempt.length, counts.invitationAttempts);
  assert.equal(rows.project_action.length, counts.actions);
  assert.equal(rows.project_action_update.length, counts.actionUpdates);
  assert.equal(rows.action_gate_decision_reference.length, counts.gateDecisionReferences);
});

test("migration files are ordered, named, and checksummed", async () => {
  const migrations = await loadMigrations(path.join(root, "database", "migrations"));
  assert.deepEqual(
    migrations.map((migration) => migration.name),
    [
      "001_identity_foundation.sql",
      "002_better_auth_uuid_defaults.sql",
      "003_remove_stored_id_tokens.sql",
      "004_operational_data_foundation.sql",
      "005_protect_gate_review_attempt_history.sql",
      "006_runtime_persistence_safety.sql",
      "007_project_authorization_audit.sql",
    ],
  );
  assert.ok(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksum)));
});

test("project permission roles enforce the approved hierarchy", async () => {
  const { projectRoleAllows } = await import("../src/lib/project-permissions.ts");
  assert.equal(projectRoleAllows("owner", "owner"), true);
  assert.equal(projectRoleAllows("owner", "editor"), true);
  assert.equal(projectRoleAllows("editor", "editor"), true);
  assert.equal(projectRoleAllows("editor", "owner"), false);
  assert.equal(projectRoleAllows("viewer", "viewer"), true);
  assert.equal(projectRoleAllows("viewer", "editor"), false);
});

test("JSON persistence is allowed in development and rejected in production", async () => {
  const { resolveOperationalDataBackend } = await import(
    "../src/lib/operational/backend-policy.ts"
  );
  assert.equal(resolveOperationalDataBackend(undefined, "development"), "json");
  assert.equal(resolveOperationalDataBackend("json", "test"), "json");
  assert.equal(resolveOperationalDataBackend("postgres", "production"), "postgres");
  assert.throws(
    () => resolveOperationalDataBackend("json", "production"),
    /development-only/,
  );
});

test("Owner-only pilot policy allows only the exact approved Entra identity", async () => {
  const {
    isAutomaticUserCreationAllowed,
    isExternalGateReviewAccessEnabled,
    isPilotIdentityAllowed,
  } = await import("../src/lib/pilot-policy.ts");
  const environment = {
    OWNER_ONLY_PILOT: "true",
    PILOT_OWNER_TENANT_ID: "10000000-0000-4000-8000-000000000001",
    PILOT_OWNER_OBJECT_ID: "20000000-0000-4000-8000-000000000001",
  };

  assert.equal(isPilotIdentityAllowed({
    providerTenantId: "10000000-0000-4000-8000-000000000001",
    providerObjectId: "20000000-0000-4000-8000-000000000001",
  }, environment), true);
  assert.equal(isPilotIdentityAllowed({
    providerTenantId: "10000000-0000-4000-8000-000000000001",
    providerObjectId: "20000000-0000-4000-8000-000000000002",
  }, environment), false);
  assert.equal(isPilotIdentityAllowed({
    providerTenantId: "10000000-0000-4000-8000-000000000002",
    providerObjectId: "20000000-0000-4000-8000-000000000001",
  }, environment), false);
  assert.equal(isAutomaticUserCreationAllowed(environment), false);
  assert.equal(isExternalGateReviewAccessEnabled(environment), false);
});

test("Owner-only pilot policy preserves the local development default", async () => {
  const {
    isAutomaticUserCreationAllowed,
    isExternalGateReviewAccessEnabled,
    isPilotIdentityAllowed,
  } = await import("../src/lib/pilot-policy.ts");
  const environment = {};

  assert.equal(isPilotIdentityAllowed({
    providerTenantId: "10000000-0000-4000-8000-000000000001",
    providerObjectId: "20000000-0000-4000-8000-000000000002",
  }, environment), true);
  assert.equal(isAutomaticUserCreationAllowed(environment), true);
  assert.equal(isExternalGateReviewAccessEnabled(environment), true);
});

test("production configuration rejects unsafe pilot and runtime settings", async () => {
  const { getProductionConfigurationIssues } = await import(
    "../src/lib/deployment-policy.ts"
  );
  const safe = {
    NODE_ENV: "production",
    OPERATIONAL_DATA_BACKEND: "postgres",
    OWNER_ONLY_PILOT: "true",
    PILOT_OWNER_TENANT_ID: "10000000-0000-4000-8000-000000000001",
    PILOT_OWNER_OBJECT_ID: "20000000-0000-4000-8000-000000000001",
    BETTER_AUTH_SECRET: "ci-only-secret-with-at-least-thirty-two-characters",
    BETTER_AUTH_URL: "https://operations.example.com",
    APP_BASE_URL: "https://operations.example.com",
    MICROSOFT_CLIENT_ID: "30000000-0000-4000-8000-000000000001",
    MICROSOFT_CLIENT_SECRET: "configured-outside-source-control",
    MICROSOFT_TENANT_ID: "10000000-0000-4000-8000-000000000001",
    DATABASE_URL: "postgresql://runtime:secret@example-pooler.eu-central-1.aws.neon.tech/kaizen?sslmode=require",
  };

  assert.deepEqual(getProductionConfigurationIssues(safe), []);
  const issues = getProductionConfigurationIssues({
    ...safe,
    OWNER_ONLY_PILOT: "false",
    OPERATIONAL_DATA_BACKEND: "json",
    DATABASE_URL: "postgresql://runtime:secret@example.eu-central-1.aws.neon.tech/kaizen",
    RESEND_API_KEY: "configured-too-early",
    NEXT_PUBLIC_DATABASE_URL: "must-not-be-public",
  });
  assert.ok(issues.some((issue) => issue.includes("OWNER_ONLY_PILOT")));
  assert.ok(issues.some((issue) => issue.includes("OPERATIONAL_DATA_BACKEND")));
  assert.ok(issues.some((issue) => issue.includes("pooled runtime endpoint")));
  assert.ok(issues.some((issue) => issue.includes("require TLS")));
  assert.ok(issues.some((issue) => issue.includes("must be absent")));
  assert.ok(issues.some((issue) => issue.includes("NEXT_PUBLIC_DATABASE_URL")));
});

test("Owner identity transfers are fingerprinted and reject credential fields", async () => {
  const { createTransfer, validateTransfer } = await import("./transfer-owner-identity.mjs");
  const userId = "30000000-0000-4000-8000-000000000001";
  const data = {
    organizations: [],
    users: [{
      id: userId,
      display_name: "Pilot Owner",
      email: "owner@example.com",
      normalized_email: "owner@example.com",
      email_verified: true,
      image: null,
      organization_id: null,
      status: "active",
      access_class: "internal",
      last_authenticated_at: "2026-10-22T12:00:00.000Z",
      created_at: "2026-10-22T12:00:00.000Z",
      updated_at: "2026-10-22T12:00:00.000Z",
    }],
    identities: [{
      id: "40000000-0000-4000-8000-000000000001",
      provider: "microsoft",
      provider_object_id: "20000000-0000-4000-8000-000000000001",
      user_id: userId,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
      scope: "openid profile email",
      provider_tenant_id: "10000000-0000-4000-8000-000000000001",
      provider_subject: "subject",
      provider_email_snapshot: "owner@example.com",
      entra_account_type: 0,
      last_authenticated_at: "2026-10-22T12:00:00.000Z",
      created_at: "2026-10-22T12:00:00.000Z",
      updated_at: "2026-10-22T12:00:00.000Z",
    }],
  };
  const transfer = createTransfer(data, "2026-10-22T12:00:00.000Z");

  assert.equal(validateTransfer(transfer).fingerprint, transfer.fingerprint);
  assert.throws(
    () => validateTransfer({
      ...transfer,
      data: {
        ...data,
        identities: [{ ...data.identities[0], access_token: "must-not-transfer" }],
      },
    }),
    /approved transfer schema/,
  );
  assert.throws(
    () => validateTransfer({
      ...transfer,
      data: {
        ...data,
        users: [{ ...data.users[0], display_name: "Tampered" }],
      },
    }),
    /fingerprint does not match/,
  );
});

test("migration loading rejects duplicate numeric versions", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kaizen-migration-versions-"));
  try {
    await writeFile(path.join(temporaryDirectory, "001_first.sql"), "SELECT 1;\n", "utf8");
    await writeFile(path.join(temporaryDirectory, "001_second.sql"), "SELECT 2;\n", "utf8");
    await assert.rejects(
      () => loadMigrations(temporaryDirectory),
      /version 001 is used by more than one file/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("canonical fingerprints ignore object key order but preserve array order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.equal(logicalFingerprint({ b: 2, a: 1 }), logicalFingerprint({ a: 1, b: 2 }));
  assert.notEqual(logicalFingerprint([1, 2]), logicalFingerprint([2, 1]));
});

test("diagnostic sanitization removes database URLs and API keys", () => {
  const message = sanitizeError(
    new Error("failed postgresql://user:password@localhost/database with re_secretValue"),
  );
  assert.equal(message.includes("password"), false);
  assert.equal(message.includes("re_secretValue"), false);
  assert.match(message, /REDACTED_DATABASE_URL/);
  assert.match(message, /REDACTED_API_KEY/);
});

async function loadSource(directory) {
  return loadOperationalSource({
    sourceDirectory: directory,
    projectionManifestPath,
    allowRuntimeProjection: true,
  });
}

async function copySourceDirectory() {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kaizen-operational-source-"));
  for (const name of OPERATIONAL_SOURCE_FILES) {
    await cp(path.join(sourceDirectory, name), path.join(temporaryDirectory, name));
  }
  return temporaryDirectory;
}

async function sourceChecksums(directory) {
  const result = {};
  for (const name of OPERATIONAL_SOURCE_FILES) {
    result[name] = createHash("sha256")
      .update(await readFile(path.join(directory, name)))
      .digest("hex");
  }
  return result;
}
