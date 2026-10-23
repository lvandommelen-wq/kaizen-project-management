"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  requireProjectRole,
  withAuthorizedProjectCreation,
  withAuthorizedProjectMutation,
} from "@/lib/authorization";
import { deleteDeliverablesForProject } from "@/lib/deliverables";
import { deletePackagesForProject } from "@/lib/packages";
import { getOperationalDataBackend } from "@/lib/operational/backend";
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
  updateProjectGovernanceTier,
  updateProject,
} from "@/lib/projects";

export async function createProjectAction(formData: FormData) {
  const project = await withAuthorizedProjectCreation({
    operation: (actor) => createProject(
      parseProjectFormDataWithOptions(formData),
      actor.id,
    ),
    audit: {
      eventType: "project.created",
      resourceType: "project",
      changeSummary: { fields: ["project"] },
    },
  });

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

export async function updateProjectAction(projectId: string, formData: FormData) {
  await requireProjectRole(projectId, "editor");
  const existingProject = await getProject(projectId);

  if (!existingProject) {
    notFound();
  }

  const input = parseProjectFormDataWithOptions(formData);
  const project = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "project.updated",
      resourceType: "project",
      resourceId: projectId,
      changeSummary: { fields: ["project_details"] },
    },
    operation: () => updateProject(projectId, {
      ...input,
      validationRequired: existingProject.validationRequired,
      currentStage: existingProject.currentStage,
    }),
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
  const tier = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: (created) => ({
      eventType: "governance_tier.created",
      resourceType: "governance_tier",
      resourceId: created?.id ?? "unknown",
    }),
    operation: () => createProjectGovernanceTier(
      projectId,
      parseGovernanceTierFormData(formData),
    ),
  });
  if (!tier) notFound();

  revalidateProjectGovernance(projectId);
  redirect(projectGovernancePath(projectId));
}

export async function updateProjectGovernanceTierAction(
  projectId: string,
  governanceTierId: string,
  formData: FormData,
) {
  const tier = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "governance_tier.updated",
      resourceType: "governance_tier",
      resourceId: governanceTierId,
    },
    operation: () => updateProjectGovernanceTier(
      projectId,
      governanceTierId,
      parseGovernanceTierFormData(formData),
    ),
  });
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
  const tier = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "governance_tier.reordered",
      resourceType: "governance_tier",
      resourceId: governanceTierId,
      changeSummary: { direction },
    },
    operation: () => moveProjectGovernanceTier(
      projectId,
      governanceTierId,
      direction,
    ),
  });
  if (!tier) notFound();

  revalidateProjectGovernance(projectId);
  redirect(projectGovernancePath(projectId));
}

export async function deleteProjectGovernanceTierAction(
  projectId: string,
  governanceTierId: string,
) {
  const result = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "governance_tier.deleted",
      resourceType: "governance_tier",
      resourceId: governanceTierId,
    },
    operation: () => deleteProjectGovernanceTier(projectId, governanceTierId),
    isSuccess: (candidate) => candidate?.outcome === "deleted",
  });
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

export async function deleteProjectAction(projectId: string) {
  if (getOperationalDataBackend() === "postgres") {
    const deleted = await withAuthorizedProjectMutation({
      projectId,
      minimumRole: "owner",
      audit: {
        eventType: "project.deleted_or_archived",
        resourceType: "project",
        resourceId: projectId,
      },
      operation: () => deleteProject(projectId),
    });
    if (!deleted) notFound();
    revalidatePath("/projects");
    redirect("/projects");
  }

  await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: {
      eventType: "project.deleted_or_archived",
      resourceType: "project",
      resourceId: projectId,
    },
    operation: () => withGateWorkflowLock(async () => {
    const blocker = await getProjectActionDeletionBlocker(projectId);
    if (blocker) {
      redirect(`/projects/${projectId}?deleteError=protected-actions`);
    }

    const deleted = await deleteProject(projectId);

    if (!deleted) notFound();

    await deletePackagesForProject(projectId);
    await deleteDeliverablesForProject(projectId);
    await deleteActionsForProject(projectId);
    }),
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
