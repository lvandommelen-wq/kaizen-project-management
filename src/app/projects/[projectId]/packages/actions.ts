"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { deleteDeliverablesForPackage } from "@/lib/deliverables";
import { hasActionsForPackage } from "@/lib/project-actions";
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
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  await createPackage(projectId, parsePackageFormData(formData));

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export async function updatePackageAction(projectId: string, packageId: string, formData: FormData) {
  const existingPackage = await getPackage(projectId, packageId);

  if (!existingPackage) {
    notFound();
  }

  const input = parsePackageFormData(formData);
  const projectPackage = await updatePackage(
    projectId,
    packageId,
    {
      ...input,
      currentStage: existingPackage.currentStage,
      status: existingPackage.status,
      targetDeliveryDate: existingPackage.targetDeliveryDate,
    },
  );

  if (!projectPackage) {
    notFound();
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  redirect(`/projects/${projectId}/packages/${packageId}`);
}

export async function returnPackageToPreviousStageAction(projectId: string, packageId: string) {
  const projectPackage = await returnPackageToPreviousStage(projectId, packageId);

  if (!projectPackage) {
    notFound();
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  redirect(`/projects/${projectId}/packages/${packageId}`);
}

export async function deletePackageAction(projectId: string, packageId: string) {
  if (await hasActionsForPackage(projectId, packageId)) {
    redirect(`/projects/${projectId}/packages/${packageId}?deleteError=linked-actions`);
  }

  const deleted = await deletePackage(projectId, packageId);

  if (!deleted) {
    notFound();
  }

  await deleteDeliverablesForPackage(projectId, packageId);

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  redirect(`/projects/${projectId}`);
}
