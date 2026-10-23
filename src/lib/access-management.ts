import "server-only";

import type { PoolClient } from "pg";
import {
  getAccessibleModuleScopes,
  validateDelegatedAccessGrant,
  withDelegatedAccessMutation,
  type DelegatedGrantProposal,
} from "./access-authorization";
import {
  accessModuleLabel,
  maximumAccessPermission,
  packageAccessModules,
  type AccessAuthorityRole,
  type AccessPermission,
  type AccessScopeType,
  type AssignableAccessModule,
  type EffectiveAccessPermission,
} from "./access-permissions";
import { insertAuditEvent } from "./audit";
import type { CurrentUser } from "./current-user";
import { getOperationalPool } from "./database";
import { withOperationalTransaction } from "./operational/transaction";

export type AccessManagementAuthority = "owner" | "project_access_manager" | "package_lead";

export type AccessManagementUser = {
  id: string;
  displayName: string;
  email: string;
};

export type AccessManagementPackage = {
  id: string;
  packageCode: string;
  packageName: string;
};

export type AccessGrantView = {
  id: string;
  user: AccessManagementUser;
  userAccessClass: string;
  scopeType: AccessScopeType;
  projectPackage: AccessManagementPackage | null;
  authorityRole: AccessAuthorityRole;
  permissions: Record<AssignableAccessModule, EffectiveAccessPermission>;
  actionsPermission: EffectiveAccessPermission;
  origin: string;
  createdAt: string;
  updatedAt: string;
};

export type AccessHistoryView = {
  id: string;
  occurredAt: string;
  actorName: string;
  eventType: string;
  targetName: string;
  targetEmail: string;
  scopeLabel: string;
  authorityLabel: string;
  permissionLabel: string;
};

export type PackageUserAccessView = {
  user: AccessManagementUser;
  entireProjectGrant: AccessGrantView | null;
  packageGrant: AccessGrantView | null;
  effectivePermission: EffectiveAccessPermission;
  effectivePermissions: Record<AssignableAccessModule, EffectiveAccessPermission>;
};

export type ProjectAccessManagementView = {
  authority: "owner" | "project_access_manager";
  project: { id: string; projectNumber: string; name: string };
  owners: AccessManagementUser[];
  packages: AccessManagementPackage[];
  grants: AccessGrantView[];
  assignableUsers: AccessManagementUser[];
  history: AccessHistoryView[];
  hasProjectMembership: boolean;
};

export type PackageAccessManagementView = {
  authority: AccessManagementAuthority;
  project: { id: string; projectNumber: string; name: string };
  projectPackage: AccessManagementPackage;
  owners: AccessManagementUser[];
  users: PackageUserAccessView[];
  assignableUsers: AccessManagementUser[];
  history: AccessHistoryView[];
  actorPermissionCeilings: Record<AssignableAccessModule, EffectiveAccessPermission>;
  hasProjectMembership: boolean;
};

export type SaveInternalAccessGrantInput = {
  projectId: string;
  existingGrantId?: string;
  targetUserId: string;
  scopeType: AccessScopeType;
  packageId: string | null;
  authorityRole: AccessAuthorityRole;
  permissions: Array<{
    module: AssignableAccessModule;
    permission: AccessPermission;
  }>;
  expectedExistingPackageId?: string;
};

export class AccessManagementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessManagementInputError";
  }
}

export async function isAccessManagementSchemaAvailable() {
  const client = await getOperationalPool().connect();
  try {
    const result = await client.query(
      `SELECT 1 FROM identity_schema_migration
       WHERE name = '021_full_package_access.sql'`,
    );
    return result.rowCount === 1;
  } finally {
    client.release();
  }
}

export async function canAccessAnyProjectAccessManagement(
  user: CurrentUser,
  projectId: string,
) {
  if (!await isAccessManagementSchemaAvailable()) return false;
  const scopes = await getAccessibleModuleScopes({ user, projectId, module: "actions" });
  return scopes.isOwner
    || scopes.isProjectAccessManager
    || scopes.packageLeadPackageIds.length > 0;
}

