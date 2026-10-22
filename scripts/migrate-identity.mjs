import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Add it to the ignored .env.local file.");
}

const migrationsDirectory = path.join(process.cwd(), "database", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const pool = new Pool({ connectionString });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS identity_schema_migration (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of migrationFiles) {
    const applied = await pool.query(
      "SELECT 1 FROM identity_schema_migration WHERE name = $1",
      [file],
    );
    if (applied.rowCount) continue;

    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO identity_schema_migration (name) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      console.log(`Applied identity migration: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
