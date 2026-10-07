"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getPackages, type ProjectPackage } from "@/lib/packages";
import {
  addProjectActionUpdate,
  closeProjectAction,
  createManualProjectAction,
  deleteProjectAction,
  getProjectAction,
  parseActionTransitionFormData,
  parseActionUpdateFormData,
  parseProjectActionFormData,
  parseReopenStatus,
  reopenProjectAction,
  updateProjectAction,
  withGovernanceTierWorkflowLock,
  type ProjectAction,
} from "@/lib/project-actions";
import { getProject, type Project } from "@/lib/projects";

export async function createManualProjectActionAction(
  projectId: string,
  returnQuery: string,
  formData: FormData,
) {
  await withGovernanceTierWorkflowLock(async () => {
    const context = await getActionContext(projectId);
    formData.set("actorName", context.project.projectManager);
    formData.delete("gateId");
    const parsed = parseProjectActionFormData(
      formData,
      context.packageIds,
      context.governanceTierIds,
    );
    parsed.input.gateId = null;
    await createManualProjectAction(projectId, parsed.input, parsed.actor);
  });

  revalidateActionRegister(projectId);
  redirect(actionRegisterPath(projectId, returnQuery));
}

export async function updateProjectActionAction(
  projectId: string,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const { context, action } = await withGovernanceTierWorkflowLock(async () => {
    const context = await getActionContext(projectId);
    const existingAction = await getProjectAction(projectId, actionId);
    if (!existingAction) notFound();
    const validGovernanceTierIds = [...context.governanceTierIds];
    if (
      existingAction.governanceTierId &&
      !validGovernanceTierIds.includes(existingAction.governanceTierId)
    ) {
      validGovernanceTierIds.push(existingAction.governanceTierId);
    }
    const parsed = parseProjectActionFormData(
      formData,
      context.packageIds,
      validGovernanceTierIds,
    );
    assertGateId(parsed.input.gateId, context.gateIds);
    const action = await updateProjectAction(
      projectId,
      actionId,
      parsed.input,
      parsed.actor,
    );
    return { context, action };
  });

  revalidateActionRegister(projectId);
  revalidateRelatedGate(context.project, context.packages, action);
  redirect(actionRegisterPath(projectId, returnQuery));
}

export async function addProjectActionUpdateAction(
  projectId: string,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const context = await getActionContext(projectId);
  const parsed = parseActionUpdateFormData(formData);
  const action = await addProjectActionUpdate(
    projectId,
    actionId,
    parsed.text,
    parsed.actor,
  );

  revalidateActionRegister(projectId);
  revalidateRelatedGate(context.project, context.packages, action);
  redirect(actionRegisterPath(projectId, returnQuery));
}

export async function closeProjectActionAction(
  projectId: string,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const context = await getActionContext(projectId);
  const parsed = parseActionTransitionFormData(formData);
  const action = await closeProjectAction(
    projectId,
    actionId,
    parsed.actor,
    parsed.comment,
  );

  revalidateActionRegister(projectId);
  revalidateRelatedGate(context.project, context.packages, action);
  redirect(actionRegisterPath(projectId, returnQuery));
}

export async function reopenProjectActionAction(
  projectId: string,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const context = await getActionContext(projectId);
  const parsed = parseActionTransitionFormData(formData);
  const action = await reopenProjectAction(
    projectId,
    actionId,
    parseReopenStatus(formData),
    parsed.actor,
    parsed.comment,
  );

  revalidateActionRegister(projectId);
  revalidateRelatedGate(context.project, context.packages, action);
  redirect(actionRegisterPath(projectId, returnQuery));
}

export async function deleteProjectActionAction(
  projectId: string,
  returnQuery: string,
  actionId: string,
) {
  const context = await getActionContext(projectId);
  const action = await getProjectAction(projectId, actionId);
  if (!action) notFound();

  const result = await deleteProjectAction(projectId, actionId);
  if (!result.deleted) {
    redirect(
      actionRegisterPath(projectId, returnQuery, {
        actionError: result.reason,
        actionId: actionId,
      }),
    );
  }

  revalidateActionRegister(projectId);
  revalidateRelatedGate(context.project, context.packages, action);
  redirect(actionRegisterPath(projectId, returnQuery));
}

async function getActionContext(projectId: string) {
  const project = await getProject(projectId);
  if (!project) notFound();

  const packages = await getPackages(project.id);
  return {
    project,
    packages,
    packageIds: packages.map((projectPackage) => projectPackage.id),
    governanceTierIds: project.governanceTiers.map((tier) => tier.id),
    gateIds: [
      ...project.gates.map((gate) => gate.id),
      ...packages.flatMap((projectPackage) =>
        projectPackage.gates.map((gate) => gate.id),
      ),
    ],
  };
}

function assertGateId(gateId: string | null, validGateIds: string[]) {
  if (gateId && !validGateIds.includes(gateId)) {
    throw new Error("The selected Gate is invalid.");
  }
}

function revalidateActionRegister(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/actions`);
}

function revalidateRelatedGate(
  project: Project,
  packages: ProjectPackage[],
  action: ProjectAction,
) {
  if (!action.gateId) return;

  if (project.gates.some((gate) => gate.id === action.gateId)) {
    revalidatePath(
      `/projects/${project.id}/gates/${encodeURIComponent(action.gateId)}`,
    );
    return;
  }

  const projectPackage = packages.find((candidate) =>
    candidate.gates.some((gate) => gate.id === action.gateId),
  );
  if (projectPackage) {
    revalidatePath(
      `/projects/${project.id}/packages/${projectPackage.id}/gates/${encodeURIComponent(action.gateId)}`,
    );
  }
}

function actionRegisterPath(
  projectId: string,
  returnQuery: string,
  extra?: Record<string, string>,
) {
  const params = new URLSearchParams(returnQuery);
  params.delete("actionError");
  params.delete("actionId");
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const query = params.toString();
  return `/projects/${projectId}/actions${query ? `?${query}` : ""}`;
}
