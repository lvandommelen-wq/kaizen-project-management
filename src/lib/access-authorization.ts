import "server-only";

import type { PoolClient } from "pg";
import {
  accessPermissionAllows,
  maximumAccessPermission,
  packageAccessModules,
  type AccessAuthorityRole,
  type AccessModule,
  type AccessPermission,
  type AccessScopeType,
  type AssignableAccessModule,
  type EffectiveAccessPermission,
  type PackageAccessModule,
} from "./access-permissions";
import { insertAuditEvent, type AuditEventInput } from "./audit";
import type { CurrentUser } from "./current-user";
import { getOperationalPool } from "./database";
import {
  getOperationalTransactionClient,
  withOperationalTransaction,
} from "./operational/transaction";

export type AccessScope = {
  projectId: string;
  packageId: string | null;
};

export type AccessibleModuleScopes = {
  projectId: string;
  module: AccessModule;
  isOwner: boolean;
  isProjectAccessManager: boolean;
  packageLeadPackageIds: string[];
  overallPermission: EffectiveAccessPermission;
  packages: Array<{
    packageId: string;
    permission: AccessPermission;
  }>;
};

export type PackageModulePermissions = Record<
  PackageAccessModule,
  EffectiveAccessPermission
>;

export type PackageGovernanceAuthority = "owner" | "package_lead";

export type DelegatedGrantPermission = {
  module: AssignableAccessModule;
  permission: AccessPermission;
};

export type DelegatedGrantProposal = {
  projectId: string;
  targetUserId: string;
  scopeType: AccessScopeType;
  packageId: string | null;
  authorityRole: AccessAuthorityRole;
  permissions: DelegatedGrantPermission[];
  existingGrantId?: string;
  operation?: "save" | "revoke";
};

type EffectivePermissionInput = AccessScope & {
  user: CurrentUser;
  module: AccessModule;
};

export async function getEffectiveAccessPermission(input: EffectivePermissionInput) {
  return withAccessClient((client) => loadEffectivePermission(client, input, false));
}

export async function getPackageModulePermissions(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string;
}): Promise<PackageModulePermissions> {
  return withAccessClient(async (client) => {
    await assertPackageAccessSchema(client);
    return loadPackageModulePermissions(client, input, false);
  });
}

export async function canAccessAnyPackageModule(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string;
}) {
  const permissions = await getPackageModulePermissions(input);
  return packageAccessModules.some((module) => permissions[module] !== null);
}

export async function canAccessAnyPackageInProject(input: {
  user: CurrentUser;
  projectId: string;
}) {
  const scopes = await Promise.all(packageAccessModules.map((module) =>
    getAccessibleModuleScopes({ ...input, module })));
  return scopes.some((scope) => scope.packages.length > 0);
}

export async function getPackageGovernanceAuthority(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string;
}): Promise<PackageGovernanceAuthority | null> {
  return withAccessClient(async (client) => {
    await assertPackageAccessSchema(client);
    return loadPackageGovernanceAuthority(client, input, false);
  });
}

export async function requireAccessPermission(
  input: EffectivePermissionInput & { requestedPermission: AccessPermission },
) {
  const permission = await getEffectiveAccessPermission(input);
  if (!accessPermissionAllows(permission, input.requestedPermission)) {
    throw new Error("You do not have permission to perform this operation.");
  }
  return { user: input.user, permission };
}

export async function requireAccessPermissionInTransaction(
  client: PoolClient,
  input: EffectivePermissionInput & { requestedPermission: AccessPermission },
) {
  await assertAccessSchema(client);
  const permission = await loadEffectivePermission(client, input, true);
  if (!accessPermissionAllows(permission, input.requestedPermission)) {
    throw new Error("You do not have permission to perform this operation.");
  }
  return { user: input.user, permission };
}

