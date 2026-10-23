import { notFound } from "next/navigation";
import { GateDetail } from "@/app/projects/_components/gate-detail";
import {
  createProjectGateActionAction,
  createProjectGateApproverAction,
  confirmProjectGateMatrixReviewAction,
  deleteProjectGateApproverAction,
  linkActiveGateReviewApproverUserAction,
  reopenProjectGateAction,
  respondToProjectGateReviewAction,
  retryProjectGateReviewInvitationAction,
  submitProjectGateForApprovalAction,
  updateProjectDeliverableAction,
  updateProjectGateApproverAction,
  withdrawProjectGateSubmissionAction,
} from "@/app/projects/gate-actions";
import { getGateDeliverables } from "@/lib/deliverables";
import { getPackages } from "@/lib/packages";
import { getProject, projectStageLabels } from "@/lib/projects";
import { getCurrentProjectRole } from "@/lib/authorization";
import { getAuthorizedGateActionView } from "@/lib/action-register";
import { accessPermissionAllows } from "@/lib/access-permissions";
import { getActiveGateReviewIdentityLinkCandidates } from "@/lib/operational/postgres";
import { getAwaitingGateReviewCycle, getGateSubmissionIssues } from "@/lib/gates";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import { getApplicabilityReview, getGateMatrixReview } from "@/lib/applicability";
import { getMatrixReviewSubmissionIssues } from "@/lib/matrix-reviews";

export const dynamic = "force-dynamic";

