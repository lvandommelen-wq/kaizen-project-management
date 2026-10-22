import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

export const MIGRATION_ADVISORY_LOCK_KEY = "784239110294681";

export async function loadMigrations(directory) {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (names.length === 0) {
    throw new Error(`No SQL migrations were found in ${directory}.`);
  }

  const migrations = [];
  const versions = new Set();
  for (const name of names) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) {
      throw new Error(`Migration filename ${name} does not follow NNN_name.sql.`);
    }
    const version = name.slice(0, 3);
    if (versions.has(version)) {
      throw new Error(`Migration version ${version} is used by more than one file.`);
    }
    versions.add(version);

    const sql = await readFile(path.join(directory, name), "utf8");
    migrations.push({
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }

  return migrations;
}

export async function runMigrations({
  connectionString,
  migrationsDirectory,
  statusOnly = false,
  lockTimeoutMs = 30_000,
  logger = console,
}) {
  if (!connectionString) {
    throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");
  }

  const migrations = await loadMigrations(migrationsDirectory);
  const migrationByName = new Map(migrations.map((migration) => [migration.name, migration]));
  const client = new Client({ connectionString });
  await client.connect();

  let locked = false;
  try {
    locked = await acquireMigrationLock(client, lockTimeoutMs);
    if (!locked) {
      throw new Error(
        `Could not acquire the database migration lock within ${lockTimeoutMs} ms. Another migration process may be running.`,
      );
    }

    await bootstrapMigrationLedger(client, migrationByName);
    const appliedRows = await client.query(
      `SELECT name, checksum, applied_at
       FROM identity_schema_migration
       ORDER BY name`,
    );
    const appliedByName = new Map(appliedRows.rows.map((row) => [row.name, row]));

    for (const row of appliedRows.rows) {
      const migration = migrationByName.get(row.name);
      if (!migration) {
        throw new Error(
          `Applied migration ${row.name} is missing from database/migrations. Restore the original file before continuing.`,
        );
      }
      if (row.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for ${row.name}. Applied ${row.checksum}; current ${migration.checksum}. Previously applied migrations must not be changed.`,
        );
      }
    }

    const status = migrations.map((migration) => ({
      name: migration.name,
      checksum: migration.checksum,
      state: appliedByName.has(migration.name) ? "applied" : "pending",
      appliedAt: appliedByName.get(migration.name)?.applied_at ?? null,
    }));

    if (statusOnly) {
      for (const item of status) {
        logger.log(`${item.state.padEnd(7)} ${item.name} ${item.checksum}`);
      }
      return status;
    }

    for (const migration of migrations) {
      if (appliedByName.has(migration.name)) continue;

      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO identity_schema_migration (name, checksum)
           VALUES ($1, $2)`,
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        logger.log(`applied ${migration.name} ${migration.checksum}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Failed to apply ${migration.name}: ${safeErrorMessage(error)}`, {
          cause: error,
        });
      }
    }

    return migrations.map((migration) => ({
      name: migration.name,
      checksum: migration.checksum,
      state: "applied",
    }));
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [
        MIGRATION_ADVISORY_LOCK_KEY,
      ]).catch(() => undefined);
    }
    await client.end();
  }
}

async function acquireMigrationLock(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [MIGRATION_ADVISORY_LOCK_KEY],
    );
    if (result.rows[0]?.acquired === true) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

async function bootstrapMigrationLedger(client, migrationByName) {
  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity_schema_migration (
        name text PRIMARY KEY,
        checksum text,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      "ALTER TABLE identity_schema_migration ADD COLUMN IF NOT EXISTS checksum text",
    );

    const rows = await client.query(
      "SELECT name, checksum FROM identity_schema_migration ORDER BY name FOR UPDATE",
    );
    for (const row of rows.rows) {
      const migration = migrationByName.get(row.name);
      if (!migration) {
        throw new Error(
          `Applied migration ${row.name} is missing from database/migrations.`,
        );
      }
      if (row.checksum === null) {
        await client.query(
          "UPDATE identity_schema_migration SET checksum = $1 WHERE name = $2",
          [migration.checksum, row.name],
        );
      }
    }

    await client.query(
      "ALTER TABLE identity_schema_migration ALTER COLUMN checksum SET NOT NULL",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown database error";
}