export async function canManageProjectAccess(user: CurrentUser, projectId: string) {
  if (!await isAccessManagementSchemaAvailable()) return false;
  const scopes = await getAccessibleModuleScopes({ user, projectId, module: "actions" });
  return scopes.isOwner || scopes.isProjectAccessManager;
}

export async function canManagePackageAccess(
  user: CurrentUser,
  projectId: string,
  packageId: string,
) {
  if (!await isAccessManagementSchemaAvailable()) return false;
  const scopes = await getAccessibleModuleScopes({ user, projectId, module: "actions" });
  return scopes.isOwner
    || scopes.isProjectAccessManager
    || scopes.packageLeadPackageIds.includes(packageId);
}

export async function getProjectAccessManagementView(
  user: CurrentUser,
  projectId: string,
): Promise<ProjectAccessManagementView | null> {
  return withOperationalTransaction(async (client) => {
    const scopes = await getAccessibleModuleScopes({ user, projectId, module: "actions" });
    const authority = scopes.isOwner
      ? "owner"
      : scopes.isProjectAccessManager
        ? "project_access_manager"
        : null;
    if (!authority) return null;

    const project = await loadProjectIdentity(client, projectId);
    const owners = await loadProjectOwners(client, projectId);
    const packages = await loadProjectPackages(client, projectId);
    const grants = await loadActiveGrants(client, projectId);
    const assignableUsers = await loadAssignableUsers(client, projectId, user.id);
    const history = await loadAccessHistory(client, projectId, null);
    const hasProjectMembership = await loadProjectMembershipPresence(
      client,
      projectId,
      user.id,
    );
    if (!project) return null;

    return {
      authority,
      project,
      owners,
      packages,
      grants,
      assignableUsers,
      history,
      hasProjectMembership,
    };
  });
}

export async function getPackageAccessManagementView(
  user: CurrentUser,
  projectId: string,
  packageId: string,
): Promise<PackageAccessManagementView | null> {
  return withOperationalTransaction(async (client) => {
    const scopes = await getAccessibleModuleScopes({ user, projectId, module: "actions" });
    const authority = scopes.isOwner
      ? "owner"
      : scopes.isProjectAccessManager
        ? "project_access_manager"
        : scopes.packageLeadPackageIds.includes(packageId)
          ? "package_lead"
          : null;
    if (!authority) return null;

    const project = await loadProjectIdentity(client, projectId);
    const projectPackage = await loadProjectPackage(client, projectId, packageId);
    const owners = await loadProjectOwners(client, projectId);
    const grants = await loadActiveGrants(client, projectId, packageId);
    const assignableUsers = await loadAssignableUsers(client, projectId, user.id);
    const history = await loadAccessHistory(client, projectId, packageId);
    const hasProjectMembership = await loadProjectMembershipPresence(
      client,
      projectId,
      user.id,
    );
    if (!project || !projectPackage) return null;

    const users = groupPackageAccess(grants, packageId);
    const actorPermissionCeilings = {} as Record<
      AssignableAccessModule,
      EffectiveAccessPermission
    >;
    for (const accessModule of packageAccessModules) {
      const moduleScopes = await getAccessibleModuleScopes({
        user,
        projectId,
        module: accessModule,
      });
      actorPermissionCeilings[accessModule] = moduleScopes.isOwner
        ? "read_write"
        : moduleScopes.packages.find((scope) => scope.packageId === packageId)?.permission ?? null;
    }
    return {
      authority,
      project,
      projectPackage,
      owners,
      users,
      assignableUsers,
      history,
      actorPermissionCeilings,
      hasProjectMembership,
    };
  });
}