export async function getAccessibleModuleScopes(input: {
  user: CurrentUser;
  projectId: string;
  module: AccessModule;
}) {
  return withAccessClient((client) => loadAccessibleModuleScopes(client, input, false));
}

export async function getAccessibleModuleScopesInTransaction(
  client: PoolClient,
  input: {
    user: CurrentUser;
    projectId: string;
    module: AccessModule;
  },
  lock = false,
) {
  await assertAccessSchema(client);
  return loadAccessibleModuleScopes(client, input, lock);
}

export async function getAuthorizedNavigation(input: {
  user: CurrentUser;
  module: AccessModule;
}) {
  return withAccessClient(async (client) => {
    const projectResult = await client.query<{ id: string }>(
      `SELECT project.id
       FROM project
       WHERE project.archived_at IS NULL
         AND (
           EXISTS (
             SELECT 1
             FROM project_membership AS membership
             JOIN app_user ON app_user.id = membership.user_id
             WHERE membership.project_id = project.id
               AND membership.user_id = $1
               AND membership.role = 'owner'
               AND app_user.status = 'active'
               AND app_user.access_class = 'internal'
           )
           OR EXISTS (
             SELECT 1
             FROM access_grant AS grant_record
             JOIN access_grant_permission AS grant_permission
               ON grant_permission.grant_id = grant_record.id
             JOIN app_user ON app_user.id = grant_record.user_id
             WHERE grant_record.project_id = project.id
               AND grant_record.user_id = $1
               AND grant_record.revoked_at IS NULL
               AND grant_permission.module = $2
               AND app_user.status = 'active'
               AND app_user.access_class IN ('internal', 'external_collaborator')
           )
         )
       ORDER BY project.id`,
      [input.user.id, input.module],
    );

    const navigation: AccessibleModuleScopes[] = [];
    for (const project of projectResult.rows) {
      const scopes = await loadAccessibleModuleScopes(client, {
        user: input.user,
        projectId: project.id,
        module: input.module,
      }, false);
      if (scopes.isOwner || scopes.overallPermission || scopes.packages.length > 0) {
        navigation.push(scopes);
      }
    }
    return navigation;
  });
}

export async function withAuthorizedAccessMutation<T>(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string | null;
  module: AccessModule;
  requestedPermission?: AccessPermission;
  audit?: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (client: PoolClient, actor: CurrentUser) => Promise<T>;
  isSuccess?: (result: T) => boolean;
}) {
  return withOperationalTransaction(async (client) => {
    await assertAccessSchema(client);
    if (input.module !== "actions") await assertPackageAccessSchema(client);
    const permission = await loadEffectivePermission(client, {
      user: input.user,
      projectId: input.projectId,
      packageId: input.packageId,
      module: input.module,
    }, true);
    if (!accessPermissionAllows(permission, input.requestedPermission ?? "read_write")) {
      throw new Error("You do not have permission to perform this operation.");
    }

    const result = await input.operation(client, input.user);
    if (
      input.audit
      && (input.isSuccess?.(result) ?? (result !== null && result !== false))
    ) {
      const event = typeof input.audit === "function" ? input.audit(result) : input.audit;
      await insertAuditEvent(client, input.user, input.projectId, event);
    }
    return result;
  });
}

export async function withAuthorizedPackageGovernanceMutation<T>(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (client: PoolClient, actor: CurrentUser) => Promise<T>;
  isSuccess?: (result: T) => boolean;
}) {
  return withOperationalTransaction(async (client) => {
    await assertPackageAccessSchema(client);
    const authority = await loadPackageGovernanceAuthority(client, input, true);
    if (!authority) {
      throw new Error("You do not have Package governance authority for this Package.");
    }

    const result = await input.operation(client, input.user);
    if (input.isSuccess?.(result) ?? (result !== null && result !== false)) {
      const event = typeof input.audit === "function" ? input.audit(result) : input.audit;
      await insertAuditEvent(client, input.user, input.projectId, event);
    }
    return result;
  });
}

