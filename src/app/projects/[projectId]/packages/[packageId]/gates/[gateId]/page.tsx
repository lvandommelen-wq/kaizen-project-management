import { notFound } from "next/navigation";
import { GateDetail } from "@/app/projects/_components/gate-detail";
import {
  createPackageGateActionAction,
  createPackageGateApproverAction,
  confirmPackageGateMatrixReviewAction,
  deletePackageGateApproverAction,
  linkActiveGateReviewApproverUserAction,
  reopenPackageGateAction,
  respondToPackageGateReviewAction,
  retryPackageGateReviewInvitationAction,
  submitPackageGateForApprovalAction,
  updatePackageDeliverableAction,
  updatePackageGateApproverAction,
  withdrawPackageGateSubmissionAction,
} from "@/app/projects/gate-actions";
import { getGateDeliverables } from "@/lib/deliverables";
import { getPackage, packageStageLabels } from "@/lib/packages";
import { getGateActions } from "@/lib/project-actions";
import { getProject } from "@/lib/projects";
import { getCurrentProjectRole } from "@/lib/authorization";
import { getActiveGateReviewIdentityLinkCandidates } from "@/lib/operational/postgres";
import { getAwaitingGateReviewCycle, getGateSubmissionIssues } from "@/lib/gates";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import { getApplicabilityReview, getGateMatrixReview } from "@/lib/applicability";
import { getMatrixReviewSubmissionIssues } from "@/lib/matrix-reviews";

export const dynamic = "force-dynamic";

export default async function PackageGatePage({
  params,
  searchParams,
}: PageProps<"/projects/[projectId]/packages/[packageId]/gates/[gateId]">) {
  const { projectId, packageId, gateId } = await params;
  const query = await searchParams;
  const resolvedGateId = decodeURIComponent(gateId);
  const access = await getCurrentProjectRole(projectId);
  if (!access) notFound();
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const projectPackage = await getPackage(project.id, packageId);
  const gate = projectPackage?.gates.find((gate) => gate.id === resolvedGateId);

  if (!projectPackage || !gate) {
    notFound();
  }

  const matrixReview = getOperationalDataBackend() === "postgres"
    ? await getGateMatrixReview(project.id, projectPackage.id, gate.id)
    : null;
  if (getOperationalDataBackend() === "postgres" && !matrixReview) notFound();

  const applicabilityReview = gate.stageId === "definition" && getOperationalDataBackend() === "postgres"
    ? await getApplicabilityReview(project.id, projectPackage.id)
    : null;
  const applicabilityGate = applicabilityReview?.gates.find(
    (entry) => entry.gate.id === gate.id,
  );
  const readinessGate = applicabilityGate?.gate ?? gate;
  const deliverables = applicabilityGate?.deliverables
    ?? await getGateDeliverables(project.id, projectPackage.id, readinessGate.id);
  const applicabilityEntryDeliverable = deliverables.find(
    (deliverable) => deliverable.templateId === "package_stage_gate_applicability_matrix",
  );
  const gateActions = await getGateActions(project.id, readinessGate.id);
  const submissionIssues = [
    ...getGateSubmissionIssues(
      readinessGate,
      deliverables,
      gateActions,
      applicabilityReview ? {
        scopeLabel: "Package",
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
        packageId: projectPackage.id,
        gateId: readinessGate.id,
        reviewCycleId: awaitingCycle.id,
      })
    : [];
  const submittedCycleNumber = parseCycleNumber(query.submitted);

  return (
    <GateDetail
      backHref={`/projects/${project.id}/packages/${projectPackage.id}`}
      backLabel="Package"
      contextLabel={`${projectPackage.packageCode} - ${projectPackage.packageName}`}
      applicabilityHref={`/projects/${project.id}/packages/${projectPackage.id}/applicability`}
      applicabilityEntryDeliverableId={applicabilityEntryDeliverable?.id}
      actionRegisterHref={`/projects/${project.id}/actions?packageId=${encodeURIComponent(projectPackage.id)}`}
      approvalError={parseQueryValue(query.approvalError)}
      canEdit={access.role !== "viewer"}
      canManageActiveIdentityLinks={access.role === "owner"}
      canWithdrawSubmission={access.role === "owner"}
      activeIdentityLinkCandidates={activeIdentityLinkCandidates}
      invitationFailureCount={parsePositiveInteger(query.invitationFailures)}
      approvalResponseAction={respondToPackageGateReviewAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      createApproverAction={createPackageGateApproverAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      confirmMatrixReviewAction={confirmPackageGateMatrixReviewAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      createGateActionAction={createPackageGateActionAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      deleteApproverAction={deletePackageGateApproverAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      deliverables={deliverables}
      gate={readinessGate}
      gateActions={gateActions}
      gateActionPackageId={projectPackage.id}
      isCurrentGate={gate.stageId === projectPackage.currentStage}
      matrixReview={matrixReview?.state ?? null}
      packages={[{
        id: projectPackage.id,
        label: `${projectPackage.packageCode} - ${projectPackage.packageName}`,
      }]}
      reopenAction={reopenPackageGateAction.bind(null, project.id, projectPackage.id, gate.id)}
      retryInvitationAction={retryPackageGateReviewInvitationAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      linkActiveIdentityAction={linkActiveGateReviewApproverUserAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      scopeLabel="Package"
      stageLabel={packageStageLabels[gate.stageId]}
      submissionAction={submitPackageGateForApprovalAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      submissionError={parseQueryValue(query.submissionError)}
      submissionIssues={submissionIssues}
      submittedCycleNumber={submittedCycleNumber}
      selectedReviewCycleId={parseQueryValue(query.reviewCycle)}
      updateApproverAction={updatePackageGateApproverAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      updateDeliverableAction={updatePackageDeliverableAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      withdrawSubmissionAction={withdrawPackageGateSubmissionAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
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