export async function saveInternalAccessGrant(
  actor: CurrentUser,
  input: SaveInternalAccessGrantInput,
) {
  const proposal = grantProposal(input, "save");
  return withDelegatedAccessMutation({
    actor,
    proposal,
    operation: async (client) => {
      const target = await requireInternalTarget(client, input.targetUserId);
      await requireValidPackageScope(client, input.projectId, input.scopeType, input.packageId);

      let grantId: string;
      let eventType: "access_grant.created" | "access_grant.updated";
      let previousPackageId: string | null = null;
      if (input.existingGrantId) {
        const existing = await client.query<{ package_id: string | null }>(
          `SELECT package_id FROM access_grant
           WHERE id = $1 AND project_id = $2 AND user_id = $3
             AND revoked_at IS NULL
           FOR UPDATE`,
          [input.existingGrantId, input.projectId, input.targetUserId],
        );
        if (existing.rowCount !== 1) {
          throw new AccessManagementInputError("The access assignment is no longer available.");
        }
        previousPackageId = existing.rows[0].package_id;
        if (
          input.expectedExistingPackageId
          && previousPackageId !== input.expectedExistingPackageId
        ) {
          throw new AccessManagementInputError(
            "This access assignment does not belong to the selected Package.",
          );
        }
        let updated;
        try {
          updated = await client.query<{ id: string }>(
            `UPDATE access_grant
             SET scope_type = $1, package_id = $2, authority_role = $3,
                 updated_by_user_id = $4, updated_at = now()
             WHERE id = $5 AND project_id = $6 AND user_id = $7
               AND revoked_at IS NULL
             RETURNING id::text`,
            [
              input.scopeType,
              input.packageId,
              input.authorityRole,
              actor.id,
              input.existingGrantId,
              input.projectId,
              input.targetUserId,
            ],
          );
        } catch (error) {
          if (databaseErrorCode(error) === "23505") {
            throw new AccessManagementInputError(
              "This User already has an active assignment for the selected scope.",
            );
          }
          throw error;
        }
        grantId = updated.rows[0].id;
        eventType = "access_grant.updated";
      } else {
        try {
          const created = await client.query<{ id: string }>(
            `INSERT INTO access_grant (
               project_id, user_id, scope_type, package_id, authority_role,
               origin, created_by_user_id, updated_by_user_id
             ) VALUES ($1, $2, $3, $4, $5, 'manual', $6, $6)
             RETURNING id::text`,
            [
              input.projectId,
              input.targetUserId,
              input.scopeType,
              input.packageId,
              input.authorityRole,
              actor.id,
            ],
          );
          grantId = created.rows[0].id;
        } catch (error) {
          if (databaseErrorCode(error) === "23505") {
            throw new AccessManagementInputError(
              "This User already has an active assignment for the selected scope.",
            );
          }
          throw error;
        }
        eventType = "access_grant.created";
      }

      await client.query(
        `DELETE FROM access_grant_permission
         WHERE grant_id = $1 AND module = ANY($2::text[])`,
        [grantId, packageAccessModules],
      );
      for (const permission of input.permissions) {
        await client.query(
          `INSERT INTO access_grant_permission (
             grant_id, module, permission, created_by_user_id, updated_by_user_id
           ) VALUES ($1, $2, $3, $4, $4)`,
          [grantId, permission.module, permission.permission, actor.id],
        );
      }

      return {
        grantId,
        eventType,
        previousPackageId,
        target,
      };
    },
    audit: (result) => ({
      eventType: result.eventType,
      resourceType: "access_grant",
      resourceId: result.grantId,
      changeSummary: {
        user: result.target.displayName,
        email: result.target.email,
        scope: accessScopeLabel(input.scopeType),
        authority: accessAuthorityLabel(input.authorityRole),
        permissions: permissionSummary(input.permissions),
      },
      metadata: {
        packageId: input.packageId,
        previousPackageId: result.previousPackageId,
      },
    }),
  });
}