export async function validateDelegatedAccessGrant(
  actor: CurrentUser,
  proposal: DelegatedGrantProposal,
) {
  return withOperationalTransaction(async (client) => {
    await assertAccessSchema(client);
    return validateDelegatedGrantWithClient(client, actor, proposal);
  });
}

export async function withDelegatedAccessMutation<T>(input: {
  actor: CurrentUser;
  proposal: DelegatedGrantProposal;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (client: PoolClient, actor: CurrentUser) => Promise<T>;
  isSuccess?: (result: T) => boolean;
}) {
  return withOperationalTransaction(async (client) => {
    await assertAccessSchema(client);
    await validateDelegatedGrantWithClient(client, input.actor, input.proposal);
    const result = await input.operation(client, input.actor);
    if (input.isSuccess?.(result) ?? (result !== null && result !== false)) {
      const audit = typeof input.audit === "function" ? input.audit(result) : input.audit;
      await insertAuditEvent(client, input.actor, input.proposal.projectId, audit);
    }
    return result;
  });
}

async function validateDelegatedGrantWithClient(
  client: PoolClient,
  actor: CurrentUser,
  proposal: DelegatedGrantProposal,
) {
  assertProposalShape(proposal);
  if (actor.id === proposal.targetUserId) {
    throw new Error("Users cannot grant additional access to themselves.");
  }

  const actorIsActive = await requireLiveScope(
    client,
    actor.id,
    proposal.projectId,
    proposal.packageId,
    true,
  );
  if (!actorIsActive) {
    throw new Error("You do not have delegated authority for this scope.");
  }
  if (proposal.operation !== "revoke") {
    const target = await client.query<{ access_class: string }>(
      `SELECT app_user.access_class
       FROM app_user
       JOIN user_identity
         ON user_identity.user_id = app_user.id
        AND user_identity.provider = 'microsoft'
       WHERE app_user.id = $1
         AND app_user.status = 'active'
         AND app_user.last_authenticated_at IS NOT NULL
         AND app_user.access_class IN ('internal', 'external_collaborator')
       LIMIT 1
       FOR SHARE OF app_user, user_identity`,
      [proposal.targetUserId],
    );
    if (target.rowCount !== 1) {
      throw new Error("Access can be assigned only to an active authenticated application collaborator.");
    }
  }

  const targetOwner = await loadOwner(client, proposal.projectId, proposal.targetUserId, true);
  if (targetOwner) {
    throw new Error("Protected Project Owner access cannot be modified through delegated grants.");
  }

  let existingGrant: {
    authorityRole: AccessAuthorityRole;
    scopeType: AccessScopeType;
    packageId: string | null;
  } | null = null;
  if (proposal.existingGrantId) {
    const existing = await client.query<{
      authority_role: AccessAuthorityRole;
      scope_type: AccessScopeType;
      package_id: string | null;
    }>(
      `SELECT authority_role, scope_type, package_id
       FROM access_grant
       WHERE id = $1 AND project_id = $2 AND user_id = $3
         AND revoked_at IS NULL
       FOR UPDATE`,
      [proposal.existingGrantId, proposal.projectId, proposal.targetUserId],
    );
    if (existing.rowCount !== 1) {
      throw new Error("The access assignment is unavailable.");
    }
    existingGrant = {
      authorityRole: existing.rows[0].authority_role,
      scopeType: existing.rows[0].scope_type,
      packageId: existing.rows[0].package_id,
    };
  }

  const actorIsOwner = await loadOwner(client, proposal.projectId, actor.id, true);
  if (actorIsOwner) return { authority: "owner" as const };

  const actorAuthorities = await client.query<{
    authority_role: AccessAuthorityRole;
    package_id: string | null;
  }>(
    `SELECT authority_role, package_id
     FROM access_grant
     WHERE project_id = $1 AND user_id = $2 AND revoked_at IS NULL
       AND authority_role IN ('project_access_manager', 'package_lead')
     ORDER BY authority_role, package_id
     FOR SHARE`,
    [proposal.projectId, actor.id],
  );
  const projectAccessManager = actorAuthorities.rows.some(
    (grant) => grant.authority_role === "project_access_manager",
  );
  if (projectAccessManager) {
    if (proposal.authorityRole === "project_access_manager") {
      throw new Error("Only a Project Owner may designate a Project Access Manager.");
    }
    if (existingGrant?.authorityRole === "project_access_manager") {
      throw new Error("Only a Project Owner may modify a Project Access Manager.");
    }
    return { authority: "project_access_manager" as const };
  }

  if (
    proposal.scopeType !== "specific_package"
    || !proposal.packageId
    || proposal.authorityRole !== "collaborator"
    || (existingGrant !== null && existingGrant.authorityRole !== "collaborator")
    || (existingGrant !== null && (
      existingGrant.scopeType !== "specific_package"
      || existingGrant.packageId !== proposal.packageId
    ))
  ) {
    throw new Error("A Package Lead may manage only ordinary collaborators in their Package.");
  }
  const leadsPackage = actorAuthorities.rows.some(
    (grant) => grant.authority_role === "package_lead"
      && grant.package_id === proposal.packageId,
  );
  if (!leadsPackage) {
    throw new Error("You do not have delegated authority for this Package.");
  }

  for (const requested of proposal.permissions) {
    const effective = await loadEffectivePermission(client, {
      user: actor,
      projectId: proposal.projectId,
      packageId: proposal.packageId,
      module: requested.module,
    }, true);
    if (!accessPermissionAllows(effective, requested.permission)) {
      throw new Error("A delegated grant cannot exceed the Package Lead's permission.");
    }
  }
  return { authority: "package_lead" as const };
}

