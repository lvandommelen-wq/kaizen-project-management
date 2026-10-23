"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getActionGovernanceTierIds,
  withAuthorizedActionCreation,
  withAuthorizedActionMutation,
} from "@/lib/action-register";
import { requireInternalUser } from "@/lib/authorization";
import {
  addProjectActionUpdate,
  closeProjectAction,
  createManualProjectAction,
  deleteProjectAction,
  parseActionTransitionFormData,
  parseActionUpdateFormData,
  parseProjectActionFormData,
  parseProjectActionPackageIds,
  parseReopenStatus,
  reopenProjectAction,
  updateProjectAction,
  withGateWorkflowLock,
  withGovernanceTierWorkflowLock,
  type ProjectAction,
  type ProjectActionDeletionResult,
} from "@/lib/project-actions";

export async function createManualProjectActionAction(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  formData: FormData,
) {
  const user = await requireInternalUser();
  const packageIds = parseProjectActionPackageIds(formData);
  const packageId = packageIds[0] ?? null;
  const action = await withAuthorizedActionCreation({
    user,
    projectId,
    packageId,
    fixedPackageId: fixedPackageId ?? undefined,
    audit: (created) => ({
      eventType: "action.created",
      resourceType: "action",
      resourceId: created.id,
    }),
    operation: () => withGovernanceTierWorkflowLock(async () => {
      const governanceTierIds = await getActionGovernanceTierIds(projectId);
      setAuthenticatedActor(formData, user);
      formData.delete("gateId");
      const parsed = parseProjectActionFormData(
        formData,
        packageId ? [packageId] : [],
        governanceTierIds,
      );
      parsed.actor.userId = user.id;
      parsed.input.gateId = null;
      return createManualProjectAction(projectId, parsed.input, parsed.actor);
    }),
  });

  revalidateActionRegister(projectId, action);
  redirect(actionRegisterPath(projectId, fixedPackageId, returnQuery));
}

export async function updateProjectActionAction(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const user = await requireInternalUser();
  const packageIds = parseProjectActionPackageIds(formData);
  const destinationPackageId = packageIds[0] ?? null;
  const action = await withAuthorizedActionMutation({
    user,
    projectId,
    actionId,
    fixedPackageId: fixedPackageId ?? undefined,
    destinationPackageId,
    audit: {
      eventType: "action.updated",
      resourceType: "action",
      resourceId: actionId,
    },
    operation: (_client, _actor, existingAction) =>
      withGovernanceTierWorkflowLock(async () => {
        const governanceTierIds = await getActionGovernanceTierIds(projectId);
        if (
          existingAction.governanceTierId
          && !governanceTierIds.includes(existingAction.governanceTierId)
        ) {
          governanceTierIds.push(existingAction.governanceTierId);
        }
        setAuthenticatedActor(formData, user);
        const parsed = parseProjectActionFormData(
          formData,
          destinationPackageId ? [destinationPackageId] : [],
          governanceTierIds,
        );
        parsed.actor.userId = user.id;
        const updated = await updateProjectAction(
          projectId,
          actionId,
          parsed.input,
          parsed.actor,
        );
        return updated;
      }),
  });

  revalidateActionRegister(projectId, action);
  revalidateRelatedGate(projectId, action);
  redirect(actionRegisterPath(projectId, fixedPackageId, returnQuery));
}

export async function addProjectActionUpdateAction(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const user = await requireInternalUser();
  const action = await withAuthorizedActionMutation({
    user,
    projectId,
    actionId,
    fixedPackageId: fixedPackageId ?? undefined,
    audit: {
      eventType: "action.comment_added",
      resourceType: "action",
      resourceId: actionId,
    },
    operation: async () => {
      setAuthenticatedActor(formData, user);
      const parsed = parseActionUpdateFormData(formData);
      parsed.actor.userId = user.id;
      return addProjectActionUpdate(
        projectId,
        actionId,
        parsed.text,
        parsed.actor,
      );
    },
  });

  revalidateActionRegister(projectId, action);
  revalidateRelatedGate(projectId, action);
  redirect(actionRegisterPath(projectId, fixedPackageId, returnQuery));
}

