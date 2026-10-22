import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
});

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
      path.join(temporaryDirectory, "006_transaction_rollback_test.sql"),
      "CREATE TABLE migration_rollback_probe (id integer);\nSELECT * FROM missing_migration_relation;\n",
      "utf8",
    );
    await assert.rejects(
      () => runMigrations({ connectionString, migrationsDirectory: temporaryDirectory, logger }),
      /Failed to apply 006_transaction_rollback_test.sql/,
    );
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(
        "SELECT to_regclass('public.migration_rollback_probe') AS relation",
      );
      assert.equal(result.rows[0].relation, null);
      const ledger = await client.query(
        "SELECT 1 FROM identity_schema_migration WHERE name = '006_transaction_rollback_test.sql'",
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
