import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const baseConnectionString = process.env.DATABASE_URL?.trim();
if (!baseConnectionString) {
  throw new Error("DATABASE_URL is required to derive disposable local test database URLs.");
}

const baseUrl = new URL(baseConnectionString);
const currentDatabase = decodeURIComponent(baseUrl.pathname.slice(1));
if (currentDatabase !== "kaizen_project_manager_dev") {
  throw new Error(
    `Integration test safety check expected the development URL to name kaizen_project_manager_dev, not ${currentDatabase || "an empty database"}.`,
  );
}

const databaseNameA = "kaizen_project_manager_migration_test_a";
const databaseNameB = "kaizen_project_manager_migration_test_b";
const connectionA = new URL(baseUrl);
const connectionB = new URL(baseUrl);
connectionA.pathname = `/${databaseNameA}`;
connectionB.pathname = `/${databaseNameB}`;

const child = spawn(
  process.execPath,
  ["--test", "scripts/operational-integration.test.mjs"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      OPERATIONAL_TEST_DATABASE_URL_A: connectionA.toString(),
      OPERATIONAL_TEST_DATABASE_URL_B: connectionB.toString(),
      OPERATIONAL_TEST_DATABASE_NAME_A: databaseNameA,
      OPERATIONAL_TEST_DATABASE_NAME_B: databaseNameB,
      OPERATIONAL_TEST_IMPORTER_ROLE: "kaizen_pm_migration_test_importer",
    },
  },
);

child.on("error", (error) => {
  console.error(`Could not start integration tests: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Integration tests terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
