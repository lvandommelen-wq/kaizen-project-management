import "server-only";

import type { PoolClient } from "pg";
import { getOperationalPool } from "../database";

const defaultStatementTimeoutMs = 10_000;

export async function withOperationalTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
  statementTimeoutMs = defaultStatementTimeoutMs,
): Promise<T> {
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1) {
    throw new Error("The operational statement timeout must be a positive integer.");
  }

  let client: PoolClient;
  try {
    client = await getOperationalPool().connect();
  } catch {
    throw new Error("Could not connect to the operational database.");
  }

  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
    const schema = await client.query(
      `SELECT 1 FROM identity_schema_migration
       WHERE name = '006_runtime_persistence_safety.sql'`,
    );
    if (schema.rowCount !== 1) {
      throw new Error("Operational PostgreSQL migration 006 has not been applied.");
    }
    const result = await operation(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
