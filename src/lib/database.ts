import "server-only";

import { Pool } from "pg";

declare global {
  var kaizenDatabasePool: Pool | undefined;
}

function getDatabasePool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database persistence.");
  }

  if (!globalThis.kaizenDatabasePool) {
    try {
      globalThis.kaizenDatabasePool = new Pool({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      });
    } catch {
      throw new Error("DATABASE_URL is not a valid database connection configuration.");
    }
  }

  return globalThis.kaizenDatabasePool;
}

export function getIdentityPool() {
  return getDatabasePool();
}

export function getOperationalPool() {
  return getDatabasePool();
}
