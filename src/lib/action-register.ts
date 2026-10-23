import "server-only";

import type { PoolClient } from "pg";
import {
  getAccessibleModuleScopes,
  getAccessibleModuleScopesInTransaction,
  getAuthorizedNavigation,
  requireAccessPermissionInTransaction,
} from "./access-authorization";
import { accessPermissionAllows, type AccessPermission } from "./access-permissions";
import { insertAuditEvent, type AuditEventInput } from "./audit";
import type { CurrentUser } from "./current-user";
import { getOperationalDataBackend } from "./operational/backend";
import { loadAuthorizedProjectActions } from "./operational/mappers";
import { withOperationalTransaction } from "./operational/transaction";
import { getGateActions, type ProjectAction } from "./project-actions";

export type ActionRegisterPackage = {
  id: string;
  packageCode: string;
  packageName: string;
  permission: AccessPermission;
};

export type ActionRegisterTier = {
  id: string;
  sequence: number;
  name: string;
};

export type AuthorizedProjectAction = ProjectAction & {
  canWrite: boolean;
};

export type ActionRegisterView = {
  project: {
    id: string;
    projectNumber: string;
    name: string;
  };
  fixedPackage: ActionRegisterPackage | null;
  packages: ActionRegisterPackage[];
  actions: AuthorizedProjectAction[];
  governanceTiers: ActionRegisterTier[];
  gateLabels: Array<{ id: string; label: string }>;
  canReadOverall: boolean;
  canWriteOverall: boolean;
  writablePackageIds: string[];
  hasProjectMembership: boolean;
  canOpenFixedPackage: boolean;
};

export type AuthorizedActionNavigation = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  canOpenProjectRegister: boolean;
  packages: Array<{
    id: string;
    packageCode: string;
    packageName: string;
  }>;
};

export type AuthorizedGateActionView = {
  actions: ProjectAction[];
  permission: AccessPermission | null;
};

type ActionScopeRecord = {
  action: ProjectAction;
  packageId: string | null;
};

export async function canAccessAnyProjectActions(user: CurrentUser, projectId: string) {
  if (getOperationalDataBackend() !== "postgres") return false;
  try {
    const scopes = await getAccessibleModuleScopes({ user, projectId, module: "actions" });
    return scopes.isOwner || Boolean(scopes.overallPermission) || scopes.packages.length > 0;
  } catch (error) {
    if (isMissingAccessSchemaError(error)) return false;
    throw error;
  }
}

