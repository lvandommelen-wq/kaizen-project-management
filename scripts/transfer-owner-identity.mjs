import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const USER_KEYS = [
  "id", "display_name", "email", "normalized_email", "email_verified", "image",
  "organization_id", "status", "access_class", "last_authenticated_at", "created_at", "updated_at",
];
const IDENTITY_KEYS = [
  "id", "provider", "provider_object_id", "user_id", "access_token_expires_at",
  "refresh_token_expires_at", "scope", "provider_tenant_id", "provider_subject",
  "provider_email_snapshot", "entra_account_type", "last_authenticated_at", "created_at", "updated_at",
];
const ORGANIZATION_KEYS = ["id", "name", "status", "created_at", "updated_at"];
const REQUIRED_MIGRATIONS = [
  "001_identity_foundation.sql",
  "002_better_auth_uuid_defaults.sql",
  "003_remove_stored_id_tokens.sql",
  "004_operational_data_foundation.sql",
  "005_protect_gate_review_attempt_history.sql",
  "006_runtime_persistence_safety.sql",
  "007_project_authorization_audit.sql",
];

async function main() {
  const command = process.argv[2];
  if (command === "export") {
    await exportOwnerIdentity();
    return;
  }
  if (command === "import") {
    await importOwnerIdentity();
    return;
  }
  throw new Error("Usage: transfer-owner-identity.mjs <export|import> --output/--input <ignored-json-path> [--apply]");
}

async function exportOwnerIdentity() {
  const connectionString = requiredEnvironment("IDENTITY_SOURCE_DATABASE_URL");
  const tenantId = requiredUuidEnvironment("PILOT_OWNER_TENANT_ID");
  const objectId = requiredUuidEnvironment("PILOT_OWNER_OBJECT_ID");
  const outputPath = requiredOption("--output");
  const outputRoot = path.resolve(".migration-reports");
  const resolvedOutputPath = path.resolve(outputPath);
  if (!resolvedOutputPath.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("Owner identity exports must be written below the ignored .migration-reports directory.");
  }
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const identityResult = await client.query(
      `SELECT ${IDENTITY_KEYS.map((key) => `ui.${key}`).join(", ")}
       FROM user_identity ui
       WHERE ui.provider = 'microsoft'
         AND lower(ui.provider_tenant_id) = lower($1)
         AND lower(ui.provider_object_id) = lower($2)`,
      [tenantId, objectId],
    );
    if (identityResult.rowCount !== 1) {
      throw new Error("The source must contain exactly one Microsoft identity matching the approved pilot IDs.");
    }

    const identity = identityResult.rows[0];
    const userResult = await client.query(
      `SELECT ${USER_KEYS.join(", ")}
       FROM app_user
       WHERE id = $1`,
      [identity.user_id],
    );
    if (userResult.rowCount !== 1) throw new Error("The approved identity does not resolve to one application User.");
    const user = userResult.rows[0];
    if (user.status !== "active" || user.access_class !== "internal") {
      throw new Error("The approved pilot Owner must be an active internal User before export.");
    }

    const organizationResult = user.organization_id
      ? await client.query(
          `SELECT ${ORGANIZATION_KEYS.join(", ")} FROM organization WHERE id = $1`,
          [user.organization_id],
        )
      : { rows: [], rowCount: 0 };
    if (user.organization_id && organizationResult.rowCount !== 1) {
      throw new Error("The Owner references an organization that could not be exported.");
    }

    const data = JSON.parse(JSON.stringify({
      organizations: organizationResult.rows,
      users: [user],
      identities: [identity],
    }));
    const transfer = createTransfer(data);
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
    await writeFile(resolvedOutputPath, `${JSON.stringify(transfer, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Owner identity export created: users=1 identities=1 fingerprint=${transfer.fingerprint}`);
  } finally {
    await client.end();
  }
}

