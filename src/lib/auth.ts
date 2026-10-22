import "server-only";

import { betterAuth } from "better-auth";
import { decodeJwt } from "jose";
import type { Pool } from "pg";
import { getIdentityPool } from "./database";

export const userStatuses = ["invited", "active", "disabled"] as const;
export const userAccessClasses = ["internal", "external_reviewer"] as const;

export type UserStatus = (typeof userStatuses)[number];
export type UserAccessClass = (typeof userAccessClasses)[number];

const requiredAuthEnvironmentVariables = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "DATABASE_URL",
] as const;

type AuthEnvironment = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  secret: string;
  tenantId: string;
};

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuthConfigurationIssues() {
  const issues: string[] = [];

  for (const name of requiredAuthEnvironmentVariables) {
    if (!process.env[name]?.trim()) issues.push(`${name} is not configured.`);
  }

  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length < 32) {
    issues.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }

  const baseUrl = process.env.BETTER_AUTH_URL?.trim();
  if (baseUrl && !isHttpUrl(baseUrl)) {
    issues.push("BETTER_AUTH_URL must be an absolute HTTP or HTTPS URL.");
  }

  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim();
  if (tenantId && !isUuid(tenantId)) {
    issues.push("MICROSOFT_TENANT_ID must be the Directory tenant UUID.");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl && !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    issues.push("DATABASE_URL must be a PostgreSQL connection URL.");
  }

  return issues;
}

export function isAuthenticationConfigured() {
  return getAuthConfigurationIssues().length === 0;
}

export function getAuth() {
  if (authInstance) return authInstance;

  const environment = requireAuthEnvironment();
  authInstance = createAuth(environment, getIdentityPool());
  return authInstance;
}

