import "server-only";

import {
  resolveOperationalDataBackend,
  type OperationalDataBackend,
} from "./backend-policy";

export type { OperationalDataBackend } from "./backend-policy";

export function getOperationalDataBackend(): OperationalDataBackend {
  return resolveOperationalDataBackend(
    process.env.OPERATIONAL_DATA_BACKEND,
    process.env.NODE_ENV,
  );
}
