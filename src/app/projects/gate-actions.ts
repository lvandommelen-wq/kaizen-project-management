"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  withAuthorizedAccessMutation,
  withAuthorizedPackageGovernanceMutation,
} from "@/lib/access-authorization";
import {
  requireInternalUser,
  requireProjectRole,
  withAuthorizedProjectMutation,
} from "@/lib/authorization";
import type { AuditEventInput } from "@/lib/audit";
import type { PackageAccessModule } from "@/lib/access-permissions";
import { confirmGateMatrixReview } from "@/lib/applicability";
import type { CurrentUser } from "@/lib/current-user";
import {
  createDeliverable,
  deleteDeliverable,
  parseDeliverableFormData,
  updateDeliverable,
} from "@/lib/deliverables";
import {
  gateReviewApproverResponseOutcomes,
  getGateReviewApprovalState,
  isGateInPreparation,
  parseGateApproverFormData,
  type GateReviewResponseInput,
} from "@/lib/gates";
import {
  dispatchPackageGateReviewInvitations,
  dispatchProjectGateReviewInvitations,
} from "@/lib/gate-review-invitations";
import {
  createPackageGateApprover,
  deletePackageGateApprover,
  getPackage,
  reopenPackageGate,
  respondToPackageGateReview,
  submitPackageGateForApproval,
  updatePackageGateApprover,
  withdrawPackageGateSubmission,
} from "@/lib/packages";
import {
  createGateProjectAction,
  parseGateActionFormData,
  withGateWorkflowLock,
  type ProjectAction,
} from "@/lib/project-actions";
import {
  createProjectGateApprover,
  deleteProjectGateApprover,
  getProject,
  reopenProjectGate,
  respondToProjectGateReview,
  submitProjectGateForApproval,
  updateProjectGateApprover,
  withdrawProjectGateSubmission,
} from "@/lib/projects";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import {
  linkActiveGateReviewApproverUser,
} from "@/lib/operational/postgres";

export async function submitProjectGateForApprovalAction(projectId: string, gateId: string) {
  const path = projectGatePath(projectId, gateId);
  let result: Awaited<ReturnType<typeof submitProjectGateForApproval>>;
  try {
    result = await withAuthorizedProjectMutation({
      projectId,
      minimumRole: "editor",
      audit: {
        eventType: "gate.submitted",
        resourceType: "gate",
        resourceId: gateId,
      },
      isSuccess: (
        candidate: Awaited<ReturnType<typeof submitProjectGateForApproval>>,
      ) => candidate?.outcome === "submitted",
      operation: (actor) => submitProjectGateForApproval(projectId, gateId, {
        userId: actor.id,
        displayName: actor.displayName,
        email: actor.email,
        providerTenantId: actor.providerTenantId,
        providerObjectId: actor.providerObjectId,
      }),
    });
  } catch (error) {
    logUnexpectedSubmissionError("project", projectId, null, gateId, error);
    redirect(withSubmissionError(path, "unexpected"));
  }

  if (!result) {
    notFound();
  }

  if (result.outcome !== "submitted") {
    redirect(withSubmissionError(path, result.outcome));
  }

  const gateApproverIds = getGateReviewApprovalState(result.reviewCycle)
    .eligibleApprovers.map((approver) => approver.gateApproverId);
  const invitationFailures = await dispatchProjectInvitationsSafely({
    projectId,
    gateId,
    reviewCycleId: result.reviewCycle.id,
    gateApproverIds,
  });
  revalidateProjectGate(projectId, gateId);
  redirect(withSubmissionResult(
    path,
    result.reviewCycle.id,
    result.reviewCycle.cycleNumber,
    invitationFailures,
  ));
}

