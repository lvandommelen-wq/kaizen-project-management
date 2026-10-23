"use server";

import { revalidatePath } from "next/cache";
import {
  AccessManagementInputError,
  revokeInternalAccessGrant,
  saveInternalAccessGrant,
} from "@/lib/access-management";
import {
  accessAuthorityRoles,
  accessPermissions,
  packageAccessModules,
  accessScopeTypes,
  type AccessAuthorityRole,
  type AccessPermission,
  type AssignableAccessModule,
  type AccessScopeType,
} from "@/lib/access-permissions";
import { requireInternalUser } from "@/lib/authorization";

export type AccessActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function saveProjectAccessGrantAction(
  projectId: string,
  _previousState: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireInternalUser();
  try {
    const input = parseProjectGrant(projectId, formData);
    await saveInternalAccessGrant(actor, input);
    revalidateAccessPaths(projectId, input.packageId);
    return { status: "success", message: "Access assignment saved." };
  } catch (error) {
    return expectedActionError(error);
  }
}

export async function savePackageAccessGrantAction(
  projectId: string,
  packageId: string,
  _previousState: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireInternalUser();
  try {
    const targetUserId = requiredValue(formData, "userId", "Select an internal User.");
    const existingGrantId = optionalValue(formData, "grantId");
    const authorityRole = authorityValue(formData);
    if (authorityRole === "project_access_manager") {
      throw new AccessManagementInputError(
        "Project Access Manager authority cannot be assigned from a Package.",
      );
    }
    await saveInternalAccessGrant(actor, {
      projectId,
      existingGrantId,
      targetUserId,
      scopeType: "specific_package",
      packageId,
      authorityRole,
      permissions: permissionsValue(formData, authorityRole, "specific_package"),
      expectedExistingPackageId: existingGrantId ? packageId : undefined,
    });
    revalidateAccessPaths(projectId, packageId);
    return { status: "success", message: "Package access assignment saved." };
  } catch (error) {
    return expectedActionError(error);
  }
}

export async function revokeProjectAccessGrantAction(
  projectId: string,
  _previousState: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireInternalUser();
  try {
    await revokeInternalAccessGrant(actor, {
      projectId,
      grantId: requiredValue(formData, "grantId", "The access assignment is required."),
      confirmNoPackageLead: formData.get("confirmNoPackageLead") === "on",
    });
    revalidateAccessPaths(projectId, optionalValue(formData, "packageId") ?? null);
    return { status: "success", message: "Access assignment revoked." };
  } catch (error) {
    return expectedActionError(error);
  }
}

export async function revokePackageAccessGrantAction(
  projectId: string,
  packageId: string,
  _previousState: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireInternalUser();
  try {
    await revokeInternalAccessGrant(actor, {
      projectId,
      grantId: requiredValue(formData, "grantId", "The access assignment is required."),
      confirmNoPackageLead: formData.get("confirmNoPackageLead") === "on",
      expectedPackageId: packageId,
    });
    revalidateAccessPaths(projectId, packageId);
    return { status: "success", message: "Package access assignment revoked." };
  } catch (error) {
    return expectedActionError(error);
  }
}

function parseProjectGrant(projectId: string, formData: FormData) {
  const scopeType = scopeValue(formData);
  const packageId = scopeType === "specific_package"
    ? requiredValue(formData, "packageId", "Select a Package.")
    : null;
  return {
    projectId,
    existingGrantId: optionalValue(formData, "grantId"),
    targetUserId: requiredValue(formData, "userId", "Select an internal User."),
    scopeType,
    packageId,
    authorityRole: authorityValue(formData),
    permissions: permissionsValue(formData, authorityValue(formData), scopeType),
  };
}

function scopeValue(formData: FormData): AccessScopeType {
  const value = String(formData.get("scopeType") ?? "");
  if (!accessScopeTypes.includes(value as AccessScopeType)) {
    throw new AccessManagementInputError("Select a valid access scope.");
  }
  return value as AccessScopeType;
}

function authorityValue(formData: FormData): AccessAuthorityRole {
  const value = String(formData.get("authorityRole") ?? "collaborator");
  if (!accessAuthorityRoles.includes(value as AccessAuthorityRole)) {
    throw new AccessManagementInputError("Select a valid authority role.");
  }
  return value as AccessAuthorityRole;
}

function permissionsValue(
  formData: FormData,
  authorityRole: AccessAuthorityRole,
  scopeType: AccessScopeType,
) {
  if (authorityRole === "package_lead") {
    return packageAccessModules.map((module) => ({
      module,
      permission: "read_write" as const,
    }));
  }
  const modules = scopeType === "overall_project"
    ? (["actions"] as const)
    : packageAccessModules;
  return modules.flatMap((module) => {
    const value = String(formData.get(`permission_${module}`) ?? "");
    if (!value) return [];
    if (!accessPermissions.includes(value as AccessPermission)) {
      throw new AccessManagementInputError(
        `Select a valid ${module.replaceAll("_", " ")} permission.`,
      );
    }
    return [{ module: module as AssignableAccessModule, permission: value as AccessPermission }];
  });
}

function requiredValue(formData: FormData, name: string, message: string) {
  const value = optionalValue(formData, name);
  if (!value) throw new AccessManagementInputError(message);
  return value;
}

function optionalValue(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  return value || undefined;
}

function expectedActionError(error: unknown): AccessActionState {
  if (error instanceof AccessManagementInputError) {
    return { status: "error", message: error.message };
  }
  throw error;
}

function revalidateAccessPaths(projectId: string, packageId: string | null) {
  revalidatePath(`/projects/${projectId}/access`);
  revalidatePath(`/projects/${projectId}`);
  if (packageId) {
    revalidatePath(`/projects/${projectId}/packages/${packageId}/access`);
    revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  }
}
