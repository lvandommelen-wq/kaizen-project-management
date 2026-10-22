import "server-only";

import type { UserAccessClass, UserStatus } from "./auth";
import { getAuth } from "./auth";
import { getIdentityPool } from "./database";

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string;
  normalizedEmail: string;
  organizationId: string | null;
  status: UserStatus;
  accessClass: UserAccessClass;
  createdAt: Date;
  updatedAt: Date;
  lastAuthenticatedAt: Date | null;
  providerTenantId: string;
  providerObjectId: string;
};

type CurrentUserRow = {
  id: string;
  display_name: string;
  email: string;
  normalized_email: string;
  organization_id: string | null;
  status: string;
  access_class: string;
  created_at: Date;
  updated_at: Date;
  last_authenticated_at: Date | null;
  provider_tenant_id: string;
  provider_object_id: string;
};

export async function getCurrentUser(requestHeaders: Headers): Promise<CurrentUser | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user.id) return null;

  const result = await getIdentityPool().query<CurrentUserRow>(
    `SELECT app_user.id,
            app_user.display_name,
            app_user.email,
            app_user.normalized_email,
            app_user.organization_id,
            app_user.status,
            app_user.access_class,
            app_user.created_at,
            app_user.updated_at,
             app_user.last_authenticated_at,
             user_identity.provider_tenant_id,
             user_identity.provider_object_id
      FROM app_user
      INNER JOIN user_identity
        ON user_identity.user_id = app_user.id
       AND user_identity.provider = 'microsoft'
      WHERE app_user.id = $1`,
    [session.user.id],
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];

  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    normalizedEmail: row.normalized_email,
    organizationId: row.organization_id,
    status: isUserStatus(row.status) ? row.status : "disabled",
    accessClass: row.access_class === "internal" ? "internal" : "external_reviewer",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAuthenticatedAt: row.last_authenticated_at,
    providerTenantId: row.provider_tenant_id,
    providerObjectId: row.provider_object_id,
  };
}

function isUserStatus(value: string): value is UserStatus {
  return value === "invited" || value === "active" || value === "disabled";
}
