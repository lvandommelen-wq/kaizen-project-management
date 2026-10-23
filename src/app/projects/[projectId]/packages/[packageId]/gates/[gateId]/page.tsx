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
import { packageStageLabels } from "@/lib/packages";
import { requireInternalUser } from "@/lib/authorization";
import { getAuthorizedGateActionView } from "@/lib/action-register";
import { accessPermissionAllows } from "@/lib/access-permissions";
import { getAuthorizedPackageContext } from "@/lib/package-access";
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
  const user = await requireInternalUser();
  const context = await getAuthorizedPackageContext({
    user,
    projectId,
    packageId,
    module: "gate_reviews",
  }) ?? await getAuthorizedPackageContext({
    user,
    projectId,
    packageId,
    module: "deliverables",
  });
  if (!context) notFound();
  const { project, projectPackage, permissions, governanceAuthority, projectRole } = context;
  const gate = projectPackage?.gates.find((gate) => gate.id === resolvedGateId);

  if (!projectPackage || !gate) {
    notFound();
  }

  const canReadGateReviews = accessPermissionAllows(permissions.gate_reviews, "read");
  const canManageGateReviews = accessPermissionAllows(permissions.gate_reviews, "read_write");
  const canReadOverview = accessPermissionAllows(permissions.overview, "read");
  const canReadDeliverables = accessPermissionAllows(permissions.deliverables, "read");
  const canEditDeliverables = accessPermissionAllows(permissions.deliverables, "read_write");
  const matrixReview = canReadGateReviews && getOperationalDataBackend() === "postgres"
    ? await getGateMatrixReview(project.id, projectPackage.id, gate.id)
    : null;
  if (canReadGateReviews && getOperationalDataBackend() === "postgres" && !matrixReview) notFound();

  const shouldLoadDeliverables = canReadDeliverables || canManageGateReviews;
  const applicabilityReview = shouldLoadDeliverables
    && gate.stageId === "definition" && getOperationalDataBackend() === "postgres"
    ? await getApplicabilityReview(project.id, projectPackage.id)
    : null;
  const applicabilityGate = applicabilityReview?.gates.find(
    (entry) => entry.gate.id === gate.id,
  );
  const readinessGate = applicabilityGate?.gate ?? gate;
  const deliverables = shouldLoadDeliverables
    ? applicabilityGate?.deliverables
      ?? await getGateDeliverables(project.id, projectPackage.id, readinessGate.id)
    : [];
  const applicabilityEntryDeliverable = deliverables.find(
    (deliverable) => deliverable.templateId === "package_stage_gate_applicability_matrix",
  );
  const actionView = await getAuthorizedGateActionView({
    user,
    projectId: project.id,
    packageId: projectPackage.id,
    gateId: readinessGate.id,
    legacyPermission: permissions.actions ?? "read",
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
        scopeLabel: "Package",
        items: applicabilityReview.gates.flatMap((entry) => entry.deliverables),
      } : undefined,
    ),
    ...(matrixReview ? getMatrixReviewSubmissionIssues(matrixReview.state) : []),
  ];
  const awaitingCycle = getAwaitingGateReviewCycle(readinessGate);
  const activeIdentityLinkCandidates = getOperationalDataBackend() === "postgres"
    && projectRole === "owner" && awaitingCycle
    ? await getActiveGateReviewIdentityLinkCandidates({
        projectId: project.id,
        packageId: projectPackage.id,
        gateId: readinessGate.id,
        reviewCycleId: awaitingCycle.id,
      })
    : [];
  const submittedCycleNumber = parseCycleNumber(query.submitted);
  const currentStageIndex = projectPackage.gates.findIndex(
    (candidate) => candidate.stageId === projectPackage.currentStage,
  );
  const currentStageGate = projectPackage.gates[currentStageIndex];
  const canReopenGate = governanceAuthority !== null
    && canManageGateReviews
    && projectPackage.gates[currentStageIndex - 1]?.id === gate.id
    && (gate.status === "approved" || gate.status === "approved_with_actions")
    && !projectPackage.gates.some((candidate) => candidate.reapprovalRequired)
    && currentStageGate?.status !== "submitted_for_approval"
    && currentStageGate?.status !== "approved"
    && currentStageGate?.status !== "approved_with_actions";

  return (
    <GateDetail
      backHref={canReadOverview
        ? `/projects/${project.id}/packages/${projectPackage.id}`
        : canReadDeliverables
          ? `/projects/${project.id}/packages/${projectPackage.id}/applicability`
          : "/projects"}
      backLabel={canReadOverview
        ? "Current package"
        : canReadDeliverables
          ? "Deliverables"
          : "All projects"}
      contextLabel={`${projectPackage.packageCode} - ${projectPackage.packageName}`}
      applicabilityHref={`/projects/${project.id}/packages/${projectPackage.id}/applicability`}
      applicabilityEntryDeliverableId={applicabilityEntryDeliverable?.id}
      actionRegisterHref={`/projects/${project.id}/packages/${projectPackage.id}/actions`}
      approvalError={parseQueryValue(query.approvalError)}
      canManageGateReviews={canManageGateReviews}
      canReadGateReviews={canReadGateReviews}
      canReadDeliverables={canReadDeliverables}
      canEditDeliverables={canEditDeliverables}
      canReadActions={canReadActions}
      canWriteActions={canWriteActions}
      canManageActiveIdentityLinks={projectRole === "owner"}
      canWithdrawSubmission={governanceAuthority !== null}
      canRetryInvitations={canManageGateReviews}
      canReopenGate={canReopenGate}
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
      deliverables={canReadDeliverables ? deliverables : []}
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