export async function getActionRegisterView(
  user: CurrentUser,
  projectId: string,
  fixedPackageId: string | null,
): Promise<ActionRegisterView | null> {
  if (getOperationalDataBackend() !== "postgres") return null;

  return withOperationalTransaction(async (client) => {
    const scopes = await getAccessibleModuleScopesInTransaction(client, {
      user,
      projectId,
      module: "actions",
    }, true);
    const fixedScope = fixedPackageId
      ? scopes.packages.find((scope) => scope.packageId === fixedPackageId) ?? null
      : null;
    if (
      fixedPackageId
        ? !fixedScope
        : !scopes.isOwner && !scopes.overallPermission && scopes.packages.length === 0
    ) {
      return null;
    }

    const projectResult = await client.query<{
      id: string;
      project_number: string;
      name: string;
    }>(
      `SELECT id, project_number, name
       FROM project
       WHERE id = $1 AND archived_at IS NULL`,
      [projectId],
    );
    const project = projectResult.rows[0];
    if (!project) return null;

    const readablePackageScopes = fixedPackageId && fixedScope
      ? [fixedScope]
      : scopes.packages;
    const packages = await loadActionPackages(
      client,
      projectId,
      readablePackageScopes,
    );
    if (fixedPackageId && packages.length !== 1) return null;

    const canReadOverall = fixedPackageId === null && Boolean(scopes.overallPermission);
    const loadedActions = await loadAuthorizedProjectActions(client, projectId, {
      allowOverall: canReadOverall,
      packageIds: packages.map((projectPackage) => projectPackage.id),
    });
    const permissionByPackage = new Map(
      packages.map((projectPackage) => [projectPackage.id, projectPackage.permission]),
    );
    const actions = loadedActions.map((action): AuthorizedProjectAction => {
      const packageId = singlePackageId(action);
      const permission = packageId
        ? permissionByPackage.get(packageId) ?? null
        : scopes.overallPermission;
      return {
        ...action,
        canWrite: accessPermissionAllows(permission, "read_write"),
      };
    });
    const governanceTiers = await loadActionGovernanceTiers(client, projectId);
    const gateLabels = await loadAuthorizedGateLabels(client, projectId, actions);
    const membership = await client.query(
      `SELECT 1 FROM project_membership
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, user.id],
    );
    const overviewScopes = fixedPackageId
      ? await getAccessibleModuleScopesInTransaction(client, {
          user,
          projectId,
          module: "overview",
        })
      : null;

    return {
      project: {
        id: project.id,
        projectNumber: project.project_number,
        name: project.name,
      },
      fixedPackage: fixedPackageId ? packages[0] : null,
      packages,
      actions,
      governanceTiers,
      gateLabels,
      canReadOverall,
      canWriteOverall: fixedPackageId === null
        && accessPermissionAllows(scopes.overallPermission, "read_write"),
      writablePackageIds: packages
        .filter((projectPackage) =>
          accessPermissionAllows(projectPackage.permission, "read_write"))
        .map((projectPackage) => projectPackage.id),
      hasProjectMembership: membership.rowCount === 1,
      canOpenFixedPackage: Boolean(fixedPackageId && overviewScopes?.packages.some(
        (scope) => scope.packageId === fixedPackageId,
      )),
    };
  });
}

export async function getAuthorizedActionNavigation(
  user: CurrentUser,
): Promise<AuthorizedActionNavigation[]> {
  if (getOperationalDataBackend() !== "postgres") return [];

  try {
    return await withOperationalTransaction(async (client) => {
      const scopes = await getAuthorizedNavigation({ user, module: "actions" });
      const navigation: AuthorizedActionNavigation[] = [];
      for (const scope of scopes) {
        const projectResult = await client.query<{
          id: string;
          project_number: string;
          name: string;
        }>(
          `SELECT id, project_number, name FROM project
           WHERE id = $1 AND archived_at IS NULL`,
          [scope.projectId],
        );
        const project = projectResult.rows[0];
        if (!project) continue;
        const packageIds = scope.packages.map((entry) => entry.packageId);
        const packageResult = packageIds.length
          ? await client.query<{
              id: string;
              package_code: string;
              package_name: string;
            }>(
              `SELECT id, package_code, package_name
               FROM project_package
               WHERE project_id = $1 AND archived_at IS NULL
                 AND id = ANY($2::text[])
               ORDER BY package_code, id`,
              [scope.projectId, packageIds],
            )
          : { rows: [] };
        navigation.push({
          projectId: project.id,
          projectNumber: project.project_number,
          projectName: project.name,
          canOpenProjectRegister: Boolean(scope.overallPermission),
          packages: packageResult.rows.map((projectPackage) => ({
            id: projectPackage.id,
            packageCode: projectPackage.package_code,
            packageName: projectPackage.package_name,
          })),
        });
      }
      return navigation;
    });
  } catch (error) {
    if (isMissingAccessSchemaError(error)) return [];
    throw error;
  }
}

export async function getAuthorizedProjectAction(
  user: CurrentUser,
  projectId: string,
  actionId: string,
) {
  return withOperationalTransaction(async (client) => {
    const scopes = await getAccessibleModuleScopesInTransaction(client, {
      user,
      projectId,
      module: "actions",
    }, true);
    const actions = await loadAuthorizedProjectActions(client, projectId, {
      allowOverall: Boolean(scopes.overallPermission),
      packageIds: scopes.packages.map((scope) => scope.packageId),
      actionId,
    });
    return actions[0] ?? null;
  });
}

export async function getAuthorizedGateActionView(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string | null;
  gateId: string;
  legacyPermission: AccessPermission;
}): Promise<AuthorizedGateActionView> {
  if (getOperationalDataBackend() !== "postgres") {
    return {
      actions: await getGateActions(input.projectId, input.gateId),
      permission: input.legacyPermission,
    };
  }

  try {
    return await withOperationalTransaction(async (client) => {
      const scopes = await getAccessibleModuleScopesInTransaction(client, {
        user: input.user,
        projectId: input.projectId,
        module: "actions",
      }, true);
      const permission = input.packageId
        ? scopes.packages.find((scope) => scope.packageId === input.packageId)?.permission ?? null
        : scopes.overallPermission;
      if (!accessPermissionAllows(permission, "read")) {
        return { actions: [], permission: null };
      }
      const actions = await loadAuthorizedProjectActions(client, input.projectId, {
        allowOverall: input.packageId === null,
        packageIds: input.packageId ? [input.packageId] : [],
      });
      return {
        actions: actions.filter((action) => action.gateId === input.gateId),
        permission,
      };
    });
  } catch (error) {
    if (!isMissingAccessSchemaError(error)) throw error;
    return {
      actions: await getGateActions(input.projectId, input.gateId),
      permission: input.legacyPermission,
    };
  }
}

export async function getActionGovernanceTierIds(projectId: string) {
  return withOperationalTransaction(async (client) =>
    (await loadActionGovernanceTiers(client, projectId)).map((tier) => tier.id));
}

export async function withAuthorizedActionCreation<T>(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string | null;
  fixedPackageId?: string;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (client: PoolClient, actor: CurrentUser) => Promise<T>;
}) {
  if (input.fixedPackageId !== undefined && input.packageId !== input.fixedPackageId) {
    throw new Error("The fixed Package Action scope cannot be changed.");
  }
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      `SELECT id FROM project
       WHERE id = $1 AND archived_at IS NULL
       FOR UPDATE`,
      [input.projectId],
    );
    if (project.rowCount !== 1) throw new Error("Project not found.");
    await requireAccessPermissionInTransaction(client, {
      user: input.user,
      projectId: input.projectId,
      packageId: input.packageId,
      module: "actions",
      requestedPermission: "read_write",
    });
    const result = await input.operation(client, input.user);
    const audit = typeof input.audit === "function" ? input.audit(result) : input.audit;
    await insertAuditEvent(client, input.user, input.projectId, audit);
    return result;
  });
}

export async function withAuthorizedActionMutation<T>(input: {
  user: CurrentUser;
  projectId: string;
  actionId: string;
  fixedPackageId?: string;
  destinationPackageId?: string | null;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (
    client: PoolClient,
    actor: CurrentUser,
    existingAction: ProjectAction,
  ) => Promise<T>;
  isSuccess?: (result: T) => boolean;
}) {
  return withOperationalTransaction(async (client) => {
    const scope = await lockActionScope(client, input.projectId, input.actionId);
    if (!scope) throw new Error("Action not found.");
    if (
      input.fixedPackageId !== undefined
      && scope.packageId !== input.fixedPackageId
    ) {
      throw new Error("This Action does not belong to the fixed Package scope.");
    }
    await requireAccessPermissionInTransaction(client, {
      user: input.user,
      projectId: input.projectId,
      packageId: scope.packageId,
      module: "actions",
      requestedPermission: "read_write",
    });

    if (input.destinationPackageId !== undefined) {
      if (
        input.fixedPackageId !== undefined
        && input.destinationPackageId !== input.fixedPackageId
      ) {
        throw new Error("The fixed Package Action scope cannot be changed.");
      }
      if (
        scope.action.source === "gate"
        && input.destinationPackageId !== scope.packageId
      ) {
        throw new Error("A Gate Action's scope is fixed by its Gate.");
      }
      if (input.destinationPackageId !== scope.packageId) {
        await requireAccessPermissionInTransaction(client, {
          user: input.user,
          projectId: input.projectId,
          packageId: input.destinationPackageId,
          module: "actions",
          requestedPermission: "read_write",
        });
      }
    }

    const result = await input.operation(client, input.user, scope.action);
    if (input.isSuccess?.(result) ?? (result !== null && result !== false)) {
      const audit = typeof input.audit === "function" ? input.audit(result) : input.audit;
      await insertAuditEvent(client, input.user, input.projectId, audit);
    }
    return result;
  });
}

async function lockActionScope(
  client: PoolClient,
  projectId: string,
  actionId: string,
): Promise<ActionScopeRecord | null> {
  const project = await client.query(
    `SELECT id FROM project
     WHERE id = $1 AND archived_at IS NULL
     FOR UPDATE`,
    [projectId],
  );
  if (project.rowCount !== 1) return null;
  const locked = await client.query(
    `SELECT id FROM project_action
     WHERE project_id = $1 AND id = $2
     FOR UPDATE`,
    [projectId, actionId],
  );
  if (locked.rowCount !== 1) return null;
  const links = await client.query<{ package_id: string }>(
    `SELECT package_id FROM project_action_package
     WHERE action_id = $1
     ORDER BY package_id
     FOR UPDATE`,
    [actionId],
  );
  if (links.rows.length > 1) {
    throw new Error("An Action may reference at most one Package.");
  }
  const packageId = links.rows[0]?.package_id ?? null;
  const actions = await loadAuthorizedProjectActions(client, projectId, {
    allowOverall: packageId === null,
    packageIds: packageId ? [packageId] : [],
    actionId,
  });
  const action = actions[0];
  if (!action) throw new Error("Action not found.");
  if (action.source === "gate") {
    const gate = await client.query<{ package_id: string | null }>(
      `SELECT package_id FROM gate
       WHERE id = $1 AND project_id = $2`,
      [action.gateId, projectId],
    );
    if (gate.rowCount !== 1 || gate.rows[0].package_id !== packageId) {
      throw new Error("A Gate Action's scope does not match its Gate.");
    }
  }
  return { action, packageId };
}

async function loadActionPackages(
  client: PoolClient,
  projectId: string,
  scopes: Array<{ packageId: string; permission: AccessPermission }>,
) {
  if (scopes.length === 0) return [];
  const permissionById = new Map(
    scopes.map((scope) => [scope.packageId, scope.permission]),
  );
  const result = await client.query<{
    id: string;
    package_code: string;
    package_name: string;
  }>(
    `SELECT id, package_code, package_name
     FROM project_package
     WHERE project_id = $1 AND archived_at IS NULL
       AND id = ANY($2::text[])
     ORDER BY package_code, id`,
    [projectId, scopes.map((scope) => scope.packageId)],
  );
  return result.rows.map((projectPackage): ActionRegisterPackage => ({
    id: projectPackage.id,
    packageCode: projectPackage.package_code,
    packageName: projectPackage.package_name,
    permission: permissionById.get(projectPackage.id)!,
  }));
}

async function loadActionGovernanceTiers(client: PoolClient, projectId: string) {
  const result = await client.query<{
    id: string;
    sequence: number;
    name: string;
  }>(
    `SELECT id, sequence, name FROM governance_tier
     WHERE project_id = $1
     ORDER BY sequence, id`,
    [projectId],
  );
  return result.rows.map((tier): ActionRegisterTier => ({
    id: tier.id,
    sequence: Number(tier.sequence),
    name: tier.name,
  }));
}

async function loadAuthorizedGateLabels(
  client: PoolClient,
  projectId: string,
  actions: ProjectAction[],
) {
  const gateIds = [...new Set(
    actions.map((action) => action.gateId).filter((gateId): gateId is string => Boolean(gateId)),
  )];
  if (gateIds.length === 0) return [];
  const result = await client.query<{
    id: string;
    name: string;
    package_code: string | null;
  }>(
    `SELECT gate.id, gate.name, project_package.package_code
     FROM gate
     LEFT JOIN project_package ON project_package.id = gate.package_id
     WHERE gate.project_id = $1 AND gate.id = ANY($2::text[])
     ORDER BY gate.id`,
    [projectId, gateIds],
  );
  return result.rows.map((gate) => ({
    id: gate.id,
    label: gate.package_code
      ? `${gate.package_code} - ${gate.name}`
      : `Overall Project - ${gate.name}`,
  }));
}

function singlePackageId(action: ProjectAction) {
  if (action.packageIds.length > 1) {
    throw new Error("An Action may reference at most one Package.");
  }
  return action.packageIds[0] ?? null;
}

function isMissingAccessSchemaError(error: unknown) {
  return error instanceof Error
    && error.message.includes("Access Management PostgreSQL migration 019 has not been applied");
}
