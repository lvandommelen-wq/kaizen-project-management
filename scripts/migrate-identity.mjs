import { existsSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "./migration-runner.mjs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const connectionString =
  process.env.DATABASE_DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error(
    "DATABASE_DIRECT_URL or DATABASE_URL is required. Add it to an ignored environment file.",
  );
}

const migrationsDirectory = path.join(process.cwd(), "database", "migrations");
const statusOnly = process.argv.includes("--status");

await runMigrations({
  connectionString,
  migrationsDirectory,
  statusOnly,
});
