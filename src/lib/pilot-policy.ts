type Environment = Readonly<Record<string, string | undefined>>;

export type PilotIdentity = {
  providerTenantId: string;
  providerObjectId: string;
};

type OwnerOnlyPilotPolicy = {
  enabled: boolean;
  tenantId: string | null;
  objectId: string | null;
};

export function getOwnerOnlyPilotConfigurationIssues(
  environment: Environment = process.env,
) {
  const value = environment.OWNER_ONLY_PILOT?.trim();
  if (!value || value === "false") return [];
  if (value !== "true") {
    return ['OWNER_ONLY_PILOT must be exactly "true" or "false".'];
  }

  const issues: string[] = [];
  if (!isUuid(environment.PILOT_OWNER_TENANT_ID?.trim())) {
    issues.push("PILOT_OWNER_TENANT_ID must be a UUID when OWNER_ONLY_PILOT is enabled.");
  }
  if (!isUuid(environment.PILOT_OWNER_OBJECT_ID?.trim())) {
    issues.push("PILOT_OWNER_OBJECT_ID must be a UUID when OWNER_ONLY_PILOT is enabled.");
  }
  return issues;
}

export function isOwnerOnlyPilotEnabled(
  environment: Environment = process.env,
) {
  return readOwnerOnlyPilotPolicy(environment).enabled;
}

export function isPilotIdentityAllowed(
  identity: PilotIdentity,
  environment: Environment = process.env,
) {
  const policy = readOwnerOnlyPilotPolicy(environment);
  if (!policy.enabled) return true;
  return identity.providerTenantId.toLowerCase() === policy.tenantId
    && identity.providerObjectId.toLowerCase() === policy.objectId;
}

export function isAutomaticUserCreationAllowed(
  environment: Environment = process.env,
) {
  return !readOwnerOnlyPilotPolicy(environment).enabled;
}

export function isExternalGateReviewAccessEnabled(
  environment: Environment = process.env,
) {
  return !readOwnerOnlyPilotPolicy(environment).enabled;
}

function readOwnerOnlyPilotPolicy(environment: Environment): OwnerOnlyPilotPolicy {
  const issues = getOwnerOnlyPilotConfigurationIssues(environment);
  if (issues.length > 0) {
    throw new Error(`Owner-only pilot configuration is invalid: ${issues.join(" ")}`);
  }

  const enabled = environment.OWNER_ONLY_PILOT?.trim() === "true";
  return {
    enabled,
    tenantId: enabled ? environment.PILOT_OWNER_TENANT_ID!.trim().toLowerCase() : null,
    objectId: enabled ? environment.PILOT_OWNER_OBJECT_ID!.trim().toLowerCase() : null,
  };
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
