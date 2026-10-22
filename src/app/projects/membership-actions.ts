"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  projectMembershipRoles,
  withAuthorizedProjectMutation,
  type ProjectMembershipRole,
} from "@/lib/authorization";
import {
  deleteProjectMembership,
  upsertProjectMembership,
} from "@/lib/operational/postgres";

export async function saveProjectMembershipAction(
  projectId: string,
  formData: FormData,
) {
  const userId = String(formData.get("userId") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  if (!userId || !projectMembershipRoles.includes(role as ProjectMembershipRole)) {
    throw new Error("Select an active internal User and a valid Project role.");
  }

  const membership = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: {
      eventType: "project_membership.saved",
      resourceType: "project_membership",
      resourceId: userId,
      changeSummary: { role },
    },
    operation: () => upsertProjectMembership(
      projectId,
      userId,
      role as ProjectMembershipRole,
    ),
  });
  if (!membership) throw new Error("The Project membership could not be saved.");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/members`);
  redirect(`/projects/${projectId}/members`);
}

export async function removeProjectMembershipAction(
  projectId: string,
  userId: string,
) {
  const removed = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: {
      eventType: "project_membership.removed",
      resourceType: "project_membership",
      resourceId: userId,
    },
    operation: () => deleteProjectMembership(projectId, userId),
  });
  if (!removed) throw new Error("The Project membership could not be removed.");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/members`);
  redirect(`/projects/${projectId}/members`);
}
