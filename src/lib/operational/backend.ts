import "server-only";

export type OperationalDataBackend = "json" | "postgres";

export function getOperationalDataBackend(): OperationalDataBackend {
  const backend = process.env.OPERATIONAL_DATA_BACKEND;
  if (backend === undefined) return "json";
  if (backend === "json" || backend === "postgres") return backend;

  throw new Error(
    'OPERATIONAL_DATA_BACKEND must be exactly "json" or "postgres".',
  );
}
