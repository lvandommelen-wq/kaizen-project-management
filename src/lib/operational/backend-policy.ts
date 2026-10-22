export type OperationalDataBackend = "json" | "postgres";

export function resolveOperationalDataBackend(
  configuredBackend: string | undefined,
  nodeEnvironment: string | undefined,
): OperationalDataBackend {
  const selected = configuredBackend === undefined ? "json" : configuredBackend;
  if (selected !== "json" && selected !== "postgres") {
    throw new Error(
      'OPERATIONAL_DATA_BACKEND must be exactly "json" or "postgres".',
    );
  }
  if (nodeEnvironment === "production" && selected === "json") {
    throw new Error(
      'JSON operational persistence is development-only. Set OPERATIONAL_DATA_BACKEND="postgres" for production.',
    );
  }
  return selected;
}