async function loadAccessibleModuleScopes(
  client: PoolClient,
  input: { user: CurrentUser; projectId: string; module: AccessModule },
  lock: boolean,
): Promise<AccessibleModuleScopes> {
  const live = await requireLiveScope(client, input.user.id, input.projectId, null, lock);
  if (!live) {
    return {
      projectId: input.projectId,
      module: input.module,
      isOwner: false,
      isProjectAccessManager: false,
      packageLeadPackageIds: [],
      overallPermission: null,
      packages: [],
    };
  }
  const isOwner = await loadOwner(client, input.projectId, input.user.id, lock);
  const packages = await client.query<{ id: string }>(
    `SELECT id FROM project_package
     WHERE project_id = $1 AND archived_at IS NULL
     ORDER BY package_code, id
     ${lock ? "FOR SHARE" : ""}`,
    [input.projectId],
  );
  const authorityRows = isOwner ? [] : (await client.query<{
    authority_role: AccessAuthorityRole;
    package_id: string | null;
  }>(
    `SELECT authority_role, package_id
     FROM access_grant
     WHERE project_id = $1 AND user_id = $2 AND revoked_at IS NULL
       AND authority_role IN ('project_access_manager', 'package_lead')
     ${lock ? "FOR SHARE" : ""}`,
    [input.projectId, input.user.id],
  )).rows;

  if (isOwner) {
    return {
      projectId: input.projectId,
      module: input.module,
      isOwner: true,
      isProjectAccessManager: true,
      packageLeadPackageIds: packages.rows.map((projectPackage) => projectPackage.id),
      overallPermission: "read_write",
      packages: packages.rows.map((projectPackage) => ({
        packageId: projectPackage.id,
        permission: "read_write",
      })),
    };
  }

  const overallPermission = await loadEffectivePermission(client, {
    user: input.user,
    projectId: input.projectId,
    packageId: null,
    module: input.module,
  }, lock);
  const accessiblePackages: AccessibleModuleScopes["packages"] = [];
  for (const projectPackage of packages.rows) {
    const permission = await loadEffectivePermission(client, {
      user: input.user,
      projectId: input.projectId,
      packageId: projectPackage.id,
      module: input.module,
    }, lock);
    if (permission) accessiblePackages.push({ packageId: projectPackage.id, permission });
  }

  return {
    projectId: input.projectId,
    module: input.module,
    isOwner: false,
    isProjectAccessManager: authorityRows.some(
      (grant) => grant.authority_role === "project_access_manager",
    ),
    packageLeadPackageIds: authorityRows
      .filter((grant) => grant.authority_role === "package_lead" && grant.package_id)
      .map((grant) => grant.package_id!),
    overallPermission,
    packages: accessiblePackages,
  };
}

