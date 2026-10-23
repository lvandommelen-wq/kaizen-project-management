export type MicrosoftIdentityClaims = {
  tenantId: string;
  objectId: string;
  subject: string;
  email: string;
  accountType: 0 | 1;
};

export function readMicrosoftClaims(
  profile: Record<string, unknown>,
  expectedTenantId: string,
  expectedObjectId?: string,
): MicrosoftIdentityClaims {
  const tenantId = typeof profile.tid === "string" ? profile.tid.toLowerCase() : "";
  const objectId = typeof profile.oid === "string" ? profile.oid.toLowerCase() : "";
  const subject = typeof profile.sub === "string" ? profile.sub : "";
  const accountType = profile.acct === 0 ? 0 : 1;

  if (tenantId !== expectedTenantId.toLowerCase()) {
    throw new Error("The Microsoft identity was issued by an unexpected tenant.");
  }
  if (!isUuid(objectId) || (expectedObjectId && objectId !== expectedObjectId.toLowerCase())) {
    throw new Error("The Microsoft identity does not contain the expected object ID.");
  }
  if (!subject) {
    throw new Error("The Microsoft identity does not contain a provider subject.");
  }

  const email = resolveMicrosoftEmail(profile);
  if (!email) {
    throw new Error("The Microsoft account did not provide a usable email address.");
  }

  return { tenantId, objectId, subject, email, accountType };
}

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

function resolveMicrosoftEmail(profile: Record<string, unknown>) {
  for (const candidate of [profile.email, profile.preferred_username]) {
    if (typeof candidate !== "string") continue;
    const normalized = normalizeEmailAddress(candidate);
    if (isEmailAddress(normalized)) return normalized;
  }
  return null;
}

function isEmailAddress(value: string) {
  if (value.length > 254) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