async function importOwnerIdentity() {
  const inputPath = requiredOption("--input");
  const transfer = validateTransfer(JSON.parse(await readFile(inputPath, "utf8")));
  const tenantId = requiredUuidEnvironment("PILOT_OWNER_TENANT_ID");
  const objectId = requiredUuidEnvironment("PILOT_OWNER_OBJECT_ID");
  const identity = transfer.data.identities[0];
  if (
    identity.provider_tenant_id.toLowerCase() !== tenantId.toLowerCase()
    || identity.provider_object_id.toLowerCase() !== objectId.toLowerCase()
  ) {
    throw new Error("The identity transfer does not match the approved pilot tenant and object IDs.");
  }
  if (!process.argv.includes("--apply")) {
    console.log(`Owner identity import dry run: users=1 identities=1 fingerprint=${transfer.fingerprint}`);
    console.log("No database connection or write was performed. Repeat with --apply to import.");
    return;
  }

  const connectionString = requiredEnvironment("DATABASE_DIRECT_URL");
  if (new URL(connectionString).hostname.includes("-pooler.")) {
    throw new Error("DATABASE_DIRECT_URL must use the direct administrative endpoint, not the pooled runtime endpoint.");
  }
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await assertTargetReady(client);
    for (const organization of transfer.data.organizations) {
      await insertRow(client, "organization", ORGANIZATION_KEYS, organization);
    }
    await insertRow(client, "app_user", USER_KEYS, transfer.data.users[0]);
    await insertIdentity(client, transfer.data.identities[0]);

    const result = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM app_user) AS users,
         (SELECT count(*)::integer FROM user_identity) AS identities,
         (SELECT count(*)::integer FROM auth_session) AS sessions,
         (SELECT count(*)::integer FROM auth_verification) AS verifications`,
    );
    const counts = result.rows[0];
    if (counts.users !== 1 || counts.identities !== 1 || counts.sessions !== 0 || counts.verifications !== 0) {
      throw new Error("Post-import identity counts did not match the restricted pilot invariant.");
    }
    await client.query("COMMIT");
    console.log(`Owner identity import applied: users=1 identities=1 sessions=0 verifications=0 fingerprint=${transfer.fingerprint}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function validateTransfer(value) {
  assertExactKeys(value, ["schemaVersion", "generatedAt", "fingerprint", "data"], "transfer");
  if (value.schemaVersion !== 1 || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    throw new Error("The identity transfer metadata is invalid.");
  }
  if (!/^[0-9a-f]{64}$/.test(value.fingerprint)) throw new Error("The identity transfer fingerprint is invalid.");
  assertExactKeys(value.data, ["organizations", "users", "identities"], "transfer data");
  if (!Array.isArray(value.data.organizations) || value.data.organizations.length > 1) {
    throw new Error("The transfer may contain at most one organization.");
  }
  if (!Array.isArray(value.data.users) || value.data.users.length !== 1) {
    throw new Error("The transfer must contain exactly one User.");
  }
  if (!Array.isArray(value.data.identities) || value.data.identities.length !== 1) {
    throw new Error("The transfer must contain exactly one identity.");
  }
  for (const organization of value.data.organizations) assertExactKeys(organization, ORGANIZATION_KEYS, "organization");
  assertExactKeys(value.data.users[0], USER_KEYS, "User");
  assertExactKeys(value.data.identities[0], IDENTITY_KEYS, "identity");

  const user = value.data.users[0];
  const identity = value.data.identities[0];
  if (user.status !== "active" || user.access_class !== "internal") {
    throw new Error("The transferred Owner must be an active internal User.");
  }
  if (identity.provider !== "microsoft" || identity.user_id !== user.id) {
    throw new Error("The transferred Microsoft identity must reference the transferred User.");
  }
  if (!isUuid(identity.provider_tenant_id) || !isUuid(identity.provider_object_id)) {
    throw new Error("The transferred Microsoft identity IDs must be UUIDs.");
  }
  if (user.organization_id !== null && !value.data.organizations.some(({ id }) => id === user.organization_id)) {
    throw new Error("The transferred User's organization is missing.");
  }
  if (fingerprint(value.data) !== value.fingerprint) {
    throw new Error("The identity transfer fingerprint does not match its contents.");
  }
  return value;
}

export function createTransfer(data, generatedAt = new Date().toISOString()) {
  return validateTransfer({
    schemaVersion: 1,
    generatedAt,
    fingerprint: fingerprint(data),
    data,
  });
}

async function assertTargetReady(client) {
  const migrationResult = await client.query(
    "SELECT name FROM identity_schema_migration ORDER BY name",
  );
  const migrations = migrationResult.rows.map(({ name }) => name);
  if (JSON.stringify(migrations) !== JSON.stringify(REQUIRED_MIGRATIONS)) {
    throw new Error("The target must have exactly migrations 001 through 007 applied before identity import.");
  }
  const countResult = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM organization) AS organizations,
       (SELECT count(*)::integer FROM app_user) AS users,
       (SELECT count(*)::integer FROM user_identity) AS identities,
       (SELECT count(*)::integer FROM auth_session) AS sessions,
       (SELECT count(*)::integer FROM auth_verification) AS verifications`,
  );
  if (Object.values(countResult.rows[0]).some((count) => count !== 0)) {
    throw new Error("The target identity tables must be empty before the Owner identity import.");
  }
}

async function insertRow(client, table, columns, row) {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    columns.map((column) => row[column]),
  );
}

async function insertIdentity(client, identity) {
  const columns = [
    "id", "provider", "provider_object_id", "user_id", "access_token", "refresh_token", "id_token",
    "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "provider_tenant_id",
    "provider_subject", "provider_email_snapshot", "entra_account_type", "last_authenticated_at", "created_at", "updated_at",
  ];
  const row = {
    ...identity,
    access_token: null,
    refresh_token: null,
    id_token: null,
    password: null,
  };
  await insertRow(client, "user_identity", columns, row);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The ${label} must be an object.`);
  }
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new Error(`The ${label} fields do not match the approved transfer schema.`);
  }
}

function fingerprint(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredUuidEnvironment(name) {
  const value = requiredEnvironment(name);
  if (!isUuid(value)) throw new Error(`${name} must be a UUID.`);
  return value;
}

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path.`);
  return value;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown identity transfer error";
    console.error(message.replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[database URL removed]"));
    process.exitCode = 1;
  });
}