export async function revokeInternalAccessGrant(
  actor: CurrentUser,
  input: {
    projectId: string;
    grantId: string;
    confirmNoPackageLead: boolean;
    expectedPackageId?: string;
  },
) {
  return withOperationalTransaction(async (client) => {
    const grant = await loadGrantForMutation(client, input.projectId, input.grantId);
    if (!grant) {
      throw new AccessManagementInputError("The access assignment is no longer available.");
    }
    if (input.expectedPackageId && grant.packageId !== input.expectedPackageId) {
      throw new AccessManagementInputError(
        "This access assignment does not belong to the selected Package.",
      );
    }
    if (grant.targetAccessClass !== "internal") {
      throw new AccessManagementInputError(
        "External collaborator access is not managed in this increment.",
      );
    }
    const proposal: DelegatedGrantProposal = {
      projectId: input.projectId,
      targetUserId: grant.targetUserId,
      scopeType: grant.scopeType,
      packageId: grant.packageId,
      authorityRole: grant.authorityRole,
      permissions: [],
      existingGrantId: input.grantId,
      operation: "revoke",
    };
    await validateDelegatedAccessGrant(actor, proposal);

    if (grant.authorityRole === "package_lead" && grant.packageId) {
      const leads = await client.query<{ id: string }>(
        `SELECT id::text FROM access_grant
         WHERE project_id = $1 AND package_id = $2
           AND authority_role = 'package_lead' AND revoked_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        [input.projectId, grant.packageId],
      );
      if (leads.rowCount === 1 && !input.confirmNoPackageLead) {
        throw new AccessManagementInputError(
          "Confirm that this Package may continue without a designated Package Lead.",
        );
      }
    }

    const revoked = await client.query(
      `UPDATE access_grant
       SET revoked_at = now(), revoked_by_user_id = $1,
           updated_by_user_id = $1, updated_at = now()
       WHERE id = $2 AND project_id = $3 AND revoked_at IS NULL`,
      [actor.id, input.grantId, input.projectId],
    );
    if (revoked.rowCount !== 1) {
      throw new AccessManagementInputError("The access assignment is no longer available.");
    }
    await insertAuditEvent(client, actor, input.projectId, {
      eventType: "access_grant.revoked",
      resourceType: "access_grant",
      resourceId: input.grantId,
      changeSummary: {
        user: grant.targetDisplayName,
        email: grant.targetEmail,
        scope: accessScopeLabel(grant.scopeType),
        authority: accessAuthorityLabel(grant.authorityRole),
        permissions: permissionSummary(grant.permissions),
      },
      metadata: { packageId: grant.packageId },
    });
    return { revoked: true };
  });
}

function grantProposal(
  input: SaveInternalAccessGrantInput,
  operation: "save" | "revoke",
): DelegatedGrantProposal {
  return {
    projectId: input.projectId,
    targetUserId: input.targetUserId,
    scopeType: input.scopeType,
    packageId: input.packageId,
    authorityRole: input.authorityRole,
    permissions: input.permissions,
    existingGrantId: input.existingGrantId,
    operation,
  };
}

async function loadProjectIdentity(client: PoolClient, projectId: string) {
  const result = await client.query<{
    id: string;
    project_number: string;
    name: string;
  }>(
    `SELECT id, project_number, name FROM project
     WHERE id = $1 AND archived_at IS NULL`,
    [projectId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, projectNumber: row.project_number, name: row.name } : null;
}

async function loadProjectOwners(client: PoolClient, projectId: string) {
  const result = await client.query<{
    id: string;
    display_name: string;
    email: string;
  }>(
    `SELECT app_user.id::text, app_user.display_name, app_user.email
     FROM project_membership
     JOIN app_user ON app_user.id = project_membership.user_id
     WHERE project_membership.project_id = $1
       AND project_membership.role = 'owner'
       AND app_user.status = 'active'
       AND app_user.access_class = 'internal'
     ORDER BY app_user.display_name, app_user.id`,
    [projectId],
  );
  return result.rows.map(mapUser);
}

async function loadProjectMembershipPresence(
  client: PoolClient,
  projectId: string,
  userId: string,
) {
  const result = await client.query(
    `SELECT 1 FROM project_membership
     WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  return result.rowCount === 1;
}

async function loadProjectPackages(client: PoolClient, projectId: string) {
  const result = await client.query<{
    id: string;
    package_code: string;
    package_name: string;
  }>(
    `SELECT id, package_code, package_name FROM project_package
     WHERE project_id = $1 AND archived_at IS NULL
     ORDER BY package_code, id`,
    [projectId],
  );
  return result.rows.map(mapPackage);
}

async function loadProjectPackage(client: PoolClient, projectId: string, packageId: string) {
  const result = await client.query<{
    id: string;
    package_code: string;
    package_name: string;
  }>(
    `SELECT id, package_code, package_name FROM project_package
     WHERE id = $1 AND project_id = $2 AND archived_at IS NULL`,
    [packageId, projectId],
  );
  return result.rows[0] ? mapPackage(result.rows[0]) : null;
}

async function loadActiveGrants(
  client: PoolClient,
  projectId: string,
  packageId?: string,
) {
  const result = await client.query<{
    id: string;
    user_id: string;
    display_name: string;
    email: string;
    access_class: string;
    scope_type: AccessScopeType;
    package_id: string | null;
    package_code: string | null;
    package_name: string | null;
    authority_role: AccessAuthorityRole;
    permissions: Record<string, AccessPermission> | null;
    origin: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT grant_record.id::text, grant_record.user_id::text,
            app_user.display_name, app_user.email, app_user.access_class,
            grant_record.scope_type, grant_record.package_id,
            project_package.package_code, project_package.package_name,
             grant_record.authority_role, grant_permissions.permissions,
            grant_record.origin, grant_record.created_at, grant_record.updated_at
     FROM access_grant AS grant_record
     JOIN app_user ON app_user.id = grant_record.user_id
     LEFT JOIN project_package ON project_package.id = grant_record.package_id
     LEFT JOIN LATERAL (
       SELECT jsonb_object_agg(grant_permission.module, grant_permission.permission)
         AS permissions
       FROM access_grant_permission AS grant_permission
       WHERE grant_permission.grant_id = grant_record.id
         AND grant_permission.module = ANY($3::text[])
     ) AS grant_permissions ON true
     WHERE grant_record.project_id = $1
       AND grant_record.revoked_at IS NULL
       AND ($2::text IS NULL
         OR grant_record.scope_type = 'entire_project'
         OR (grant_record.scope_type = 'specific_package'
           AND grant_record.package_id = $2))
     ORDER BY app_user.display_name, app_user.id, grant_record.scope_type,
              project_package.package_code, grant_record.id`,
    [projectId, packageId ?? null, packageAccessModules],
  );
  return result.rows.map((row): AccessGrantView => {
    const permissions = emptyPermissionMap();
    for (const accessModule of packageAccessModules) {
      permissions[accessModule] = row.permissions?.[accessModule] ?? null;
    }
    return {
      id: row.id,
      user: {
        id: row.user_id,
        displayName: row.display_name,
        email: row.email,
      },
      userAccessClass: row.access_class,
      scopeType: row.scope_type,
      projectPackage: row.package_id && row.package_code && row.package_name
        ? {
            id: row.package_id,
            packageCode: row.package_code,
            packageName: row.package_name,
          }
        : null,
      authorityRole: row.authority_role,
      permissions,
      actionsPermission: permissions.actions,
      origin: row.origin,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

async function loadAssignableUsers(client: PoolClient, projectId: string, actorUserId: string) {
  const result = await client.query<{
    id: string;
    display_name: string;
    email: string;
  }>(
    `SELECT app_user.id::text, app_user.display_name, app_user.email
     FROM app_user
     WHERE app_user.status = 'active'
       AND app_user.access_class = 'internal'
       AND app_user.last_authenticated_at IS NOT NULL
       AND app_user.id <> $2
       AND EXISTS (
         SELECT 1 FROM user_identity
         WHERE user_identity.user_id = app_user.id
           AND user_identity.provider = 'microsoft'
       )
       AND NOT EXISTS (
         SELECT 1 FROM project_membership
         WHERE project_membership.project_id = $1
           AND project_membership.user_id = app_user.id
           AND project_membership.role = 'owner'
       )
     ORDER BY app_user.display_name, app_user.email, app_user.id`,
    [projectId, actorUserId],
  );
  return result.rows.map(mapUser);
}

async function loadAccessHistory(client: PoolClient, projectId: string, packageId: string | null) {
  const result = await client.query<{
    id: string;
    occurred_at: Date;
    actor_name: string | null;
    event_type: string;
    target_name: string | null;
    target_email: string | null;
    change_summary: Record<string, unknown>;
  }>(
    `SELECT audit_event.id::text, audit_event.occurred_at,
            actor.display_name AS actor_name, audit_event.event_type,
            target.display_name AS target_name, target.email AS target_email,
            audit_event.change_summary
     FROM audit_event
     LEFT JOIN app_user AS actor ON actor.id = audit_event.actor_user_id
     LEFT JOIN access_grant ON access_grant.id::text = audit_event.resource_id
     LEFT JOIN app_user AS target ON target.id = access_grant.user_id
     WHERE audit_event.project_id = $1
       AND audit_event.resource_type = 'access_grant'
       AND audit_event.event_type IN (
         'access_grant.created', 'access_grant.updated', 'access_grant.revoked'
       )
       AND ($2::text IS NULL
         OR access_grant.package_id = $2
         OR audit_event.metadata->>'packageId' = $2
         OR audit_event.metadata->>'previousPackageId' = $2)
     ORDER BY audit_event.occurred_at DESC, audit_event.id DESC
     LIMIT 100`,
    [projectId, packageId],
  );
  return result.rows.map((row): AccessHistoryView => ({
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorName: row.actor_name ?? "System",
    eventType: row.event_type,
    targetName: row.target_name
      ?? stringSummary(row.change_summary.user)
      ?? "Application User",
    targetEmail: row.target_email
      ?? stringSummary(row.change_summary.email)
      ?? "",
    scopeLabel: stringSummary(row.change_summary.scope) ?? "Access scope",
    authorityLabel: stringSummary(row.change_summary.authority) ?? "Collaborator",
    permissionLabel: stringSummary(row.change_summary.permissions)
      ?? stringSummary(row.change_summary.actions)
      ?? "No Access",
  }));
}

async function requireInternalTarget(client: PoolClient, userId: string) {
  const result = await client.query<{
    id: string;
    display_name: string;
    email: string;
  }>(
    `SELECT app_user.id::text, app_user.display_name, app_user.email
     FROM app_user
     WHERE app_user.id = $1
       AND app_user.status = 'active'
       AND app_user.access_class = 'internal'
       AND app_user.last_authenticated_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM user_identity
         WHERE user_identity.user_id = app_user.id
           AND user_identity.provider = 'microsoft'
       )
     FOR SHARE`,
    [userId],
  );
  if (result.rowCount !== 1) {
    throw new AccessManagementInputError(
      "Select an active internal User who has completed Microsoft Entra sign-in.",
    );
  }
  return mapUser(result.rows[0]);
}

async function requireValidPackageScope(
  client: PoolClient,
  projectId: string,
  scopeType: AccessScopeType,
  packageId: string | null,
) {
  if (scopeType === "specific_package") {
    if (!packageId) {
      throw new AccessManagementInputError("Select a Package for Specific Package access.");
    }
    const projectPackage = await client.query(
      `SELECT id FROM project_package
       WHERE id = $1 AND project_id = $2 AND archived_at IS NULL
       FOR SHARE`,
      [packageId, projectId],
    );
    if (projectPackage.rowCount !== 1) {
      throw new AccessManagementInputError("The selected Package is unavailable.");
    }
  } else if (packageId) {
    throw new AccessManagementInputError("A Package is valid only for Specific Package access.");
  }
}

async function loadGrantForMutation(client: PoolClient, projectId: string, grantId: string) {
  const result = await client.query<{
    target_user_id: string;
    display_name: string;
    email: string;
    scope_type: AccessScopeType;
    package_id: string | null;
    authority_role: AccessAuthorityRole;
    permissions: Record<string, AccessPermission> | null;
    access_class: string;
  }>(
    `SELECT grant_record.user_id::text AS target_user_id,
            app_user.display_name, app_user.email, grant_record.scope_type,
             grant_record.package_id, grant_record.authority_role,
             grant_permissions.permissions, app_user.access_class
     FROM access_grant AS grant_record
     JOIN app_user ON app_user.id = grant_record.user_id
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(grant_permission.module, grant_permission.permission)
          AS permissions
        FROM access_grant_permission AS grant_permission
        WHERE grant_permission.grant_id = grant_record.id
          AND grant_permission.module = ANY($3::text[])
      ) AS grant_permissions ON true
     WHERE grant_record.id = $1 AND grant_record.project_id = $2
       AND grant_record.revoked_at IS NULL
     FOR UPDATE OF grant_record`,
    [grantId, projectId, packageAccessModules],
  );
  const row = result.rows[0];
  if (!row) return null;
  const permissions = packageAccessModules.flatMap((module) => {
    const permission = row.permissions?.[module];
    return permission ? [{ module, permission }] : [];
  });
  return {
    targetUserId: row.target_user_id,
    targetDisplayName: row.display_name,
    targetEmail: row.email,
    scopeType: row.scope_type,
    packageId: row.package_id,
    authorityRole: row.authority_role,
    permissions,
    targetAccessClass: row.access_class,
  };
}

function groupPackageAccess(grants: AccessGrantView[], packageId: string) {
  const users = new Map<string, PackageUserAccessView>();
  for (const grant of grants) {
    const entry = users.get(grant.user.id) ?? {
      user: grant.user,
      entireProjectGrant: null,
      packageGrant: null,
      effectivePermission: null,
      effectivePermissions: emptyPermissionMap(),
    };
    if (grant.scopeType === "entire_project") {
      entry.entireProjectGrant = grant;
    } else if (grant.scopeType === "specific_package" && grant.projectPackage?.id === packageId) {
      entry.packageGrant = grant;
    }
    for (const accessModule of packageAccessModules) {
      entry.effectivePermissions[accessModule] = maximumAccessPermission([
        entry.entireProjectGrant?.permissions[accessModule],
        entry.packageGrant?.permissions[accessModule],
      ].filter((permission): permission is AccessPermission => permission !== null && permission !== undefined));
    }
    entry.effectivePermission = entry.effectivePermissions.actions;
    users.set(grant.user.id, entry);
  }
  return [...users.values()].sort((left, right) =>
    left.user.displayName.localeCompare(right.user.displayName)
      || left.user.email.localeCompare(right.user.email));
}

function mapUser(row: { id: string; display_name: string; email: string }) {
  return { id: row.id, displayName: row.display_name, email: row.email };
}

function mapPackage(row: { id: string; package_code: string; package_name: string }) {
  return {
    id: row.id,
    packageCode: row.package_code,
    packageName: row.package_name,
  };
}

export function accessScopeLabel(scopeType: AccessScopeType) {
  if (scopeType === "entire_project") return "Entire Project";
  if (scopeType === "overall_project") return "Overall Project";
  return "Specific Package";
}

export function accessAuthorityLabel(authorityRole: AccessAuthorityRole) {
  if (authorityRole === "project_access_manager") return "Project Access Manager";
  if (authorityRole === "package_lead") return "Package Lead";
  return "Collaborator";
}

export function accessPermissionLabel(permission: EffectiveAccessPermission) {
  if (permission === "read_write") return "Read & Write";
  if (permission === "read") return "Read";
  return "No Access";
}

export function permissionSummary(
  permissions: Array<{ module: AssignableAccessModule; permission: AccessPermission }>,
) {
  if (permissions.length === 0) return "No Package module access";
  return permissions
    .map((entry) => `${accessModuleLabel(entry.module)}: ${accessPermissionLabel(entry.permission)}`)
    .join("; ");
}

function emptyPermissionMap() {
  return Object.fromEntries(
    packageAccessModules.map((module) => [module, null]),
  ) as Record<AssignableAccessModule, EffectiveAccessPermission>;
}

function stringSummary(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}