export async function confirmProjectGateMatrixReviewAction(
  projectId: string,
  gateId: string,
) {
  const result = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: {
      eventType: "gate.matrix_review_confirmed",
      resourceType: "gate",
      resourceId: gateId,
    },
    operation: (actor) => confirmGateMatrixReview(projectId, null, gateId, actor),
  });
  if (!result) notFound();
  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function submitPackageGateForApprovalAction(
  projectId: string,
  packageId: string,
  gateId: string,
) {
  const path = packageGatePath(projectId, packageId, gateId);
  let result: Awaited<ReturnType<typeof submitPackageGateForApproval>>;
  try {
    result = await withPackageModuleMutation({
      projectId,
      packageId,
      module: "gate_reviews",
      audit: {
        eventType: "gate.submitted",
        resourceType: "gate",
        resourceId: gateId,
        metadata: { packageId },
      },
      isSuccess: (
        candidate: Awaited<ReturnType<typeof submitPackageGateForApproval>>,
      ) => candidate?.outcome === "submitted",
      operation: (actor) => submitPackageGateForApproval(projectId, packageId, gateId, {
        userId: actor.id,
        displayName: actor.displayName,
        email: actor.email,
        providerTenantId: actor.providerTenantId,
        providerObjectId: actor.providerObjectId,
      }),
    });
  } catch (error) {
    logUnexpectedSubmissionError("package", projectId, packageId, gateId, error);
    redirect(withSubmissionError(path, "unexpected"));
  }

  if (!result) {
    notFound();
  }

  if (result.outcome !== "submitted") {
    redirect(withSubmissionError(path, result.outcome));
  }

  const gateApproverIds = getGateReviewApprovalState(result.reviewCycle)
    .eligibleApprovers.map((approver) => approver.gateApproverId);
  const invitationFailures = await dispatchPackageInvitationsSafely({
    projectId,
    packageId,
    gateId,
    reviewCycleId: result.reviewCycle.id,
    gateApproverIds,
  });
  revalidatePackageGate(projectId, packageId, gateId);
  redirect(withSubmissionResult(
    path,
    result.reviewCycle.id,
    result.reviewCycle.cycleNumber,
    invitationFailures,
  ));
}

export async function confirmPackageGateMatrixReviewAction(
  projectId: string,
  packageId: string,
  gateId: string,
) {
  const result = await withPackageModuleMutation({
    projectId,
    packageId,
    module: "gate_reviews",
    audit: {
      eventType: "gate.matrix_review_confirmed",
      resourceType: "gate",
      resourceId: gateId,
      metadata: { packageId },
    },
    operation: (actor) => confirmGateMatrixReview(
      projectId,
      packageId,
      gateId,
      actor,
    ),
  });
  if (!result) notFound();
  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function respondToProjectGateReviewAction(
  projectId: string,
  gateId: string,
  formData: FormData,
) {
  if (getOperationalDataBackend() === "postgres") {
    throw new Error("Use the authenticated Review route to record this Gate response.");
  }
  await requireProjectRole(projectId, "editor");
  const result = await respondToProjectGateReview(
    projectId,
    gateId,
    parseDevelopmentGateReviewResponse(formData),
  );

  if (!result) {
    notFound();
  }

  const path = projectGatePath(projectId, gateId);
  if (result.outcome !== "recorded") {
    redirect(withApprovalError(path, result.outcome));
  }

  const invitationFailures = result.activatedApproverIds.length > 0
    ? await dispatchProjectInvitationsSafely({
        projectId,
        gateId,
        reviewCycleId: result.reviewCycle.id,
        gateApproverIds: result.activatedApproverIds,
      })
    : 0;
  revalidateProjectGate(projectId, gateId);
  revalidatePath(`/projects/${projectId}/actions`);
  redirect(withInvitationWarning(path, result.reviewCycle.id, invitationFailures));
}

export async function respondToPackageGateReviewAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  if (getOperationalDataBackend() === "postgres") {
    throw new Error("Use the authenticated Review route to record this Gate response.");
  }
  await requireProjectRole(projectId, "editor");
  const result = await respondToPackageGateReview(
    projectId,
    packageId,
    gateId,
    parseDevelopmentGateReviewResponse(formData),
  );

  if (!result) {
    notFound();
  }

  const path = packageGatePath(projectId, packageId, gateId);
  if (result.outcome !== "recorded") {
    redirect(withApprovalError(path, result.outcome));
  }

  const invitationFailures = result.activatedApproverIds.length > 0
    ? await dispatchPackageInvitationsSafely({
        projectId,
        packageId,
        gateId,
        reviewCycleId: result.reviewCycle.id,
        gateApproverIds: result.activatedApproverIds,
      })
    : 0;
  revalidatePackageGate(projectId, packageId, gateId);
  revalidatePath(`/projects/${projectId}/actions`);
  redirect(withInvitationWarning(path, result.reviewCycle.id, invitationFailures));
}

