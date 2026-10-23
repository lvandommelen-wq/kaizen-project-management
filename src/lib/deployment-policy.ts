import { getOwnerOnlyPilotConfigurationIssues } from "./pilot-policy.ts";

type Environment = Readonly<Record<string, string | undefined>>;

const requiredProductionVariables = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "APP_BASE_URL",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "GATE_REVIEW_OTP_SECRET",
] as const;

const prohibitedPublicVariables = [
  "NEXT_PUBLIC_BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_MICROSOFT_CLIENT_SECRET",
  "NEXT_PUBLIC_DATABASE_URL",
  "NEXT_PUBLIC_DATABASE_DIRECT_URL",
  "NEXT_PUBLIC_RESEND_API_KEY",
  "NEXT_PUBLIC_GATE_REVIEW_OTP_SECRET",
] as const;

export function getProductionConfigurationIssues(
  environment: Environment = process.env,
) {
  if (environment.NODE_ENV !== "production") return [];

  const issues: string[] = [];
  for (const name of requiredProductionVariables) {
    if (!environment[name]?.trim()) issues.push(`${name} is required in production.`);
  }

  if (environment.OPERATIONAL_DATA_BACKEND !== "postgres") {
    issues.push('OPERATIONAL_DATA_BACKEND must be exactly "postgres" in production.');
  }
  if (environment.OWNER_ONLY_PILOT !== "true") {
    issues.push('OWNER_ONLY_PILOT must be exactly "true" during the restricted production pilot.');
  }
  issues.push(...getOwnerOnlyPilotConfigurationIssues(environment));

  const secret = environment.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length < 32) {
    issues.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  const otpSecret = environment.GATE_REVIEW_OTP_SECRET?.trim();
  if (otpSecret && otpSecret.length < 32) {
    issues.push("GATE_REVIEW_OTP_SECRET must contain at least 32 characters.");
  }

  const authUrl = productionBaseUrl(environment.BETTER_AUTH_URL, "BETTER_AUTH_URL", issues);
  const appUrl = productionBaseUrl(environment.APP_BASE_URL, "APP_BASE_URL", issues);
  if (authUrl && appUrl && authUrl.origin !== appUrl.origin) {
    issues.push("BETTER_AUTH_URL and APP_BASE_URL must use the same production origin.");
  }

  if (!isUuid(environment.MICROSOFT_CLIENT_ID?.trim())) {
    issues.push("MICROSOFT_CLIENT_ID must be a UUID in production.");
  }
  const tenantId = environment.MICROSOFT_TENANT_ID?.trim();
  if (!isUuid(tenantId)) {
    issues.push("MICROSOFT_TENANT_ID must be a UUID in production.");
  }
  const pilotTenantId = environment.PILOT_OWNER_TENANT_ID?.trim();
  if (isUuid(tenantId) && isUuid(pilotTenantId) && tenantId.toLowerCase() !== pilotTenantId.toLowerCase()) {
    issues.push("PILOT_OWNER_TENANT_ID must match MICROSOFT_TENANT_ID.");
  }

  validateRuntimeDatabaseUrl(environment.DATABASE_URL, issues);

  for (const name of prohibitedPublicVariables) {
    if (environment[name]?.trim()) issues.push(`${name} must never be configured.`);
  }

  if (environment.VERCEL === "1") {
    for (const name of ["DATABASE_DIRECT_URL", "OPERATIONAL_DATABASE_URL"] as const) {
      if (environment[name]?.trim()) {
        issues.push(`${name} must not be available to the Vercel runtime.`);
      }
    }
  }

  return [...new Set(issues)];
}

export function assertProductionConfiguration(
  environment: Environment = process.env,
) {
  const issues = getProductionConfigurationIssues(environment);
  if (issues.length > 0) {
    throw new Error(`Production configuration is unsafe:\n- ${issues.join("\n- ")}`);
  }
}

function productionBaseUrl(
  value: string | undefined,
  name: string,
  issues: string[],
) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== "/"
    ) {
      issues.push(`${name} must be a credential-free HTTPS origin without a path, query or fragment.`);
      return null;
    }
    return url;
  } catch {
    issues.push(`${name} must be a valid absolute HTTPS URL.`);
    return null;
  }
}

function validateRuntimeDatabaseUrl(value: string | undefined, issues: string[]) {
  if (!value?.trim()) return;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      issues.push("DATABASE_URL must be a PostgreSQL connection URL.");
      return;
    }
    if (!url.hostname.includes("-pooler.")) {
      issues.push("DATABASE_URL must use the Neon pooled runtime endpoint.");
    }
    if (!new Set(["require", "verify-full"]).has(url.searchParams.get("sslmode") ?? "")) {
      issues.push("DATABASE_URL must require TLS with sslmode=require or sslmode=verify-full.");
    }
  } catch {
    issues.push("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
