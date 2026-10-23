"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  createApplicabilityItem,
  deleteApplicabilityItem,
  updateApplicabilityItem,
  type ApplicabilityItemType,
} from "@/lib/applicability";
import { withAuthorizedAccessMutation } from "@/lib/access-authorization";
import { requireInternalUser, withAuthorizedProjectMutation } from "@/lib/authorization";
import type { AuditEventInput } from "@/lib/audit";
import type { CurrentUser } from "@/lib/current-user";
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
  const result = await withAuthorizedApplicabilityMutation({
    projectId,
    packageId,
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
  const result = await withAuthorizedApplicabilityMutation({
    projectId,
    packageId,
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
  const deleted = await withAuthorizedApplicabilityMutation({
    projectId,
    packageId,
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

async function withAuthorizedApplicabilityMutation<T>(input: {
  projectId: string;
  packageId: string | null;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (actor: CurrentUser) => Promise<T>;
}) {
  if (!input.packageId) {
    return withAuthorizedProjectMutation({
      projectId: input.projectId,
      minimumRole: "editor",
      audit: input.audit,
      operation: input.operation,
    });
  }
  const user = await requireInternalUser();
  return withAuthorizedAccessMutation({
    user,
    projectId: input.projectId,
    packageId: input.packageId,
    module: "deliverables",
    audit: input.audit,
    operation: (_client, actor) => input.operation(actor),
  });
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