function createAuth(environment: AuthEnvironment, pool: Pool) {
  return betterAuth({
    appName: "Kaizen Project Management",
    baseURL: environment.baseUrl,
    secret: environment.secret,
    database: pool,
    trustedOrigins: [new URL(environment.baseUrl).origin],
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    socialProviders: {
      microsoft: {
        clientId: environment.clientId,
        clientSecret: environment.clientSecret,
        tenantId: environment.tenantId,
        prompt: "select_account",
        disableDefaultScope: true,
        disableProfilePhoto: true,
        scope: ["openid", "profile", "email"],
        mapProfileToUser(profile) {
          const claims = readMicrosoftClaims(profile, environment.tenantId);
          if (!claims.email) {
            throw new Error("The Microsoft account did not provide an email address.");
          }

          return {
            normalizedEmail: normalizeEmail(claims.email),
          };
        },
      },
    },
    user: {
      modelName: "app_user",
      fields: {
        name: "display_name",
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        normalizedEmail: {
          type: "string",
          required: true,
          input: false,
          defaultValue: "",
          fieldName: "normalized_email",
        },
        organizationId: {
          type: "string",
          required: false,
          input: false,
          fieldName: "organization_id",
        },
        status: {
          type: "string",
          required: true,
          input: false,
          defaultValue: "active",
        },
        accessClass: {
          type: "string",
          required: true,
          input: false,
          defaultValue: "external_reviewer",
          fieldName: "access_class",
        },
        lastAuthenticatedAt: {
          type: "date",
          required: false,
          input: false,
          fieldName: "last_authenticated_at",
        },
      },
    },
    session: {
      modelName: "auth_session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "user_identity",
      fields: {
        providerId: "provider",
        accountId: "provider_object_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        providerTenantId: {
          type: "string",
          required: true,
          input: false,
          returned: false,
          fieldName: "provider_tenant_id",
        },
        providerSubject: {
          type: "string",
          required: true,
          input: false,
          returned: false,
          fieldName: "provider_subject",
        },
        providerEmailSnapshot: {
          type: "string",
          required: false,
          input: false,
          returned: false,
          fieldName: "provider_email_snapshot",
        },
        entraAccountType: {
          type: "number",
          required: true,
          input: false,
          returned: false,
          fieldName: "entra_account_type",
        },
        lastAuthenticatedAt: {
          type: "date",
          required: true,
          input: false,
          returned: false,
          fieldName: "last_authenticated_at",
        },
      },
      accountLinking: {
        enabled: false,
      },
      encryptOAuthTokens: true,
    },
    verification: {
      modelName: "auth_verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            return {
              data: {
                ...user,
                normalizedEmail: normalizeEmail(user.email),
                organizationId: null,
                status: "active",
                accessClass: "external_reviewer",
                lastAuthenticatedAt: null,
              },
            };
          },
        },
      },
      account: {
        create: {
          async before(account) {
            if (account.providerId !== "microsoft" || !account.idToken) {
              throw new Error("Only Microsoft Entra identities are supported.");
            }

            const decoded = decodeJwt(account.idToken);
            const claims = readMicrosoftClaims(decoded, environment.tenantId, account.accountId);
            const now = new Date();

            return {
              data: {
                ...account,
                idToken: null,
                providerTenantId: claims.tenantId,
                providerSubject: claims.subject,
                providerEmailSnapshot: claims.email,
                entraAccountType: claims.accountType,
                lastAuthenticatedAt: now,
              },
            };
          },
        },
        update: {
          async before(account) {
            if (account.providerId === undefined) return;
            if (account.providerId !== "microsoft" || !account.idToken) {
              throw new Error("Only Microsoft Entra identities are supported.");
            }

            const decoded = decodeJwt(account.idToken);
            const claims = readMicrosoftClaims(decoded, environment.tenantId);

            return {
              data: {
                ...account,
                idToken: null,
                providerTenantId: claims.tenantId,
                providerSubject: claims.subject,
                providerEmailSnapshot: claims.email,
                entraAccountType: claims.accountType,
                lastAuthenticatedAt: new Date(),
              },
            };
          },
        },
      },
      session: {
        create: {
          async before(session) {
            const result = await pool.query<{
              status: string;
              provider_object_id: string;
              provider_subject: string;
              provider_email_snapshot: string | null;
              entra_account_type: number;
            }>(
              `SELECT app_user.status,
                      user_identity.provider_object_id,
                      user_identity.provider_subject,
                      user_identity.provider_email_snapshot,
                      user_identity.entra_account_type
               FROM app_user
               INNER JOIN user_identity ON user_identity.user_id = app_user.id
                WHERE app_user.id = $1
                  AND user_identity.provider = 'microsoft'
                  AND user_identity.provider_tenant_id = $2`,
              [session.userId, environment.tenantId],
            );
            if (result.rows.length !== 1) return false;

            const identity = result.rows[0];
            const email = identity.provider_email_snapshot?.trim();
            if (
              identity.status !== "active"
              || !isUuid(identity.provider_object_id)
              || !identity.provider_subject.trim()
              || !email
            ) {
              return false;
            }

            const accessClass: UserAccessClass = identity.entra_account_type === 0
              ? "internal"
              : "external_reviewer";
            const updateResult = await pool.query(
              `UPDATE app_user
               SET access_class = $1,
                   normalized_email = $2,
                   updated_at = $3
               WHERE id = $4`,
              [accessClass, normalizeEmail(email), new Date(), session.userId],
            );

            return updateResult.rowCount === 1;
          },
          async after(session) {
            const now = new Date();
            await Promise.all([
              pool.query(
                `UPDATE app_user
                 SET last_authenticated_at = $1,
                     updated_at = $1
                 WHERE id = $2`,
                [now, session.userId],
              ),
              pool.query(
                `UPDATE user_identity
                 SET last_authenticated_at = $1,
                     updated_at = $1
                 WHERE user_id = $2
                   AND provider = 'microsoft'`,
                [now, session.userId],
              ),
            ]);
          },
        },
      },
    },
  });
}

function requireAuthEnvironment(): AuthEnvironment {
  const issues = getAuthConfigurationIssues();
  if (issues.length > 0) {
    throw new Error(`Authentication is not configured: ${issues.join(" ")}`);
  }

  return {
    baseUrl: process.env.BETTER_AUTH_URL!.trim(),
    clientId: process.env.MICROSOFT_CLIENT_ID!.trim(),
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!.trim(),
    secret: process.env.BETTER_AUTH_SECRET!.trim(),
    tenantId: process.env.MICROSOFT_TENANT_ID!.trim().toLowerCase(),
  };
}

function readMicrosoftClaims(
  profile: Record<string, unknown>,
  expectedTenantId: string,
  expectedObjectId?: string,
) {
  const tenantId = typeof profile.tid === "string" ? profile.tid.toLowerCase() : "";
  const objectId = typeof profile.oid === "string" ? profile.oid.toLowerCase() : "";
  const subject = typeof profile.sub === "string" ? profile.sub : "";
  const email = typeof profile.email === "string" ? profile.email.trim() : null;
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

  return { tenantId, objectId, subject, email, accountType };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
