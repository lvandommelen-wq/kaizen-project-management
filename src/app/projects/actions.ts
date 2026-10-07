"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { deleteDeliverablesForProject } from "@/lib/deliverables";
import { deletePackagesForProject } from "@/lib/packages";
import {
  deleteActionsForProject,
  getProjectActionDeletionBlocker,
  withGateWorkflowLock,
} from "@/lib/project-actions";
import {
  createProjectGovernanceTier,
  createProject,
  deleteProjectGovernanceTier,
  deleteProject,
  getProject,
  moveProjectGovernanceTier,
  parseGovernanceTierFormData,
  parseProjectFormDataWithOptions,
  returnProjectToPreviousStage,
  updateProjectGovernanceTier,
  updateProject,
} from "@/lib/projects";

export async function createProjectAction(formData: FormData) {
  const project = await createProject(parseProjectFormDataWithOptions(formData));

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

export async function updateProjectAction(projectId: string, formData: FormData) {
  const existingProject = await getProject(projectId);

  if (!existingProject) {
    notFound();
  }

  const input = parseProjectFormDataWithOptions(formData);
  const project = await updateProject(projectId, {
    ...input,
    validationRequired: existingProject.validationRequired,
    currentStage: existingProject.currentStage,
  });

  if (!project) {
    notFound();
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${project.id}`);
  redirect(`/projects/${project.id}`);
}

export async function createProjectGovernanceTierAction(
  projectId: string,
  formData: FormData,
) {
  const tier = await createProjectGovernanceTier(
    projectId,
    parseGovernanceTierFormData(formData),
  );
  if (!tier) notFound();

  revalidateProjectGovernance(projectId);
  redirect(projectGovernancePath(projectId));
}

export async function updateProjectGovernanceTierAction(
  projectId: string,
  governanceTierId: string,
  formData: FormData,
) {
  const tier = await updateProjectGovernanceTier(
    projectId,
    governanceTierId,
    parseGovernanceTierFormData(formData),
  );
  if (!tier) notFound();

  revalidateProjectGovernance(projectId);
  redirect(projectGovernancePath(projectId));
}

export async function moveProjectGovernanceTierAction(
  projectId: string,
  governanceTierId: string,
  direction: "up" | "down",
) {
  if (direction !== "up" && direction !== "down") {
    throw new Error("Invalid Governance Tier move direction.");
  }
  const tier = await moveProjectGovernanceTier(
    projectId,
    governanceTierId,
    direction,
  );
  if (!tier) notFound();

  revalidateProjectGovernance(projectId);
  redirect(projectGovernancePath(projectId));
}

export async function deleteProjectGovernanceTierAction(
  projectId: string,
  governanceTierId: string,
) {
  const result = await deleteProjectGovernanceTier(projectId, governanceTierId);
  if (!result) notFound();

  if (result.outcome === "referenced") {
    const tierError = result.references.currentActionIds.length > 0
      ? "current-reference"
      : "historical-reference";
    redirect(
      `/projects/${projectId}?tierError=${tierError}&tierId=${encodeURIComponent(governanceTierId)}#governance-tiers`,
    );
  }

  revalidateProjectGovernance(projectId);
  redirect(projectGovernancePath(projectId));
}

export async function returnProjectToPreviousStageAction(projectId: string) {
  const project = await returnProjectToPreviousStage(projectId);

  if (!project) {
    notFound();
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

export async function deleteProjectAction(projectId: string) {
  await withGateWorkflowLock(async () => {
    const blocker = await getProjectActionDeletionBlocker(projectId);
    if (blocker) {
      redirect(`/projects/${projectId}?deleteError=protected-actions`);
    }

    const deleted = await deleteProject(projectId);

    if (!deleted) notFound();

    await deletePackagesForProject(projectId);
    await deleteDeliverablesForProject(projectId);
    await deleteActionsForProject(projectId);
  });

  revalidatePath("/projects");
  redirect("/projects");
}

function revalidateProjectGovernance(projectId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/actions`);
}

function projectGovernancePath(projectId: string) {
  return `/projects/${projectId}#governance-tiers`;
}
