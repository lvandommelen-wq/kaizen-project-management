"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  requireProjectRole,
  withAuthorizedProjectMutation,
} from "@/lib/authorization";
import { deleteDeliverablesForPackage } from "@/lib/deliverables";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import {
  hasActionsForPackage,
  withGateWorkflowLock,
} from "@/lib/project-actions";
import { getProject } from "@/lib/projects";
import {
  createPackage,
  deletePackage,
  getPackage,
  parsePackageFormData,
  returnPackageToPreviousStage,
  updatePackage,
} from "@/lib/packages";

export async function createPackageAction(projectId: string, formData: FormData) {
  await requireProjectRole(projectId, "editor");
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: (projectPackage) => ({
      eventType: "package.created",
      resourceType: "package",
      resourceId: projectPackage?.id ?? "unknown",
    }),
    operation: () => createPackage(projectId, parsePackageFormData(formData)),
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export async function updatePackageAction(projectId: string, packageId: string, formData: FormData) {
  await requireProjectRole(projectId, "editor");
  const existingPackage = await getPackage(projectId, packageId);

  if (!existingPackage) {
    notFound();
  }

  const input = parsePackageFormData(formData);
  const projectPackage = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "package.updated",
      resourceType: "package",
      resourceId: packageId,
      changeSummary: { fields: ["package_details"] },
    },
    operation: () => updatePackage(
      projectId,
      packageId,
      {
        ...input,
        currentStage: existingPackage.currentStage,
        status: existingPackage.status,
        targetDeliveryDate: existingPackage.targetDeliveryDate,
      },
    ),
  });

  if (!projectPackage) {
    notFound();
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  redirect(`/projects/${projectId}/packages/${packageId}`);
}

export async function returnPackageToPreviousStageAction(projectId: string, packageId: string) {
  const projectPackage = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "package.stage_returned",
      resourceType: "package",
      resourceId: packageId,
    },
    operation: () => returnPackageToPreviousStage(projectId, packageId),
  });

  if (!projectPackage) {
    notFound();
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  redirect(`/projects/${projectId}/packages/${packageId}`);
}

export async function deletePackageAction(projectId: string, packageId: string) {
  await requireProjectRole(projectId, "owner");
  if (getOperationalDataBackend() === "postgres") {
    if (await hasActionsForPackage(projectId, packageId)) {
      redirect(`/projects/${projectId}/packages/${packageId}?deleteError=linked-actions`);
    }
    const deleted = await withAuthorizedProjectMutation({
      projectId,
      minimumRole: "owner",
      audit: {
        eventType: "package.deleted_or_archived",
        resourceType: "package",
        resourceId: packageId,
      },
      operation: () => deletePackage(projectId, packageId),
    });
    if (!deleted) notFound();
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/packages/${packageId}`);
    redirect(`/projects/${projectId}`);
  }

  await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: {
      eventType: "package.deleted_or_archived",
      resourceType: "package",
      resourceId: packageId,
    },
    operation: () => withGateWorkflowLock(async () => {
    if (await hasActionsForPackage(projectId, packageId)) {
      redirect(`/projects/${projectId}/packages/${packageId}?deleteError=linked-actions`);
    }

    const deleted = await deletePackage(projectId, packageId);

    if (!deleted) {
      notFound();
    }

    await deleteDeliverablesForPackage(projectId, packageId);
    }),
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  redirect(`/projects/${projectId}`);
}