async function loadEffectivePermission(
  client: PoolClient,
  input: EffectivePermissionInput,
  lock: boolean,
): Promise<EffectiveAccessPermission> {
  const live = await requireLiveScope(
    client,
    input.user.id,
    input.projectId,
    input.packageId,
    lock,
  );
  if (!live) return null;
  if (await loadOwner(client, input.projectId, input.user.id, lock)) {
    return "read_write";
  }

  const result = await client.query<{ permission: AccessPermission }>(
    `SELECT grant_permission.permission
     FROM access_grant AS grant_record
     JOIN access_grant_permission AS grant_permission
       ON grant_permission.grant_id = grant_record.id
     WHERE grant_record.project_id = $1
       AND grant_record.user_id = $2
       AND grant_record.revoked_at IS NULL
       AND grant_permission.module = $3
       AND (
         ($4::text IS NULL AND grant_record.scope_type IN (
           'entire_project', 'overall_project'
         ))
         OR ($4::text IS NOT NULL AND (
           grant_record.scope_type = 'entire_project'
           OR (grant_record.scope_type = 'specific_package'
             AND grant_record.package_id = $4)
         ))
       )
     ${lock ? "FOR SHARE OF grant_record, grant_permission" : ""}`,
    [input.projectId, input.user.id, input.module, input.packageId],
  );
  return maximumAccessPermission(result.rows.map((row) => row.permission));
}

async function loadPackageModulePermissions(
  client: PoolClient,
  input: { user: CurrentUser; projectId: string; packageId: string },
  lock: boolean,
): Promise<PackageModulePermissions> {
  const permissions = {} as PackageModulePermissions;
  for (const accessModule of packageAccessModules) {
    permissions[accessModule] = await loadEffectivePermission(client, {
      ...input,
      module: accessModule,
    }, lock);
  }
  return permissions;
}

async function loadPackageGovernanceAuthority(
  client: PoolClient,
  input: { user: CurrentUser; projectId: string; packageId: string },
  lock: boolean,
): Promise<PackageGovernanceAuthority | null> {
  const live = await requireLiveScope(
    client,
    input.user.id,
    input.projectId,
    input.packageId,
    lock,
  );
  if (!live) return null;
  if (await loadOwner(client, input.projectId, input.user.id, lock)) return "owner";

  const result = await client.query(
    `SELECT 1
     FROM access_grant AS grant_record
     JOIN access_grant_permission AS grant_permission
       ON grant_permission.grant_id = grant_record.id
     JOIN app_user ON app_user.id = grant_record.user_id
     WHERE grant_record.project_id = $1
       AND grant_record.package_id = $2
       AND grant_record.user_id = $3
       AND grant_record.scope_type = 'specific_package'
       AND grant_record.authority_role = 'package_lead'
       AND grant_record.revoked_at IS NULL
       AND grant_permission.module = 'gate_reviews'
       AND grant_permission.permission = 'read_write'
       AND app_user.status = 'active'
       AND app_user.access_class = 'internal'
       AND app_user.last_authenticated_at IS NOT NULL
     ${lock ? "FOR SHARE OF grant_record, grant_permission, app_user" : ""}`,
    [input.projectId, input.packageId, input.user.id],
  );
  return result.rowCount === 1 ? "package_lead" : null;
}

