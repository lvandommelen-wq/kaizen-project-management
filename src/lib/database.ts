import "server-only";

import { Pool } from "pg";

declare global {
  var kaizenIdentityPool: Pool | undefined;
}

export function getIdentityPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for identity persistence.");
  }

  if (!globalThis.kaizenIdentityPool) {
    globalThis.kaizenIdentityPool = new Pool({ connectionString });
  }

  return globalThis.kaizenIdentityPool;
}