export default async function ProjectGatePage({
  params,
  searchParams,
}: PageProps<"/projects/[projectId]/gates/[gateId]">) {
  const { projectId, gateId } = await params;
  const query = await searchParams;
  const resolvedGateId = decodeURIComponent(gateId);
  const access = await getCurrentProjectRole(projectId);
  if (!access) notFound();
  const project = await getProject(projectId);
  const gate = project?.gates.find((gate) => gate.id === resolvedGateId);

  if (!project || !gate) {
    notFound();
  }

  const packages = await getPackages(project.id);
  const matrixReview = getOperationalDataBackend() === "postgres"
    ? await getGateMatrixReview(project.id, null, gate.id)
    : null;
  if (getOperationalDataBackend() === "postgres" && !matrixReview) notFound();
  const applicabilityReview = gate.stageId === "initiation" && getOperationalDataBackend() === "postgres"
    ? await getApplicabilityReview(project.id, null)
    : null;
  const applicabilityGate = applicabilityReview?.gates.find(
    (entry) => entry.gate.id === gate.id,
  );
  const readinessGate = applicabilityGate?.gate ?? gate;
  const deliverables = applicabilityGate?.deliverables
    ?? await getGateDeliverables(project.id, null, readinessGate.id);
  const applicabilityEntryDeliverable = deliverables.find(
    (deliverable) => deliverable.templateId === "project_stage_gate_applicability_matrix",
  );
  const actionView = await getAuthorizedGateActionView({
    user: access.user,
    projectId: project.id,
    packageId: null,
    gateId: readinessGate.id,
    legacyPermission: access.role === "viewer" ? "read" : "read_write",
  });
  const canReadActions = accessPermissionAllows(actionView.permission, "read");
  const canWriteActions = accessPermissionAllows(actionView.permission, "read_write");
  const gateActions = actionView.actions;
  const submissionIssues = [
    ...getGateSubmissionIssues(
      readinessGate,
      deliverables,
      gateActions,
      applicabilityReview ? {
        scopeLabel: "Project",
        items: applicabilityReview.gates.flatMap((entry) => entry.deliverables),
      } : undefined,
    ),
    ...(matrixReview ? getMatrixReviewSubmissionIssues(matrixReview.state) : []),
  ];
  const awaitingCycle = getAwaitingGateReviewCycle(readinessGate);
  const activeIdentityLinkCandidates = getOperationalDataBackend() === "postgres"
    && access.role === "owner" && awaitingCycle
    ? await getActiveGateReviewIdentityLinkCandidates({
        projectId: project.id,
        packageId: null,
        gateId: readinessGate.id,
        reviewCycleId: awaitingCycle.id,
      })
    : [];
  const submittedCycleNumber = parseCycleNumber(query.submitted);
  const currentStageIndex = project.gates.findIndex(
    (candidate) => candidate.stageId === project.currentStage,
  );
  const currentStageGate = project.gates[currentStageIndex];
  const canReopenGate = access.role === "owner"
    && project.gates[currentStageIndex - 1]?.id === gate.id
    && (gate.status === "approved" || gate.status === "approved_with_actions")
    && !project.gates.some((candidate) => candidate.reapprovalRequired)
    && currentStageGate?.status !== "submitted_for_approval"
    && currentStageGate?.status !== "approved"
    && currentStageGate?.status !== "approved_with_actions";

  return (
    <GateDetail
      backHref={`/projects/${project.id}`}
      backLabel="Current project"
      contextLabel={`${project.projectNumber} - ${project.name}`}
      applicabilityHref={`/projects/${project.id}/applicability`}
      applicabilityEntryDeliverableId={applicabilityEntryDeliverable?.id}
      actionRegisterHref={`/projects/${project.id}/actions`}
      approvalError={parseQueryValue(query.approvalError)}
      canManageGateReviews={access.role !== "viewer"}
      canReadGateReviews
      canReadDeliverables
      canEditDeliverables={access.role !== "viewer"}
      canReadActions={canReadActions}
      canWriteActions={canWriteActions}
      canManageActiveIdentityLinks={access.role === "owner"}
      canWithdrawSubmission={access.role === "owner"}
      canRetryInvitations={access.role !== "viewer"}
      canReopenGate={canReopenGate}
      activeIdentityLinkCandidates={activeIdentityLinkCandidates}
      invitationFailureCount={parsePositiveInteger(query.invitationFailures)}
      approvalResponseAction={respondToProjectGateReviewAction.bind(
        null,
        project.id,
        gate.id,
      )}
      createApproverAction={createProjectGateApproverAction.bind(null, project.id, gate.id)}
      confirmMatrixReviewAction={confirmProjectGateMatrixReviewAction.bind(
        null,
        project.id,
        gate.id,
      )}
      createGateActionAction={createProjectGateActionAction.bind(null, project.id, gate.id)}
      deleteApproverAction={deleteProjectGateApproverAction.bind(null, project.id, gate.id)}
      deliverables={deliverables}
      gate={readinessGate}
      gateActions={gateActions}
      gateActionPackageId={null}
      isCurrentGate={gate.stageId === project.currentStage}
      matrixReview={matrixReview?.state ?? null}
      packages={packages.map((projectPackage) => ({
        id: projectPackage.id,
        label: `${projectPackage.packageCode} - ${projectPackage.packageName}`,
      }))}
      reopenAction={reopenProjectGateAction.bind(null, project.id, gate.id)}
      retryInvitationAction={retryProjectGateReviewInvitationAction.bind(
        null,
        project.id,
        gate.id,
      )}
      linkActiveIdentityAction={linkActiveGateReviewApproverUserAction.bind(
        null,
        project.id,
        null,
        gate.id,
      )}
      scopeLabel="Project"
      stageLabel={projectStageLabels[gate.stageId]}
      submissionAction={submitProjectGateForApprovalAction.bind(null, project.id, gate.id)}
      submissionError={parseQueryValue(query.submissionError)}
      submissionIssues={submissionIssues}
      submittedCycleNumber={submittedCycleNumber}
      selectedReviewCycleId={parseQueryValue(query.reviewCycle)}
      updateApproverAction={updateProjectGateApproverAction.bind(null, project.id, gate.id)}
      updateDeliverableAction={updateProjectDeliverableAction.bind(null, project.id, gate.id)}
      withdrawSubmissionAction={withdrawProjectGateSubmissionAction.bind(null, project.id, gate.id)}
    />
  );
}

function parseCycleNumber(value: string | string[] | undefined) {
  const cycleNumber = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(cycleNumber) && cycleNumber > 0 ? cycleNumber : undefined;
}

function parsePositiveInteger(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