async function requireLiveScope(
  client: PoolClient,
  userId: string,
  projectId: string,
  packageId: string | null,
  lock: boolean,
) {
  const result = await client.query(
    `SELECT 1
     FROM app_user
     JOIN project ON project.id = $2 AND project.archived_at IS NULL
     WHERE app_user.id = $1
       AND app_user.status = 'active'
       AND app_user.access_class IN ('internal', 'external_collaborator')
       AND ($3::text IS NULL OR EXISTS (
         SELECT 1 FROM project_package
         WHERE project_package.id = $3
           AND project_package.project_id = project.id
           AND project_package.archived_at IS NULL
       ))
     ${lock ? "FOR SHARE OF app_user, project" : ""}`,
    [userId, projectId, packageId],
  );
  return result.rowCount === 1;
}

async function loadOwner(
  client: PoolClient,
  projectId: string,
  userId: string,
  lock: boolean,
) {
  const result = await client.query(
    `SELECT 1
     FROM project_membership AS membership
     JOIN app_user ON app_user.id = membership.user_id
     WHERE membership.project_id = $1
       AND membership.user_id = $2
       AND membership.role = 'owner'
       AND app_user.status = 'active'
       AND app_user.access_class = 'internal'
     ${lock ? "FOR SHARE OF membership, app_user" : ""}`,
    [projectId, userId],
  );
  return result.rowCount === 1;
}

function assertProposalShape(proposal: DelegatedGrantProposal) {
  if (
    (proposal.scopeType === "specific_package" && !proposal.packageId)
    || (proposal.scopeType !== "specific_package" && proposal.packageId)
  ) {
    throw new Error("The access scope and Package selection are inconsistent.");
  }
  if (
    (proposal.authorityRole === "package_lead" && proposal.scopeType !== "specific_package")
    || (proposal.authorityRole === "project_access_manager"
      && proposal.scopeType !== "entire_project")
  ) {
    throw new Error("The delegated authority is invalid for the selected scope.");
  }
  if (proposal.authorityRole === "package_lead" && proposal.operation !== "revoke") {
    const fullPackageBundle = packageAccessModules.every((module) =>
      proposal.permissions.some((permission) =>
        permission.module === module && permission.permission === "read_write"));
    if (!fullPackageBundle || proposal.permissions.length !== packageAccessModules.length) {
      throw new Error("A Package Lead requires Full Package Read & Write permission.");
    }
  }
  if (new Set(proposal.permissions.map((permission) => permission.module)).size
    !== proposal.permissions.length) {
    throw new Error("Each module may be granted only once per access assignment.");
  }
}

async function withAccessClient<T>(operation: (client: PoolClient) => Promise<T>) {
  const transactionClient = getOperationalTransactionClient();
  if (transactionClient) {
    await assertAccessSchema(transactionClient);
    return operation(transactionClient);
  }

  let client: PoolClient;
  try {
    client = await getOperationalPool().connect();
  } catch {
    throw new Error("Could not connect to the operational database.");
  }
  try {
    await assertAccessSchema(client);
    return await operation(client);
  } finally {
    client.release();
  }
}

async function assertAccessSchema(client: PoolClient) {
  const result = await client.query(
    `SELECT 1 FROM identity_schema_migration
     WHERE name = '019_access_management_foundation.sql'`,
  );
  if (result.rowCount !== 1) {
    throw new Error("Access Management PostgreSQL migration 019 has not been applied.");
  }
}

async function assertPackageAccessSchema(client: PoolClient) {
  const result = await client.query(
    `SELECT 1 FROM identity_schema_migration
     WHERE name = '021_full_package_access.sql'`,
  );
  if (result.rowCount !== 1) {
    throw new Error("Full Package Access PostgreSQL migration 021 has not been applied.");
  }
}
