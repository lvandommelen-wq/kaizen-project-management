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
};

export async function getCurrentUser(requestHeaders: Headers): Promise<CurrentUser | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user.id) return null;

  const result = await getIdentityPool().query<CurrentUserRow>(
    `SELECT id,
            display_name,
            email,
            normalized_email,
            organization_id,
            status,
            access_class,
            created_at,
            updated_at,
            last_authenticated_at
     FROM app_user
     WHERE id = $1
     LIMIT 1`,
    [session.user.id],
  );
  const row = result.rows[0];
  if (!row) return null;

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
  };
}

function isUserStatus(value: string): value is UserStatus {
  return value === "invited" || value === "active" || value === "disabled";
}