export async function closeProjectActionAction(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const user = await requireInternalUser();
  const action = await withAuthorizedActionMutation({
    user,
    projectId,
    actionId,
    fixedPackageId: fixedPackageId ?? undefined,
    audit: {
      eventType: "action.closed",
      resourceType: "action",
      resourceId: actionId,
    },
    operation: async () => {
      setAuthenticatedActor(formData, user);
      const parsed = parseActionTransitionFormData(formData);
      parsed.actor.userId = user.id;
      return closeProjectAction(
        projectId,
        actionId,
        parsed.actor,
        parsed.comment,
        user,
      );
    },
  });

  revalidateActionRegister(projectId, action);
  revalidateRelatedGate(projectId, action);
  redirect(actionRegisterPath(projectId, fixedPackageId, returnQuery));
}

export async function reopenProjectActionAction(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  actionId: string,
  formData: FormData,
) {
  const user = await requireInternalUser();
  const action = await withAuthorizedActionMutation({
    user,
    projectId,
    actionId,
    fixedPackageId: fixedPackageId ?? undefined,
    audit: {
      eventType: "action.reopened",
      resourceType: "action",
      resourceId: actionId,
    },
    operation: async () => {
      setAuthenticatedActor(formData, user);
      const parsed = parseActionTransitionFormData(formData);
      parsed.actor.userId = user.id;
      return reopenProjectAction(
        projectId,
        actionId,
        parseReopenStatus(formData),
        parsed.actor,
        parsed.comment,
        user,
      );
    },
  });

  revalidateActionRegister(projectId, action);
  revalidateRelatedGate(projectId, action);
  redirect(actionRegisterPath(projectId, fixedPackageId, returnQuery));
}

export async function deleteProjectActionAction(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  actionId: string,
) {
  const user = await requireInternalUser();
  const { action, result } = await withAuthorizedActionMutation<{
    action: ProjectAction;
    result: ProjectActionDeletionResult;
  }>({
    user,
    projectId,
    actionId,
    fixedPackageId: fixedPackageId ?? undefined,
    audit: {
      eventType: "action.deleted",
      resourceType: "action",
      resourceId: actionId,
    },
    isSuccess: (candidate) => candidate.result.deleted,
    operation: (_client, _actor, existingAction) =>
      withGateWorkflowLock(async () => ({
        action: existingAction,
        result: await deleteProjectAction(projectId, actionId),
      })),
  });

  if (!result.deleted) {
    redirect(
      actionRegisterPath(projectId, fixedPackageId, returnQuery, {
        actionError: result.reason,
        actionId,
      }),
    );
  }

  revalidateActionRegister(projectId, action);
  revalidateRelatedGate(projectId, action);
  redirect(actionRegisterPath(projectId, fixedPackageId, returnQuery));
}

function setAuthenticatedActor(formData: FormData, user: {
  id: string;
  displayName: string;
}) {
  formData.set("actorName", user.displayName);
}

function revalidateActionRegister(projectId: string, action: ProjectAction) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/actions`);
  for (const packageId of action.packageIds) {
    revalidatePath(`/projects/${projectId}/packages/${packageId}/actions`);
  }
}

function revalidateRelatedGate(projectId: string, action: ProjectAction) {
  if (!action.gateId) return;
  const packageId = action.packageIds[0];
  revalidatePath(packageId
    ? `/projects/${projectId}/packages/${packageId}/gates/${encodeURIComponent(action.gateId)}`
    : `/projects/${projectId}/gates/${encodeURIComponent(action.gateId)}`);
}

function actionRegisterPath(
  projectId: string,
  fixedPackageId: string | null,
  returnQuery: string,
  extra?: Record<string, string>,
) {
  const params = new URLSearchParams(returnQuery);
  params.delete("actionError");
  params.delete("actionId");
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const query = params.toString();
  const base = fixedPackageId
    ? `/projects/${projectId}/packages/${fixedPackageId}/actions`
    : `/projects/${projectId}/actions`;
  return `${base}${query ? `?${query}` : ""}`;
}
