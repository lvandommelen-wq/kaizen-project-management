import type { NextConfig } from "next";
import { resolveOperationalDataBackend } from "./src/lib/operational/backend-policy";

resolveOperationalDataBackend(
  process.env.OPERATIONAL_DATA_BACKEND,
  process.env.NODE_ENV,
);

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
