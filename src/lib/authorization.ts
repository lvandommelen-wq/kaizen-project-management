import "server-only";

import { headers } from "next/headers";
import type { PoolClient } from "pg";
import { insertAuditEvent, type AuditEventInput } from "./audit";
import type { CurrentUser } from "./current-user";
import { getCurrentUser } from "./current-user";
import { getOperationalDataBackend } from "./operational/backend";
import { withOperationalTransaction } from "./operational/transaction";
import {
  projectMembershipRoles,
  projectRoleAllows,
  type ProjectMembershipRole,
} from "./project-permissions";

export { projectMembershipRoles, type ProjectMembershipRole } from "./project-permissions";

export async function requireActiveUser() {
  const user = await getCurrentUser(await headers());
  if (!user || user.status !== "active") {
    throw new Error("An active authenticated User is required.");
  }
  return user;
}

export async function requireInternalUser() {
  const user = await requireActiveUser();
  if (user.accessClass !== "internal") {
    throw new Error("Internal application access is required.");
  }
  return user;
}

export async function getCurrentProjectRole(projectId: string) {
  const user = await requireInternalUser();
  if (getOperationalDataBackend() === "json") {
    return { user, role: "owner" as const };
  }

  const role = await withOperationalTransaction((client) =>
    loadProjectRole(client, projectId, user.id, false),
  );
  return role ? { user, role } : null;
}

export async function requireProjectRole(
  projectId: string,
  minimumRole: ProjectMembershipRole,
) {
  const access = await getCurrentProjectRole(projectId);
  if (!access || !projectRoleAllows(access.role, minimumRole)) {
    throw new Error("You do not have permission to perform this Project operation.");
  }
  return access;
}

export async function withAuthorizedProjectMutation<T>(input: {
  projectId: string;
  minimumRole: ProjectMembershipRole;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (actor: CurrentUser) => Promise<T>;
  isSuccess?: (result: T) => boolean;
}) {
  const user = await requireInternalUser();
  if (getOperationalDataBackend() === "json") return input.operation(user);

  return withOperationalTransaction(async (client) => {
    const role = await loadProjectRole(client, input.projectId, user.id, true);
    if (!role || !projectRoleAllows(role, input.minimumRole)) {
      throw new Error("You do not have permission to perform this Project operation.");
    }

    const result = await input.operation(user);
    if (input.isSuccess?.(result) ?? (result !== null && result !== false)) {
      const audit = typeof input.audit === "function" ? input.audit(result) : input.audit;
      await insertAuditEvent(client, user, input.projectId, audit);
    }
    return result;
  });
}

export async function withAuthorizedProjectCreation<T extends { id: string }>(input: {
  operation: (actor: CurrentUser) => Promise<T>;
  audit: Omit<AuditEventInput, "resourceId">;
}) {
  const user = await requireInternalUser();
  if (getOperationalDataBackend() === "json") return input.operation(user);

  return withOperationalTransaction(async (client) => {
    const project = await input.operation(user);
    await client.query(
      `INSERT INTO project_membership (project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'owner', now(), now())
       ON CONFLICT (project_id, user_id) DO UPDATE
         SET role = 'owner', updated_at = now()`,
      [project.id, user.id],
    );
    await insertAuditEvent(client, user, project.id, {
      ...input.audit,
      resourceId: project.id,
    });
    return project;
  });
}

async function loadProjectRole(
  client: PoolClient,
  projectId: string,
  userId: string,
  lock: boolean,
) {
  const result = await client.query<{ role: string }>(
    `SELECT membership.role
     FROM project_membership AS membership
     JOIN project ON project.id = membership.project_id
     JOIN app_user ON app_user.id = membership.user_id
     WHERE membership.project_id = $1
       AND membership.user_id = $2
       AND project.archived_at IS NULL
       AND app_user.status = 'active'
       AND app_user.access_class = 'internal'
     ${lock ? "FOR UPDATE OF membership, project" : ""}`,
    [projectId, userId],
  );
  const role = result.rows[0]?.role;
  return projectMembershipRoles.includes(role as ProjectMembershipRole)
    ? role as ProjectMembershipRole
    : null;
}
