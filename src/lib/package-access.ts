import "server-only";

import {
  getAuthorizedNavigation,
  getPackageGovernanceAuthority,
  getPackageModulePermissions,
  type PackageGovernanceAuthority,
  type PackageModulePermissions,
} from "./access-authorization";
import {
  accessPermissionAllows,
  packageAccessModules,
  type AccessPermission,
  type PackageAccessModule,
} from "./access-permissions";
import type { CurrentUser } from "./current-user";
import { getPackage, type ProjectPackage } from "./packages";
import type { ProjectMembershipRole } from "./project-permissions";
import { withOperationalTransaction } from "./operational/transaction";

export type AuthorizedPackageContext = {
  project: { id: string; projectNumber: string; name: string };
  projectPackage: ProjectPackage;
  permissions: PackageModulePermissions;
  governanceAuthority: PackageGovernanceAuthority | null;
  projectRole: ProjectMembershipRole | null;
};

export type AuthorizedPackageNavigation = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  packages: Array<{
    id: string;
    packageCode: string;
    packageName: string;
    currentGateId: string | null;
    modules: PackageAccessModule[];
  }>;
};

export async function getAuthorizedPackageContext(input: {
  user: CurrentUser;
  projectId: string;
  packageId: string;
  module: PackageAccessModule;
  requestedPermission?: AccessPermission;
}): Promise<AuthorizedPackageContext | null> {
  return withOperationalTransaction(async (client) => {
    const permissions = await getPackageModulePermissions(input);
    const governanceAuthority = await getPackageGovernanceAuthority(input);
    if (!accessPermissionAllows(
      permissions[input.module],
      input.requestedPermission ?? "read",
    )) return null;

    const projectResult = await client.query<{
      id: string;
      project_number: string;
      name: string;
      role: ProjectMembershipRole | null;
    }>(
      `SELECT project.id, project.project_number, project.name,
              membership.role
       FROM project
       LEFT JOIN project_membership AS membership
         ON membership.project_id = project.id
        AND membership.user_id = $2
       WHERE project.id = $1 AND project.archived_at IS NULL`,
      [input.projectId, input.user.id],
    );
    const projectPackage = await getPackage(input.projectId, input.packageId);
    const project = projectResult.rows[0];
    if (!project || !projectPackage) return null;

    return {
      project: {
        id: project.id,
        projectNumber: project.project_number,
        name: project.name,
      },
      projectPackage,
      permissions,
      governanceAuthority,
      projectRole: project.role,
    };
  });
}

export async function getAuthorizedPackageNavigation(
  user: CurrentUser,
): Promise<AuthorizedPackageNavigation[]> {
  const navigationByModule = await Promise.all(packageAccessModules.map(async (module) => ({
    module,
    scopes: await getAuthorizedNavigation({ user, module }),
  })));
  const modulesByPackage = new Map<string, Set<PackageAccessModule>>();
  for (const { module, scopes } of navigationByModule) {
    for (const scope of scopes) {
      for (const projectPackage of scope.packages) {
        const key = `${scope.projectId}:${projectPackage.packageId}`;
        const modules = modulesByPackage.get(key) ?? new Set<PackageAccessModule>();
        modules.add(module);
        modulesByPackage.set(key, modules);
      }
    }
  }
  if (modulesByPackage.size === 0) return [];

  return withOperationalTransaction(async (client) => {
    const rows = [];
    for (const [key, modules] of modulesByPackage) {
      const separator = key.indexOf(":");
      const projectId = key.slice(0, separator);
      const packageId = key.slice(separator + 1);
      const result = await client.query<{
        project_id: string;
        project_number: string;
        project_name: string;
        package_id: string;
        package_code: string;
        package_name: string;
        current_gate_id: string | null;
      }>(
        `SELECT project.id AS project_id, project.project_number,
                project.name AS project_name, project_package.id AS package_id,
                project_package.package_code, project_package.package_name,
                gate.id AS current_gate_id
         FROM project
         JOIN project_package ON project_package.project_id = project.id
         LEFT JOIN gate
           ON gate.project_id = project.id
          AND gate.package_id = project_package.id
          AND gate.stage_id = project_package.current_stage
         WHERE project.id = $1 AND project.archived_at IS NULL
           AND project_package.id = $2 AND project_package.archived_at IS NULL
         LIMIT 1`,
        [projectId, packageId],
      );
      if (result.rows[0]) rows.push({ ...result.rows[0], modules: [...modules] });
    }

    const projects = new Map<string, AuthorizedPackageNavigation>();
    for (const row of rows) {
      const project = projects.get(row.project_id) ?? {
        projectId: row.project_id,
        projectNumber: row.project_number,
        projectName: row.project_name,
        packages: [],
      };
      project.packages.push({
        id: row.package_id,
        packageCode: row.package_code,
        packageName: row.package_name,
        currentGateId: row.current_gate_id,
        modules: row.modules,
      });
      projects.set(row.project_id, project);
    }
    return [...projects.values()].sort((left, right) =>
      left.projectNumber.localeCompare(right.projectNumber));
  });
}
