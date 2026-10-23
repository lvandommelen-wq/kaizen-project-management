export const accessScopeTypes = [
  "entire_project",
  "overall_project",
  "specific_package",
] as const;

export const accessModules = [
  "overview",
  "actions",
  "risks",
  "issues",
  "decisions",
  "changes_moc",
  "budget",
  "planning",
  "deliverables",
  "gate_reviews",
  "documents",
] as const;

// A module becomes assignable only after every relevant Package read and
// mutation has adopted the shared authorization service.
export const assignableAccessModules = [
  "overview",
  "actions",
  "deliverables",
  "gate_reviews",
] as const;

export const packageAccessModules = assignableAccessModules;

export const accessPermissions = ["read", "read_write"] as const;
export const accessAuthorityRoles = [
  "collaborator",
  "project_access_manager",
  "package_lead",
] as const;

export type AccessScopeType = (typeof accessScopeTypes)[number];
export type AccessModule = (typeof accessModules)[number];
export type AssignableAccessModule = (typeof assignableAccessModules)[number];
export type PackageAccessModule = (typeof packageAccessModules)[number];
export type AccessPermission = (typeof accessPermissions)[number];
export type AccessAuthorityRole = (typeof accessAuthorityRoles)[number];
export type EffectiveAccessPermission = AccessPermission | null;

const permissionRank: Record<AccessPermission, number> = {
  read: 1,
  read_write: 2,
};

export function accessPermissionAllows(
  actual: EffectiveAccessPermission,
  requested: AccessPermission,
) {
  return actual !== null && permissionRank[actual] >= permissionRank[requested];
}

export function maximumAccessPermission(
  permissions: Iterable<AccessPermission>,
): EffectiveAccessPermission {
  let maximum: EffectiveAccessPermission = null;
  for (const permission of permissions) {
    if (!maximum || permissionRank[permission] > permissionRank[maximum]) {
      maximum = permission;
    }
  }
  return maximum;
}

export function isAccessModule(value: string): value is AccessModule {
  return accessModules.includes(value as AccessModule);
}

export function isAssignableAccessModule(value: string): value is AssignableAccessModule {
  return assignableAccessModules.includes(value as AssignableAccessModule);
}

export function accessModuleLabel(module: AssignableAccessModule) {
  return {
    overview: "Package Overview",
    actions: "Actions",
    deliverables: "Deliverables & Applicability",
    gate_reviews: "Gate Reviews",
  }[module];
}

export function isAccessPermission(value: string): value is AccessPermission {
  return accessPermissions.includes(value as AccessPermission);
}