export async function retryProjectGateReviewInvitationAction(
  projectId: string,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
) {
  await requireProjectRole(projectId, "editor");
  const invitationFailures = await dispatchProjectInvitationsSafely({
    projectId,
    gateId,
    reviewCycleId,
    gateApproverIds: [gateApproverId],
    retryFailed: true,
  });
  revalidateProjectGate(projectId, gateId);
  redirect(withReviewCycleResult(
    projectGatePath(projectId, gateId),
    reviewCycleId,
    invitationFailures,
  ));
}

export async function retryPackageGateReviewInvitationAction(
  projectId: string,
  packageId: string,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
) {
  const invitationFailures = await withPackageModuleMutation({
    projectId,
    packageId,
    module: "gate_reviews",
    audit: {
      eventType: "gate_review.invitation_retried",
      resourceType: "gate_review_cycle",
      resourceId: reviewCycleId,
      metadata: { packageId, gateId, gateApproverId },
    },
    operation: () => dispatchPackageInvitationsSafely({
      projectId,
      packageId,
      gateId,
      reviewCycleId,
      gateApproverIds: [gateApproverId],
      retryFailed: true,
    }),
  });
  revalidatePackageGate(projectId, packageId, gateId);
  redirect(withReviewCycleResult(
    packageGatePath(projectId, packageId, gateId),
    reviewCycleId,
    invitationFailures,
  ));
}

