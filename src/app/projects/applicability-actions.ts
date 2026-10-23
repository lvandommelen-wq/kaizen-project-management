"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  createApplicabilityItem,
  deleteApplicabilityItem,
  updateApplicabilityItem,
  type ApplicabilityItemType,
} from "@/lib/applicability";
import { withAuthorizedProjectMutation } from "@/lib/authorization";
import { applicabilityValues, type Applicability } from "@/lib/gates";

export async function updateApplicabilityItemAction(
  projectId: string,
  packageId: string | null,
  gateId: string,
  itemType: ApplicabilityItemType,
  itemId: string,
  formData: FormData,
) {
  const applicability = String(formData.get("applicability") ?? "");
  if (!applicabilityValues.includes(applicability as Applicability)) {
    throw new Error("Select a valid applicability decision.");
  }
  const result = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "applicability.updated",
      resourceType: "deliverable",
      resourceId: itemId,
      changeSummary: { applicability },
      metadata: { gateId, packageId },
    },
    operation: (actor) => updateApplicabilityItem({
      projectId,
      packageId,
      gateId,
      itemType,
      itemId,
      applicability: applicability as Applicability,
      justification: String(formData.get("justification") ?? ""),
    }, actor),
  });
  if (!result) notFound();
  revalidateApplicability(projectId, packageId);
  redirect(applicabilityPath(projectId, packageId));
}

export async function createApplicabilityItemAction(
  projectId: string,
  packageId: string | null,
  gateId: string,
  itemType: ApplicabilityItemType,
  formData: FormData,
) {
  const result = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: (itemId: string | null) => ({
      eventType: "applicability_item.created",
      resourceType: "deliverable",
      resourceId: itemId ?? "unknown",
      metadata: { gateId, packageId },
    }),
    operation: (actor) => createApplicabilityItem({
      projectId,
      packageId,
      gateId,
      itemType,
      title: String(formData.get("title") ?? ""),
    }, actor),
  });
  if (!result) notFound();
  revalidateApplicability(projectId, packageId);
  redirect(applicabilityPath(projectId, packageId));
}

export async function deleteApplicabilityItemAction(
  projectId: string,
  packageId: string | null,
  gateId: string,
  itemType: ApplicabilityItemType,
  itemId: string,
) {
  const deleted = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "applicability_item.deleted",
      resourceType: "deliverable",
      resourceId: itemId,
      metadata: { gateId, packageId },
    },
    operation: () => deleteApplicabilityItem({ projectId, packageId, gateId, itemType, itemId }),
  });
  if (!deleted) throw new Error("This custom item is protected by formal governance history and cannot be deleted.");
  revalidateApplicability(projectId, packageId);
  redirect(applicabilityPath(projectId, packageId));
}

function applicabilityPath(projectId: string, packageId: string | null) {
  return packageId
    ? `/projects/${projectId}/packages/${packageId}/applicability`
    : `/projects/${projectId}/applicability`;
}

function revalidateApplicability(projectId: string, packageId: string | null) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(applicabilityPath(projectId, packageId));
  if (packageId) revalidatePath(`/projects/${projectId}/packages/${packageId}`);
}