export async function linkActiveGateReviewApproverUserAction(
  projectId: string,
  packageId: string | null,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  userId: string,
) {
  const linked = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: {
      eventType: "gate_review.assignment_linked",
      resourceType: "gate_review_cycle",
      resourceId: reviewCycleId,
      changeSummary: { assignedUserId: userId },
      metadata: { gateId, packageId, gateApproverId },
    },
    operation: () => linkActiveGateReviewApproverUser({
      projectId,
      packageId,
      gateId,
      reviewCycleId,
      gateApproverId,
      userId,
    }),
  });
  if (!linked) {
    throw new Error("The active Review Cycle Approver could not be linked to that verified User.");
  }
  if (packageId) {
    revalidatePackageGate(projectId, packageId, gateId);
    redirect(packageGatePath(projectId, packageId, gateId));
  }
  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function withdrawProjectGateSubmissionAction(
  projectId: string,
  gateId: string,
  formData: FormData,
) {
  const withdrawalReason = requiredWithdrawalReason(formData);
  const result = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: {
      eventType: "gate.withdrawn",
      resourceType: "gate",
      resourceId: gateId,
      changeSummary: {
        gateStatus: { from: "submitted_for_approval", to: "not_submitted" },
        reviewCycleStatus: { from: "awaiting_approval", to: "withdrawn" },
      },
      metadata: { withdrawalReason },
    },
    isSuccess: (
      candidate: Awaited<ReturnType<typeof withdrawProjectGateSubmission>>,
    ) => candidate?.outcome === "withdrawn",
    operation: (actor) => withdrawProjectGateSubmission(
      projectId,
      gateId,
      withdrawalReason,
      {
        userId: actor.id,
        displayName: actor.displayName,
        email: actor.email,
        providerTenantId: actor.providerTenantId,
        providerObjectId: actor.providerObjectId,
      },
    ),
  });

  if (!result) {
    notFound();
  }

  if (result.outcome !== "withdrawn") {
    redirect(projectGatePath(projectId, gateId));
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function withdrawPackageGateSubmissionAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  const withdrawalReason = requiredWithdrawalReason(formData);
  const user = await requireInternalUser();
  const result = await withAuthorizedPackageGovernanceMutation({
    user,
    projectId,
    packageId,
    audit: {
      eventType: "gate.withdrawn",
      resourceType: "gate",
      resourceId: gateId,
      changeSummary: {
        gateStatus: { from: "submitted_for_approval", to: "not_submitted" },
        reviewCycleStatus: { from: "awaiting_approval", to: "withdrawn" },
      },
      metadata: { packageId, withdrawalReason },
    },
    isSuccess: (
      candidate: Awaited<ReturnType<typeof withdrawPackageGateSubmission>>,
    ) => candidate?.outcome === "withdrawn",
    operation: (_client, actor) => withdrawPackageGateSubmission(
      projectId,
      packageId,
      gateId,
      withdrawalReason,
      {
        userId: actor.id,
        displayName: actor.displayName,
        email: actor.email,
        providerTenantId: actor.providerTenantId,
        providerObjectId: actor.providerObjectId,
      },
    ),
  });

  if (!result) {
    notFound();
  }

  if (result.outcome !== "withdrawn") {
    redirect(packageGatePath(projectId, packageId, gateId));
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

function requiredWithdrawalReason(formData: FormData) {
  const reason = String(formData.get("withdrawalReason") ?? "").trim();
  if (!reason) throw new Error("A withdrawal reason is required.");
  return reason;
}

export async function createProjectGateActionAction(projectId: string, gateId: string, formData: FormData) {
  await withAuthorizedProjectMutation<ProjectAction>({
    projectId,
    minimumRole: "editor",
    audit: (action) => ({ eventType: "action.created", resourceType: "action", resourceId: action.id, metadata: { gateId } }),
    operation: (actor) => withCompatibleGateActionWriteAccess({
      actor,
      projectId,
      packageId: null,
      operation: () => withGateWorkflowLock(async () => {
        const project = await getProject(projectId);
        const gate = project?.gates.find((candidate) => candidate.id === gateId);

        if (!project || !gate) notFound();
        if (gate.stageId !== project.currentStage || !isGateInPreparation(gate)) {
          redirect(projectGatePath(projectId, gateId));
        }

        formData.set("actorName", actor.displayName);
        const parsed = parseGateActionFormData(formData);
        parsed.actor.userId = actor.id;
        return createGateProjectAction(
          project.id,
          gate.id,
          [],
          true,
          parsed.input,
          parsed.actor,
        );
      }),
    }),
  });
  revalidateProjectGate(projectId, gateId);
  revalidatePath(`/projects/${projectId}/actions`);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageGateActionAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  await withPackageModuleMutation<ProjectAction>({
    projectId,
    packageId,
    module: "gate_reviews",
    audit: (action) => ({ eventType: "action.created", resourceType: "action", resourceId: action.id, metadata: { gateId, packageId } }),
    operation: (actor) => withCompatibleGateActionWriteAccess({
      actor,
      projectId,
      packageId,
      operation: () => withGateWorkflowLock(async () => {
        const projectPackage = await getPackage(projectId, packageId);
        const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

        if (!projectPackage || !gate) notFound();
        if (gate.stageId !== projectPackage.currentStage || !isGateInPreparation(gate)) {
          redirect(packageGatePath(projectId, packageId, gateId));
        }

        formData.set("actorName", actor.displayName);
        const parsed = parseGateActionFormData(formData);
        parsed.actor.userId = actor.id;
        return createGateProjectAction(
          projectId,
          gate.id,
          [projectPackage.id],
          true,
          parsed.input,
          parsed.actor,
        );
      }),
    }),
  });
  revalidatePackageGate(projectId, packageId, gateId);
  revalidatePath(`/projects/${projectId}/actions`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}/actions`);
  redirect(packageGatePath(projectId, packageId, gateId));
}

async function withCompatibleGateActionWriteAccess(input: {
  actor: CurrentUser;
  projectId: string;
  packageId: string | null;
  operation: () => Promise<ProjectAction>;
}) {
  try {
    return await withAuthorizedAccessMutation<ProjectAction>({
      user: input.actor,
      projectId: input.projectId,
      packageId: input.packageId,
      module: "actions",
      requestedPermission: "read_write",
      operation: input.operation,
    });
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes("Access Management PostgreSQL migration 019 has not been applied")
    ) {
      return input.operation();
    }
    throw error;
  }
}

export async function reopenProjectGateAction(
  projectId: string,
  gateId: string,
  formData: FormData,
) {
  const reopeningReason = String(formData.get("reopeningReason") ?? "").trim();
  if (!reopeningReason) throw new Error("A reopening reason is required.");
  const reopening = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "owner",
    audit: (result) => {
      if (!result) throw new Error("The reopened Project Gate result is unavailable.");
      return {
        eventType: "gate.reopened",
        resourceType: "gate",
        resourceId: gateId,
        changeSummary: {
          stage: { from: result.previousStage, to: result.targetStage },
          reopeningReason: result.reason,
        },
        metadata: {
          reviewCycleId: result.reviewCycleId,
          reopeningReason: result.reason,
          previousStage: result.previousStage,
          targetStage: result.targetStage,
          reopenedAt: result.reopenedAt,
        },
      };
    },
    operation: () => reopenProjectGate(projectId, gateId, reopeningReason),
  });

  if (!reopening) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function reopenPackageGateAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  const reopeningReason = String(formData.get("reopeningReason") ?? "").trim();
  if (!reopeningReason) throw new Error("A reopening reason is required.");
  const user = await requireInternalUser();
  const reopening = await withAuthorizedPackageGovernanceMutation({
    user,
    projectId,
    packageId,
    audit: (result) => {
      if (!result) throw new Error("The reopened Package Gate result is unavailable.");
      return {
        eventType: "gate.reopened",
        resourceType: "gate",
        resourceId: gateId,
        changeSummary: {
          stage: { from: result.previousStage, to: result.targetStage },
          reopeningReason: result.reason,
        },
        metadata: {
          packageId,
          reviewCycleId: result.reviewCycleId,
          reopeningReason: result.reason,
          previousStage: result.previousStage,
          targetStage: result.targetStage,
          reopenedAt: result.reopenedAt,
        },
      };
    },
    operation: () => reopenPackageGate(
      projectId,
      packageId,
      gateId,
      reopeningReason,
    ),
  });

  if (!reopening) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function createProjectGateApproverAction(projectId: string, gateId: string, formData: FormData) {
  const input = parseGateApproverFormData(formData);
  const approver = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: (created) => ({ eventType: "gate_approver.created", resourceType: "gate_approver", resourceId: created?.id ?? "unknown", metadata: { gateId } }),
    operation: () => createProjectGateApprover(projectId, gateId, input),
  });

  if (!approver) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function updateProjectGateApproverAction(
  projectId: string,
  gateId: string,
  approverId: string,
  formData: FormData,
) {
  const input = parseGateApproverFormData(formData);
  const approver = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: { eventType: "gate_approver.updated", resourceType: "gate_approver", resourceId: approverId, metadata: { gateId } },
    operation: () => updateProjectGateApprover(projectId, gateId, approverId, input),
  });

  if (!approver) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function deleteProjectGateApproverAction(
  projectId: string,
  gateId: string,
  approverId: string,
) {
  const deleted = await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: { eventType: "gate_approver.deleted", resourceType: "gate_approver", resourceId: approverId, metadata: { gateId } },
    operation: () => deleteProjectGateApprover(projectId, gateId, approverId),
  });

  if (!deleted) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageGateApproverAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  const input = parseGateApproverFormData(formData);
  const approver = await withPackageModuleMutation({
    projectId,
    packageId,
    module: "gate_reviews",
    audit: (created) => ({ eventType: "gate_approver.created", resourceType: "gate_approver", resourceId: created?.id ?? "unknown", metadata: { gateId, packageId } }),
    operation: () => createPackageGateApprover(projectId, packageId, gateId, input),
  });

  if (!approver) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function updatePackageGateApproverAction(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
  formData: FormData,
) {
  const input = parseGateApproverFormData(formData);
  const approver = await withPackageModuleMutation({
    projectId,
    packageId,
    module: "gate_reviews",
    audit: { eventType: "gate_approver.updated", resourceType: "gate_approver", resourceId: approverId, metadata: { gateId, packageId } },
    operation: () => updatePackageGateApprover(projectId, packageId, gateId, approverId, input),
  });

  if (!approver) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function deletePackageGateApproverAction(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
) {
  const deleted = await withPackageModuleMutation({
    projectId,
    packageId,
    module: "gate_reviews",
    audit: { eventType: "gate_approver.deleted", resourceType: "gate_approver", resourceId: approverId, metadata: { gateId, packageId } },
    operation: () => deletePackageGateApprover(projectId, packageId, gateId, approverId),
  });

  if (!deleted) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function createProjectDeliverableAction(projectId: string, gateId: string, formData: FormData) {
  await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: (deliverable) => ({ eventType: "deliverable.created", resourceType: "deliverable", resourceId: deliverable.id, metadata: { gateId } }),
    operation: () => withGateWorkflowLock(async () => {
    const { gate } = await requireProjectGatePreparation(projectId, gateId);

    return createDeliverable(
      parseDeliverableFormData(formData, {
        projectId,
        packageId: null,
        gateId,
        stageId: gate.stageId,
      }),
    );
    }),
  });

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function updateProjectDeliverableAction(
  projectId: string,
  gateId: string,
  deliverableId: string,
  formData: FormData,
) {
  await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: { eventType: "deliverable.updated", resourceType: "deliverable", resourceId: deliverableId, metadata: { gateId } },
    operation: () => withGateWorkflowLock(async () => {
    const { gate } = await requireProjectGatePreparation(projectId, gateId);

    const deliverable = await updateDeliverable(
      deliverableId,
      parseDeliverableFormData(formData, {
        projectId,
        packageId: null,
        gateId,
        stageId: gate.stageId,
      }),
    );

    if (!deliverable) {
      notFound();
    }
    return deliverable;
    }),
  });

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function deleteProjectDeliverableAction(
  projectId: string,
  gateId: string,
  deliverableId: string,
) {
  await withAuthorizedProjectMutation({
    projectId,
    minimumRole: "editor",
    audit: { eventType: "deliverable.deleted", resourceType: "deliverable", resourceId: deliverableId, metadata: { gateId } },
    operation: () => withGateWorkflowLock(async () => {
    await requireProjectGatePreparation(projectId, gateId);
    const deleted = await deleteDeliverable(deliverableId, {
      projectId,
      packageId: null,
      gateId,
    });

    if (!deleted) {
      notFound();
    }
    return deleted;
    }),
  });

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageDeliverableAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  await withPackageModuleMutation({
    projectId,
    packageId,
    module: "deliverables",
    audit: (deliverable) => ({ eventType: "deliverable.created", resourceType: "deliverable", resourceId: deliverable.id, metadata: { gateId, packageId } }),
    operation: () => withGateWorkflowLock(async () => {
    const { gate } = await requirePackageGatePreparation(projectId, packageId, gateId);

    return createDeliverable(
      parseDeliverableFormData(formData, {
        projectId,
        packageId,
        gateId,
        stageId: gate.stageId,
      }),
    );
    }),
  });

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function updatePackageDeliverableAction(
  projectId: string,
  packageId: string,
  gateId: string,
  deliverableId: string,
  formData: FormData,
) {
  await withPackageModuleMutation({
    projectId,
    packageId,
    module: "deliverables",
    audit: { eventType: "deliverable.updated", resourceType: "deliverable", resourceId: deliverableId, metadata: { gateId, packageId } },
    operation: () => withGateWorkflowLock(async () => {
    const { gate } = await requirePackageGatePreparation(projectId, packageId, gateId);

    const deliverable = await updateDeliverable(
      deliverableId,
      parseDeliverableFormData(formData, {
        projectId,
        packageId,
        gateId,
        stageId: gate.stageId,
      }),
    );

    if (!deliverable) {
      notFound();
    }
    return deliverable;
    }),
  });

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function deletePackageDeliverableAction(
  projectId: string,
  packageId: string,
  gateId: string,
  deliverableId: string,
) {
  await withPackageModuleMutation({
    projectId,
    packageId,
    module: "deliverables",
    audit: { eventType: "deliverable.deleted", resourceType: "deliverable", resourceId: deliverableId, metadata: { gateId, packageId } },
    operation: () => withGateWorkflowLock(async () => {
    await requirePackageGatePreparation(projectId, packageId, gateId);
    const deleted = await deleteDeliverable(deliverableId, {
      projectId,
      packageId,
      gateId,
    });

    if (!deleted) {
      notFound();
    }
    return deleted;
    }),
  });

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

async function requireProjectGatePreparation(projectId: string, gateId: string) {
  const project = await getProject(projectId);
  const gate = project?.gates.find((candidate) => candidate.id === gateId);

  if (!project || !gate) notFound();
  if (
    !isGateInPreparation(gate)
    && !gate.deliverableConfigurationLocked
    && !gate.deliverableCompletionLocked
  ) {
    redirect(projectGatePath(projectId, gateId));
  }

  return { project, gate };
}

async function requirePackageGatePreparation(projectId: string, packageId: string, gateId: string) {
  const projectPackage = await getPackage(projectId, packageId);
  const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

  if (!projectPackage || !gate) notFound();
  if (
    !isGateInPreparation(gate)
    && !gate.deliverableConfigurationLocked
    && !gate.deliverableCompletionLocked
  ) {
    redirect(packageGatePath(projectId, packageId, gateId));
  }

  return { projectPackage, gate };
}

async function withPackageModuleMutation<T>(input: {
  projectId: string;
  packageId: string;
  module: PackageAccessModule;
  audit: AuditEventInput | ((result: T) => AuditEventInput);
  operation: (actor: CurrentUser) => Promise<T>;
  isSuccess?: (result: T) => boolean;
}) {
  const user = await requireInternalUser();
  return withAuthorizedAccessMutation({
    user,
    projectId: input.projectId,
    packageId: input.packageId,
    module: input.module,
    audit: input.audit,
    operation: (_client, actor) => input.operation(actor),
    isSuccess: input.isSuccess,
  });
}

function parseDevelopmentGateReviewResponse(
  formData: FormData,
): GateReviewResponseInput {
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "The temporary Approver test identity is disabled in production.",
    );
  }

  const reviewCycleId = String(formData.get("reviewCycleId") ?? "").trim();
  const gateApproverId = String(formData.get("gateApproverId") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "");
  if (!reviewCycleId || !gateApproverId) {
    throw new Error("Select an eligible frozen Approver.");
  }
  if (
    !gateReviewApproverResponseOutcomes.includes(
      outcome as GateReviewResponseInput["outcome"],
    )
  ) {
    throw new Error("Select a valid approval response.");
  }

  return {
    reviewCycleId,
    gateApproverId,
    outcome: outcome as GateReviewResponseInput["outcome"],
    comment: String(formData.get("comment") ?? "").trim(),
  };
}

function withApprovalError(path: string, outcome: string) {
  const query = new URLSearchParams({ approvalError: outcome });
  return `${path}?${query}`;
}

function withSubmissionError(
  path: string,
  outcome: "blocked" | "not_current" | "not_in_preparation" | "unexpected",
) {
  const query = new URLSearchParams({ submissionError: outcome });
  return `${path}?${query}`;
}

function logUnexpectedSubmissionError(
  scope: "project" | "package",
  projectId: string,
  packageId: string | null,
  gateId: string,
  error: unknown,
) {
  console.error("Unexpected Gate submission failure.", {
    scope,
    projectId,
    packageId,
    gateId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

function withSubmissionResult(
  path: string,
  reviewCycleId: string,
  cycleNumber: number,
  invitationFailures: number,
) {
  const query = new URLSearchParams({
    submitted: String(cycleNumber),
    reviewCycle: reviewCycleId,
  });
  if (invitationFailures > 0) {
    query.set("invitationFailures", String(invitationFailures));
  }
  return `${path}?${query}#review-cycle-${reviewCycleId}`;
}

function withInvitationWarning(
  path: string,
  reviewCycleId: string,
  invitationFailures: number,
) {
  if (invitationFailures === 0) return path;
  const query = new URLSearchParams({
    reviewCycle: reviewCycleId,
    invitationFailures: String(invitationFailures),
  });
  return `${path}?${query}#review-cycle-${reviewCycleId}`;
}

function withReviewCycleResult(
  path: string,
  reviewCycleId: string,
  invitationFailures: number,
) {
  const query = new URLSearchParams({ reviewCycle: reviewCycleId });
  if (invitationFailures > 0) {
    query.set("invitationFailures", String(invitationFailures));
  }
  return `${path}?${query}#review-cycle-${reviewCycleId}`;
}

async function dispatchProjectInvitationsSafely(input: Parameters<
  typeof dispatchProjectGateReviewInvitations
>[0]) {
  try {
    const summary = await dispatchProjectGateReviewInvitations(input);
    return summary.failed;
  } catch {
    return input.gateApproverIds.length;
  }
}

async function dispatchPackageInvitationsSafely(input: Parameters<
  typeof dispatchPackageGateReviewInvitations
>[0]) {
  try {
    const summary = await dispatchPackageGateReviewInvitations(input);
    return summary.failed;
  } catch {
    return input.gateApproverIds.length;
  }
}

function projectGatePath(projectId: string, gateId: string) {
  return `/projects/${projectId}/gates/${encodeURIComponent(gateId)}`;
}

function packageGatePath(projectId: string, packageId: string, gateId: string) {
  return `/projects/${projectId}/packages/${packageId}/gates/${encodeURIComponent(gateId)}`;
}

function revalidateProjectGate(projectId: string, gateId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(projectGatePath(projectId, gateId));
}

function revalidatePackageGate(projectId: string, packageId: string, gateId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  revalidatePath(packageGatePath(projectId, packageId, gateId));
}
