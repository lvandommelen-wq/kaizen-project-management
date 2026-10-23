import Link from "next/link";
import { ApproverForm } from "./approver-form";
import { ConfirmationAction } from "./confirmation-action";
import { GateApprovalTestPanel } from "./gate-approval-test-panel";
import {
  deliverableStatusLabels,
  deliverableStatuses,
  type Deliverable,
} from "@/lib/deliverables";
import {
  applicabilityLabels,
  gateReviewCycleStatusLabels,
  gateStatusLabels,
  canWithdrawGateReviewCycle,
  canRetryGateReviewInvitation,
  getAwaitingGateReviewCycle,
  getGateCriterionStatusLabel,
  getGateReviewApprovalState,
  isGateInPreparation,
  type Gate,
  type GateReviewCycle,
  type GateReviewInvitationAttemptStatus,
  type GateSubmissionIssue,
  type VerifiedApproverUser,
} from "@/lib/gates";
import {
  formatProjectActionId,
  projectActionPriorities,
  projectActionPriorityLabels,
  projectActionStatusLabels,
  type ProjectAction,
} from "@/lib/project-actions";
import {
  formatCalendarDate as formatDate,
  formatTimestamp as formatDateTime,
} from "@/lib/date-format";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import type { GateMatrixReviewState } from "@/lib/matrix-reviews";

type FormAction = (formData: FormData) => void | Promise<void>;
type ItemAction = (itemId: string) => void | Promise<void>;
type UpdateFormAction = (itemId: string, formData: FormData) => void | Promise<void>;
type RetryInvitationAction = (
  reviewCycleId: string,
  gateApproverId: string,
) => void | Promise<void>;
type LinkActiveIdentityAction = (
  reviewCycleId: string,
  gateApproverId: string,
  userId: string,
) => void | Promise<void>;

type GateDetailProps = {
  backHref: string;
  backLabel: string;
  contextLabel: string;
  applicabilityHref: string;
  applicabilityEntryDeliverableId?: string;
  createApproverAction: FormAction;
  confirmMatrixReviewAction: FormAction;
  createGateActionAction: FormAction;
  deleteApproverAction: ItemAction;
  deliverables: Deliverable[];
  gate: Gate;
  gateActions: ProjectAction[];
  gateActionPackageId: string | null;
  invitationFailureCount?: number;
  canEdit: boolean;
  canManageActiveIdentityLinks: boolean;
  canWithdrawSubmission: boolean;
  isCurrentGate: boolean;
  matrixReview: GateMatrixReviewState | null;
  packages: { id: string; label: string }[];
  actionRegisterHref: string;
  approvalError?: string;
  approvalResponseAction: FormAction;
  reopenAction: FormAction;
  retryInvitationAction: RetryInvitationAction;
  activeIdentityLinkCandidates: (VerifiedApproverUser & { gateApproverId: string })[];
  linkActiveIdentityAction: LinkActiveIdentityAction;
  scopeLabel: string;
  stageLabel: string;
  submissionAction: FormAction;
  submissionError?: string;
  submissionIssues: GateSubmissionIssue[];
  submittedCycleNumber?: number;
  selectedReviewCycleId?: string;
  updateApproverAction: UpdateFormAction;
  updateDeliverableAction: UpdateFormAction;
  withdrawSubmissionAction: FormAction;
};

export function GateDetail({
  backHref,
  backLabel,
  contextLabel,
  applicabilityHref,
  applicabilityEntryDeliverableId,
  createApproverAction,
  confirmMatrixReviewAction,
  createGateActionAction,
  deleteApproverAction,
  deliverables,
  gate,
  gateActions,
  gateActionPackageId,
  invitationFailureCount,
  canEdit,
  canManageActiveIdentityLinks,
  canWithdrawSubmission,
  isCurrentGate,
  matrixReview,
  packages,
  actionRegisterHref,
  approvalError,
  approvalResponseAction,
  reopenAction,
  retryInvitationAction,
  activeIdentityLinkCandidates,
  linkActiveIdentityAction,
  scopeLabel,
  stageLabel,
  submissionAction,
  submissionError,
  submissionIssues,
  submittedCycleNumber,
  selectedReviewCycleId,
  updateApproverAction,
  updateDeliverableAction,
  withdrawSubmissionAction,
}: GateDetailProps) {
  const openGateActions = gateActions.filter((action) => action.status !== "closed");
  const awaitingReviewCycle = getAwaitingGateReviewCycle(gate);
  const awaitingApprovalState = awaitingReviewCycle
    ? getGateReviewApprovalState(awaitingReviewCycle)
    : null;
  const canPrepare = canEdit && isGateInPreparation(gate);
  const canConfigureApprovers = canPrepare;
  const canAddGateAction = isCurrentGate && canPrepare;
  const canSubmit = isCurrentGate && canPrepare && submissionIssues.length === 0;
  const approversByLevel = groupApproversByLevel(gate.approvers);
  const approvalStatus = getApprovalStatus(gate);
  const gateActionFollowUp = openGateActions.length > 0
    ? `${openGateActions.length} Gate Action${openGateActions.length === 1 ? "" : "s"} Open`
    : gateActions.length > 0
      ? "All Gate Actions Closed"
      : "No Gate Actions";
  const orderedDeliverables = [...deliverables].sort(
    (left, right) => deliverableStatusPriority(left.status) - deliverableStatusPriority(right.status),
  );
  const completedDeliverableCount = deliverables.filter(
    (deliverable) => deliverable.applicability === "applicable" && deliverable.status === "completed",
  ).length;
  const notApplicableDeliverableCount = deliverables.filter(
    (deliverable) => deliverable.applicability === "not_applicable",
  ).length;
  const applicableDeliverableCount = deliverables.filter((deliverable) => deliverable.applicability === "applicable").length;
  const remainingDeliverableCount = applicableDeliverableCount - completedDeliverableCount;

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{contextLabel}</p>
          <h1>{gate.name}</h1>
        </div>
        <Link href={backHref} className="button-secondary">
          {backLabel}
        </Link>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Scope level" value={scopeLabel} />
        <SummaryCard label="Stage" value={stageLabel} />
        <SummaryCard label="Gate status" value={gateStatusLabels[gate.status]} valueClassName={gateStatusClass(gate.status)} />
        <SummaryCard
          label="Approval status"
          value={approvalStatus.value}
          detail={approvalStatus.detail}
          valueClassName={approvalStatus.valueClassName}
        />
      </section>

      {invitationFailureCount ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          The Gate workflow update was saved, but {invitationFailureCount} approval invitation{invitationFailureCount === 1 ? "" : "s"} could not be confirmed. Review the delivery details in Review History.
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Approvers</h2>
          <p className="mt-1 text-sm text-slate-600">
            People assigned to approve this Gate. Approval Role is specific to this Gate and remains separate from
            the person&apos;s Role / Function.
          </p>
        </div>

        {!canConfigureApprovers ? (
          <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {awaitingReviewCycle
              ? "Approver configuration is read-only while the Review Cycle is submitted for approval."
              : "Approver configuration is read-only because this Gate has a formal decision. Reopen the Gate to change its Approvers under the current workflow."}
          </p>
        ) : null}

        {gate.approvers.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No Approvers have been configured for this Gate.
          </p>
        ) : (
          <div className="mt-5 space-y-5">
            {approversByLevel.map(({ approvalLevel, approvers }) => (
              <div key={approvalLevel} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-950">Approval Level {approvalLevel}</h3>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {approvers.length} Approver{approvers.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {approvers.map((approver) => (
                    <article key={approver.id} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval Role</p>
                        <h3 className="mt-1 font-semibold text-slate-950">{approver.approvalRole}</h3>
                        <p className="mt-2 text-sm font-medium text-slate-900">{approver.name}</p>
                        <p className="text-sm text-slate-600">{approver.roleFunction}</p>
                        <a
                          className="text-sm text-slate-600 underline-offset-2 hover:underline"
                          href={`mailto:${approver.email}`}
                        >
                          {approver.email}
                        </a>
                        {approver.organizationName ? <p className="text-sm text-slate-600">{approver.organizationName}</p> : null}
                      </div>

                      {canConfigureApprovers ? (
                        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-3">
                          <details className="min-w-0 flex-1">
                            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                              Edit Approver
                            </summary>
                            <ApproverForm
                              action={updateApproverAction.bind(null, approver.id)}
                              approver={approver}
                              submitLabel="Save Approver"
                            />
                          </details>
                          <ConfirmationAction
                            action={deleteApproverAction.bind(null, approver.id)}
                            buttonLabel="Remove Approver"
                            confirmLabel="Remove Approver"
                            message={`Remove ${approver.name} as ${approver.approvalRole} from this Gate?`}
                            title="Remove Approver"
                          />
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {canConfigureApprovers ? (
          <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Add Approver</summary>
            <ApproverForm action={createApproverAction} submitLabel="Add Approver" />
          </details>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Gate Submission</h2>
          <p className="mt-1 text-sm text-slate-600">
            Submit the prepared Gate for formal approval. Submission freezes the Review Cycle but does not approve
            the Gate or advance the Stage.
          </p>
        </div>

        {submissionError ? (
          <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            {submissionErrorMessage(submissionError)}
          </p>
        ) : null}

        {awaitingReviewCycle ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Review Cycle {awaitingReviewCycle.cycleNumber}
              {submittedCycleNumber === awaitingReviewCycle.cycleNumber ? " was" : " is"} submitted for approval.
              The Gate Status is Submitted for Approval, and the {scopeLabel} Stage remains {stageLabel}.
            </p>
            {canWithdrawSubmission && canWithdrawGateReviewCycle(awaitingReviewCycle) ? (
              <ConfirmationAction
                action={withdrawSubmissionAction}
                buttonLabel="Withdraw Submission"
                confirmLabel="Withdraw Submission"
                message={`Withdraw Review Cycle ${awaitingReviewCycle.cycleNumber} from approval? Its frozen evidence, invitations, and all previous responses will remain as historical records, but those approvals will no longer count toward Stage progression. The Gate will become editable and resubmission will create a new Review Cycle.`}
                title="Withdraw Submission"
                textArea={{
                  label: "Withdrawal reason (required)",
                  name: "withdrawalReason",
                  required: true,
                }}
              />
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Only a Project Owner may withdraw an active Review Cycle. Withdrawal is unavailable after final Gate approval and Stage progression.
              </p>
            )}
            {approvalError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                {approvalErrorMessage(approvalError)}
              </p>
            ) : null}
            {process.env.NODE_ENV === "development" &&
            getOperationalDataBackend() === "json" &&
            awaitingApprovalState &&
            awaitingApprovalState.eligibleApprovers.length > 0 ? (
              <GateApprovalTestPanel
                key={`${awaitingReviewCycle.id}:${awaitingApprovalState.eligibleApprovers.map((approver) => approver.gateApproverId).join(",")}`}
                acceptedActionCount={awaitingReviewCycle.frozenEvidence.acceptedActions.filter(
                  (action) => action.status !== "closed",
                ).length}
                action={approvalResponseAction}
                approvers={awaitingApprovalState.eligibleApprovers}
                reviewCycleId={awaitingReviewCycle.id}
                reviewCycleNumber={awaitingReviewCycle.cycleNumber}
              />
            ) : null}
          </div>
        ) : gate.status === "approved" || gate.status === "approved_with_actions" ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              This Gate has a formal decision. Reopen it before making another decision. Reopening preserves
              Deliverables, Actions, and the current lifecycle Stage.
            </p>
            {canEdit ? <ConfirmationAction
              action={reopenAction}
              buttonLabel="Reopen Gate"
              confirmLabel="Reopen Gate"
              message="This resets the Gate decision to Not Submitted. It does not change the current Stage or remove existing Gate information."
              title="Reopen Gate"
            /> : null}
          </div>
        ) : isCurrentGate && canPrepare ? (
          <div className="mt-5 space-y-5">
            {gate.status === "returned_for_rework" ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                The latest Review Cycle was returned for rework. Update the Gate preparation and resubmit it when ready.
              </p>
            ) : null}

            {matrixReview ? (
              <MatrixReviewCard
                action={confirmMatrixReviewAction}
                applicabilityHref={applicabilityHref}
                state={matrixReview}
              />
            ) : null}

            {submissionIssues.length === 0 ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                The Gate is sufficiently configured for formal submission.
              </p>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-950">Submission requirements</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                  {submissionIssues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
                </ul>
                {submissionIssues.some((issue) =>
                  issue.code === "missing_applicability_justification") ? (
                  <Link
                    href={applicabilityHref}
                    className="mt-3 inline-block text-sm font-semibold text-amber-950 underline underline-offset-2"
                  >
                    Open {scopeLabel} Applicability Review
                  </Link>
                ) : null}
              </div>
            )}

            {openGateActions.length > 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {openGateActions.length} open Gate Action{openGateActions.length === 1 ? "" : "s"} will be included
                in the frozen Review Cycle. Final approval may conclude with Approved with Actions.
              </p>
            ) : null}

            <form action={submissionAction}>
              <button
                type="submit"
                disabled={!canSubmit}
                className="button-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit for Approval
              </button>
            </form>
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            This Gate can be prepared, but it can only be submitted when its related Stage is current.
          </p>
        )}
      </section>

      <ReviewHistory
        actionRegisterHref={actionRegisterHref}
        activeIdentityLinkCandidates={activeIdentityLinkCandidates}
        canManageActiveIdentityLinks={canManageActiveIdentityLinks}
        cycles={gate.reviewCycles}
        gateActions={gateActions}
        linkActiveIdentityAction={linkActiveIdentityAction}
        retryInvitationAction={retryInvitationAction}
        selectedReviewCycleId={selectedReviewCycleId}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Gate Actions</h2>
            <p className="mt-1 text-sm text-slate-600">
              Explicitly accepted non-blocking work recorded in the Project Master Action Register.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className={`status-pill ${openGateActions.length > 0 ? "status-amber" : "status-not_assessed"}`}>
              {gateActionFollowUp}
            </span>
            <Link href={actionRegisterHref} className="button-secondary">Master Action Register</Link>
          </div>
        </div>

        {gateActions.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No Actions have been created from this Gate.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {gateActions.map((action) => (
              <article key={action.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs font-semibold text-slate-500">
                      {formatProjectActionId(action.sequence)}
                    </span>
                    <p className="mt-1 text-sm font-semibold text-slate-950">{action.description}</p>
                    <p className="mt-1 text-sm text-slate-600">
                       Assignee: {action.assignee} | Due: {formatDate(action.dueDate)}
                    </p>
                  </div>
                   <span className={`status-pill ${action.status === "closed" ? "status-green" : "status-amber"}`}>
                    {projectActionStatusLabels[action.status]}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {canAddGateAction ? (
          <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Add Gate Action</summary>
            <GateActionForm
              action={createGateActionAction}
              fixedPackageId={gateActionPackageId}
              packages={packages}
            />
          </details>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Stage Deliverables</h2>
            <p className="mt-1 text-sm text-slate-600">
              Deliverables are governance records, not files. Documents can be linked in a later iteration.
            </p>
          </div>
          {deliverables.length > 0 ? (
            <p className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">
              {completedDeliverableCount} / {applicableDeliverableCount} completed
              <span aria-hidden="true"> &middot; </span>
              {remainingDeliverableCount} remaining
              {notApplicableDeliverableCount > 0 ? (
                <>
                  <span aria-hidden="true"> &middot; </span>
                  {notApplicableDeliverableCount} not applicable
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        {deliverables.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No Stage Deliverables are associated with this Gate.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {orderedDeliverables.map((deliverable) => {
              const isApplicabilityEntry = deliverable.id === applicabilityEntryDeliverableId;

              return (
                <details
                  key={deliverable.id}
                  className={`overflow-hidden rounded-lg border ${deliverableContainerClass(deliverable.status)}`}
                >
                  <summary className="cursor-pointer px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900">
                    <div className="ml-1 flex flex-wrap items-center justify-between gap-3">
                       <h3 className={`min-w-0 flex-1 text-sm font-semibold ${deliverable.applicability !== "applicable" ? "text-slate-600" : "text-slate-950"}`}>
                         {isApplicabilityEntry ? (
                           <Link href={applicabilityHref} className="text-blue-700 underline-offset-2 hover:underline">
                             {deliverable.title}
                           </Link>
                         ) : deliverable.title}
                       </h3>
                      <span className={`status-pill shrink-0 ${deliverableStatusClass(deliverable.status)}`}>
                         {deliverable.applicability === "applicable" ? deliverableStatusLabels[deliverable.status] : applicabilityLabels[deliverable.applicability]}
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-black/5 px-4 pb-4 pt-3">
                    <p className="text-xs font-semibold text-slate-500">
                      {deliverable.templateId ? "Default Deliverable" : "Custom Deliverable"}
                    </p>
                     {deliverable.applicability === "not_applicable" ? <p className="mt-2 text-sm text-slate-600">Justification: {deliverable.applicabilityJustification || "Legacy decision — no historical justification recorded."}</p> : null}
                    <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                      <Detail label="Related stage" value={stageLabel} />
                      <Detail label="Scope level" value={scopeLabel} />
                    </dl>
                    {canPrepare && deliverable.applicability === "applicable" ? (
                      <DeliverableForm
                        action={updateDeliverableAction.bind(null, deliverable.id)}
                        deliverable={deliverable}
                        stageLabel={stageLabel}
                        submitLabel="Save Deliverable"
                      />
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}

      </section>
    </div>
  );
}

function MatrixReviewCard({
  action,
  applicabilityHref,
  state,
}: {
  action: FormAction;
  applicabilityHref: string;
  state: GateMatrixReviewState;
}) {
  const isFinal = state.target.reviewScope === "final_lifecycle";
  const focusedHref = state.target.targetStageId
    ? `${applicabilityHref}?stage=${encodeURIComponent(state.target.targetStageId)}`
    : `${applicabilityHref}?review=final_lifecycle`;
  const statusLabel = state.effectiveStatus === "confirmed"
    ? "Confirmed"
    : state.effectiveStatus === "outdated"
      ? "Review outdated"
      : "Confirmation required";
  const statusClass = state.effectiveStatus === "confirmed"
    ? "status-green"
    : "status-amber";

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            {isFinal ? "Final Applicability Matrix Review" : "Next Stage Deliverables Review"}
          </h3>
          <p className="mt-1 text-sm text-slate-700">
            {isFinal ? "Reviewed scope" : "Next Stage"}: <strong>{state.target.targetStageLabel}</strong>
          </p>
        </div>
        <span className={`status-pill ${statusClass}`}>{statusLabel}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Detail label="Applicable Deliverables" value={String(state.applicableCount)} />
        <Detail label="Not Applicable Deliverables" value={String(state.notApplicableCount)} />
      </dl>
      {state.confirmation ? (
        <p className="mt-3 text-sm text-slate-600">
          {state.effectiveStatus === "outdated" ? "Previously confirmed" : "Confirmed"} {formatDateTime(state.confirmation.confirmedAt)} by {state.confirmation.reviewer.displayName}.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        Opening the matrix does not confirm the review. Confirmation records the current Deliverable configuration and applicability decisions.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href={focusedHref} className="button-secondary">
          {isFinal ? "Review Final Applicability Matrix" : "Review Next Stage Deliverables"}
        </Link>
        <form action={action}>
          <button type="submit" className="button-secondary">
            {isFinal ? "Confirm Final Applicability Matrix" : "Confirm Next Stage Deliverables"}
          </button>
        </form>
      </div>
    </section>
  );
}

function ReviewHistory({
  actionRegisterHref,
  activeIdentityLinkCandidates,
  canManageActiveIdentityLinks,
  cycles,
  gateActions,
  linkActiveIdentityAction,
  retryInvitationAction,
  selectedReviewCycleId,
}: {
  actionRegisterHref: string;
  activeIdentityLinkCandidates: (VerifiedApproverUser & { gateApproverId: string })[];
  canManageActiveIdentityLinks: boolean;
  cycles: GateReviewCycle[];
  gateActions: ProjectAction[];
  linkActiveIdentityAction: LinkActiveIdentityAction;
  retryInvitationAction: RetryInvitationAction;
  selectedReviewCycleId?: string;
}) {
  const orderedCycles = [...cycles].sort((left, right) => left.cycleNumber - right.cycleNumber);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Review History</h2>
        <p className="mt-1 text-sm text-slate-600">
          Submitted Review Cycles remain available as frozen governance records.
        </p>
      </div>

      {orderedCycles.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No formal Review Cycles have been submitted for this Gate.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {orderedCycles.map((cycle) => (
            <article
              key={cycle.id}
              id={`review-cycle-${cycle.id}`}
              className={`scroll-mt-6 rounded-lg border p-4 ${selectedReviewCycleId === cycle.id ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-100" : "border-slate-200"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">Review Cycle {cycle.cycleNumber}</h3>
                  <p className="mt-1 font-mono text-xs text-slate-500">{cycle.id}</p>
                  <p className="mt-2 text-sm text-slate-700">
                    Submitted {formatDateTime(cycle.submittedAt)} by {cycle.submittedBy.displayName}
                  </p>
                  {cycle.withdrawnAt && cycle.withdrawnBy ? (
                    <p className="mt-1 text-sm text-slate-700">
                      Withdrawn {formatDateTime(cycle.withdrawnAt)} by {cycle.withdrawnBy.displayName}
                    </p>
                  ) : null}
                  {cycle.withdrawalReason ? (
                    <p className="mt-1 text-sm text-slate-600">Withdrawal reason: {cycle.withdrawalReason}</p>
                  ) : null}
                  {cycle.completedAt && cycle.status !== "withdrawn" ? (
                    <p className="mt-1 text-sm text-slate-700">
                      Completed {formatDateTime(cycle.completedAt)} with {gateReviewCycleStatusLabels[cycle.status]}
                    </p>
                  ) : null}
                  {cycle.previousCycleId ? (
                    <p className="mt-1 text-xs text-slate-500">Follows Review Cycle ID {cycle.previousCycleId}</p>
                  ) : null}
                </div>
                <span className={`status-pill ${gateReviewCycleStatusClass(cycle.status)}`}>
                  {gateReviewCycleStatusLabels[cycle.status]}
                </span>
              </div>

              <details
                className="mt-4 border-t border-slate-100 pt-3"
                open={cycle.status === "awaiting_approval" || selectedReviewCycleId === cycle.id}
              >
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  View frozen Review Cycle
                </summary>
                <div className="mt-4 space-y-5">
                  {cycle.status === "withdrawn" ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      This Review Cycle was withdrawn. All responses below are retained as historical evidence but are no longer effective for Gate approval or Stage progression. They are not carried into a later Review Cycle.
                    </p>
                  ) : null}
                  <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <Detail label="Project" value={`${cycle.project.projectNumber} - ${cycle.project.name}`} />
                    <Detail
                      label="Package"
                      value={cycle.package ? `${cycle.package.packageCode} - ${cycle.package.name}` : "Project Gate"}
                    />
                    <Detail label="Gate" value={cycle.gate.name} />
                    <Detail label="Related Stage" value={cycle.gate.stageLabel} />
                  </dl>

                  <FrozenMatrixReviewEvidence cycle={cycle} />

                  {cycle.frozenEvidence.criteria.length > 0 ? (
                    <FrozenList
                      heading={`Legacy Gate Criteria (${cycle.frozenEvidence.criteria.length})`}
                      emptyLabel="No legacy Gate Criteria were included."
                      items={cycle.frozenEvidence.criteria.map((criterion) => ({
                        id: criterion.criterionId,
                        title: criterion.description,
                        detail: getGateCriterionStatusLabel(criterion.status),
                      }))}
                    />
                  ) : null}
                  <FrozenList
                    heading={`Deliverables (${cycle.frozenEvidence.deliverables.length})`}
                    emptyLabel="No Deliverables were included."
                    items={cycle.frozenEvidence.deliverables.map((deliverable) => ({
                      id: deliverable.deliverableId,
                      title: deliverable.title,
                       detail: deliverable.status === "not_applicable"
                         ? "Not Applicable"
                         : deliverableStatusLabels[deliverable.status],
                    }))}
                  />
                  <FollowUpActionList
                    actionRegisterHref={actionRegisterHref}
                    cycle={cycle}
                    gateActions={gateActions}
                  />

                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      Approvers ({cycle.approvers.length})
                    </h4>
                    <div className="mt-2 space-y-2">
                      {[...cycle.approvers]
                        .sort((left, right) => left.approvalLevel - right.approvalLevel)
                        .map((approver) => (
                          <div key={approver.gateApproverId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-slate-950">
                                  Level {approver.approvalLevel} - {approver.approvalRole}
                                </p>
                                 <p className="mt-1 text-slate-700">
                                   {approver.name} | {approver.roleFunction} | {approver.email}
                                 </p>
                                 {approver.authenticationMethod === "email_otp" ? (
                                   <p className="mt-1 text-xs font-semibold text-blue-700">Email OTP verification</p>
                                 ) : null}
                              </div>
                               <span className={`status-pill ${approverResponseStatusClass(approver.response?.outcome)}`}>
                                  {approver.response?.outcome === "approved"
                                    ? cycle.status === "withdrawn" ? "Historical Approval" : "Approved"
                                  : approver.response?.outcome === "returned_for_rework"
                                      ? cycle.status === "withdrawn" ? "Historical Rework Response" : "Returned for Rework"
                                     : cycle.status === "withdrawn" ? "No Response Before Withdrawal" : "Pending Response"}
                               </span>
                            </div>
                             {approver.response ? (
                               <p className="mt-2 text-slate-600">
                                 {cycle.status === "withdrawn" ? "Historical response: " : ""}{formatDateTime(approver.response.respondedAt)} by {approver.response.respondedBy.displayName}
                                 {approver.response.comment ? ` - ${approver.response.comment}` : ""}
                               </p>
                             ) : null}
                              {cycle.status === "awaiting_approval" && !approver.authenticationMethod && approver.response === null && !approver.assignedUserId && canManageActiveIdentityLinks ? (() => {
                               const candidate = activeIdentityLinkCandidates.find(
                                 (item) => item.gateApproverId === approver.gateApproverId,
                               );
                               return candidate ? (
                                 <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                   <p className="text-sm text-amber-950">
                                     Verified identity match: <strong>{candidate.displayName}</strong> ({candidate.email})
                                   </p>
                                   <form action={linkActiveIdentityAction.bind(null, cycle.id, approver.gateApproverId, candidate.id)} className="mt-2">
                                     <button type="submit" className="button-secondary">Link verified User</button>
                                   </form>
                                 </div>
                               ) : (
                                 <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                   No exact verified identity match is available. Withdraw and resubmit after correcting the live assignment.
                                 </p>
                               );
                             })() : null}
                            <InvitationDelivery
                              approver={approver}
                              canRetry={canRetryGateReviewInvitation(
                                cycle,
                                approver.gateApproverId,
                              )}
                              waitingForApprovalLevel={
                                cycle.status === "awaiting_approval" &&
                                approver.response === null &&
                                getGateReviewApprovalState(cycle).activeLevel !==
                                  approver.approvalLevel
                              }
                              retryAction={retryInvitationAction.bind(
                                null,
                                cycle.id,
                                approver.gateApproverId,
                              )}
                            />
                          </div>
                        ))}
                    </div>
                  </div>

                  {cycle.relatedReworkActionIds.length > 0 ? (
                    <p className="text-sm text-slate-700">
                      Related Rework Actions: {cycle.relatedReworkActionIds.join(", ")}
                    </p>
                  ) : null}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FrozenMatrixReviewEvidence({ cycle }: { cycle: GateReviewCycle }) {
  const confirmation = cycle.frozenEvidence.matrixReviewConfirmation;
  const matrix = cycle.frozenEvidence.applicabilityMatrix;
  if (!confirmation || !matrix) return null;
  const reviewedGates = confirmation.reviewScope === "final_lifecycle"
    ? matrix.gates
    : matrix.gates.filter((gate) => gate.stageId === confirmation.targetStageId);
  const items = reviewedGates.flatMap((gate) => gate.items.map((item) => ({
    id: `${gate.gateId}:${item.itemId}`,
    title: `${gate.stageLabel}: ${item.title}`,
    detail: `${applicabilityLabels[item.applicability === "to_be_determined" ? "applicable" : item.applicability]}${item.justification ? ` — Justification: ${item.justification}` : ""}`,
  })));

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h4 className="text-sm font-semibold text-blue-950">Applicability Matrix confirmation</h4>
      <p className="mt-1 text-sm text-blue-900">
        {confirmation.targetStageLabel} confirmed {formatDateTime(confirmation.confirmedAt)} by {confirmation.reviewer.displayName}.
      </p>
      <p className="mt-1 break-all text-xs text-blue-800">
        Fingerprint: {confirmation.matrixFingerprint}
      </p>
      <div className="mt-4">
        <FrozenList
          heading={`Reviewed Deliverables (${items.length})`}
          emptyLabel="No Deliverables were included in the reviewed matrix scope."
          items={items}
        />
      </div>
    </div>
  );
}

function InvitationDelivery({
  approver,
  canRetry,
  retryAction,
  waitingForApprovalLevel,
}: {
  approver: GateReviewCycle["approvers"][number];
  canRetry: boolean;
  retryAction: FormAction;
  waitingForApprovalLevel: boolean;
}) {
  if (!approver.invitation) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        {waitingForApprovalLevel
          ? "Invitation waiting for the preceding Approval Levels."
          : "No invitation delivery recorded."}
      </p>
    );
  }

  if (approver.invitation.attempts.length === 0) {
    return (
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600">
          Invitation activated {formatDateTime(approver.invitation.activatedAt)}; delivery is pending.
        </p>
        {canRetry ? <InvitationRetryForm action={retryAction} label="Send invitation" /> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Invitation delivery
      </p>
      <ul className="mt-2 space-y-2">
        {approver.invitation.attempts.map((attempt) => (
          <li key={attempt.id} className="rounded-md bg-white px-3 py-2 text-xs text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">
                {invitationAttemptStatusLabel(attempt.status)}
              </span>
              <span>{formatDateTime(attempt.completedAt ?? attempt.attemptedAt)}</span>
            </div>
            {attempt.providerMessageId ? (
              <p className="mt-1 break-all text-slate-500">
                Provider message ID: {attempt.providerMessageId}
              </p>
            ) : null}
            {attempt.error ? (
              <p className="mt-1 text-amber-900">
                {attempt.error.message} ({attempt.error.code})
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {canRetry ? (
        <div className="mt-3 flex justify-end">
          <InvitationRetryForm action={retryAction} label="Retry invitation" />
        </div>
      ) : null}
    </div>
  );
}

function InvitationRetryForm({
  action,
  label,
}: {
  action: FormAction;
  label: string;
}) {
  return (
    <form action={action}>
      <button type="submit" className="button-secondary">
        {label}
      </button>
    </form>
  );
}

function invitationAttemptStatusLabel(
  status: GateReviewInvitationAttemptStatus,
) {
  if (status === "sent") return "Invitation sent";
  if (status === "failed") return "Invitation failed";
  if (status === "indeterminate") return "Delivery unconfirmed";
  return "Sending invitation";
}

function FrozenList({
  heading,
  emptyLabel,
  items,
}: {
  heading: string;
  emptyLabel: string;
  items: { id: string; title: string; detail: string }[];
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-950">{heading}</h4>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{item.title}</p>
              <p className="mt-1 text-slate-600">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FollowUpActionList({
  actionRegisterHref,
  cycle,
  gateActions,
}: {
  actionRegisterHref: string;
  cycle: GateReviewCycle;
  gateActions: ProjectAction[];
}) {
  const items = cycle.frozenEvidence.acceptedActions.map((frozenAction) => {
    const liveAction = gateActions.find((action) => action.id === frozenAction.actionId);
    const decisionReference = liveAction?.gateDecisionReferences.find(
      (reference) => reference.reviewCycleId === cycle.id,
    );
    const approvalSnapshot = decisionReference?.approvalSnapshot;
    return {
      actionId: frozenAction.actionId,
      sequence: approvalSnapshot?.sequence ?? frozenAction.sequence,
      description: approvalSnapshot?.description ?? frozenAction.description,
      assignee: approvalSnapshot?.assignee ?? frozenAction.assignee,
      dueDate: approvalSnapshot?.dueDate ?? frozenAction.dueDate,
      frozenStatus: approvalSnapshot?.status ?? frozenAction.status,
      liveAction,
      hasApprovalSnapshot: Boolean(approvalSnapshot),
    };
  });

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-950">
        Gate Actions — Follow-up ({items.length})
      </h4>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No Gate follow-up Actions were included.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.actionId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {formatProjectActionId(item.sequence)} - {item.description}
                  </p>
                  <p className="mt-1 text-slate-600">
                    Frozen {item.hasApprovalSnapshot ? "at approval" : "Review evidence"}: {projectActionStatusLabels[item.frozenStatus]} | {item.assignee} | Due {formatDate(item.dueDate)}
                  </p>
                </div>
                {item.liveAction ? (
                  <Link
                    href={`${actionRegisterHref}#action-${encodeURIComponent(item.actionId)}`}
                    className="text-sm font-semibold text-blue-700 underline"
                  >
                    Open Action
                  </Link>
                ) : null}
              </div>
              {item.liveAction ? (
                <p className="mt-2 text-slate-700">
                  Current status: <strong>{projectActionStatusLabels[item.liveAction.status]}</strong>
                  {item.liveAction.closingDate
                    ? ` | Closed ${formatDate(item.liveAction.closingDate)}`
                    : ""}
                </p>
              ) : (
                <p className="mt-2 font-medium text-amber-800">
                  Live Action unavailable. Frozen historical evidence is retained.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function groupApproversByLevel<Approver extends { approvalLevel: number }>(approvers: Approver[]) {
  const groups = new Map<number, Approver[]>();

  for (const approver of approvers) {
    const group = groups.get(approver.approvalLevel) ?? [];
    group.push(approver);
    groups.set(approver.approvalLevel, group);
  }

  return [...groups.entries()]
    .sort(([leftLevel], [rightLevel]) => leftLevel - rightLevel)
    .map(([approvalLevel, groupedApprovers]) => ({
      approvalLevel,
      approvers: groupedApprovers,
    }));
}

function DeliverableForm({
  action,
  deliverable,
  stageLabel,
  submitLabel,
}: {
  action: FormAction;
  deliverable?: Deliverable;
  stageLabel: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Title
        <input
          name="title"
          required
          defaultValue={deliverable?.title}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Status
        <select
          name="status"
          defaultValue={deliverable?.status ?? "not_started"}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        >
          {deliverableStatuses.map((deliverableStatus) => (
            <option key={deliverableStatus} value={deliverableStatus}>
              {deliverableStatusLabels[deliverableStatus]}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        Related Stage: <span className="font-semibold text-slate-950">{stageLabel}</span>
      </div>
      <div className="flex justify-end md:col-span-2">
        <button type="submit" className="button-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function GateActionForm({
  action,
  fixedPackageId,
  packages,
}: {
  action: FormAction;
  fixedPackageId: string | null;
  packages: { id: string; label: string }[];
}) {
  const fixedPackage = fixedPackageId
    ? packages.find((projectPackage) => projectPackage.id === fixedPackageId)
    : null;

  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        Description
        <textarea
          name="description"
          required
          rows={3}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
         Assignee
         <input
           name="assignee"
           required
           className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm"
         />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Priority
        <select
          name="priority"
          defaultValue=""
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm"
        >
          <option value="">No priority</option>
          {projectActionPriorities.map((priority) => (
            <option key={priority} value={priority}>{projectActionPriorityLabels[priority]}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Due date
         <input
            type="date"
            name="dueDate"
            required
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm"
         />
      </label>
      {fixedPackageId ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 md:col-span-2">
          Related Package: <span className="font-semibold text-slate-950">{fixedPackage?.label ?? "Current Package"}</span>
        </div>
       ) : packages.length > 0 ? (
         <fieldset className="rounded-lg border border-slate-200 bg-white px-4 py-3 md:col-span-2">
           <legend className="px-1 text-sm font-medium text-slate-700">Scope</legend>
           <div className="mb-3 flex flex-wrap gap-5 text-sm text-slate-700">
             <label className="flex items-center gap-2">
               <input type="radio" name="scope" value="project" defaultChecked />
               Project-level
             </label>
             <label className="flex items-center gap-2">
               <input type="radio" name="scope" value="packages" />
               Package(s)
             </label>
           </div>
           <div className="grid gap-2 md:grid-cols-2">
            {packages.map((projectPackage) => (
              <label key={projectPackage.id} className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="packageIds"
                  value={projectPackage.id}
                  className="mt-1 size-4 accent-slate-900"
                />
                {projectPackage.label}
              </label>
            ))}
          </div>
        </fieldset>
       ) : (
         <input type="hidden" name="scope" value="project" />
       )}
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
         Logged by
         <input
           name="actorName"
           required
           className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm"
         />
       </label>
       <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
         Initial update (optional)
         <textarea
           name="initialUpdate"
          rows={3}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm"
        />
      </label>
      <div className="flex justify-end md:col-span-2">
        <button type="submit" className="button-primary">Add Gate Action</button>
      </div>
    </form>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  valueClassName = "text-slate-950",
}: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-3 text-lg font-semibold ${valueClassName}`}>{value}</div>
      {detail ? <div className="mt-1 text-sm font-medium text-slate-600">{detail}</div> : null}
    </div>
  );
}

function getApprovalStatus(gate: Gate) {
  const latestCycle = [...gate.reviewCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)[0];

  if (gate.status === "not_submitted") {
    return { value: "Not submitted", valueClassName: "text-slate-700" };
  }

  if (gate.status === "returned_for_rework") {
    return { value: "Returned for Rework", valueClassName: "text-red-700" };
  }

  const currentCycle = gate.status === "submitted_for_approval"
    ? getAwaitingGateReviewCycle(gate)
    : latestCycle;

  if (!currentCycle) {
    return gate.status === "approved" || gate.status === "approved_with_actions"
      ? { value: "Complete", valueClassName: "text-emerald-700" }
      : { value: "Approval configuration unavailable", valueClassName: "text-amber-700" };
  }

  const approvalState = getGateReviewApprovalState(currentCycle);
  const { approvedCount, totalCount } = approvalState;
  const isComplete = totalCount > 0 && approvedCount === totalCount;

  if (gate.status === "approved" || gate.status === "approved_with_actions") {
    return {
      value: isComplete ? `Complete — ${approvedCount} / ${totalCount} approved` : "Complete",
      valueClassName: "text-emerald-700",
    };
  }

  const returnedResponse = currentCycle.approvers.some(
    (approver) => approver.response?.outcome === "returned_for_rework",
  );
  if (currentCycle.status === "returned_for_rework" || returnedResponse) {
    return { value: "Returned for Rework", valueClassName: "text-red-700" };
  }

  if (
    currentCycle.status === "approved" ||
    currentCycle.status === "approved_with_actions" ||
    isComplete
  ) {
    return {
      value: isComplete ? `Complete — ${approvedCount} / ${totalCount} approved` : "Complete",
      valueClassName: "text-emerald-700",
    };
  }

  if (approvalState.activeLevel === null) {
    return { value: "Approval configuration unavailable", valueClassName: "text-amber-700" };
  }

  const activeLevelApprovers = currentCycle.approvers.filter(
    (approver) => approver.approvalLevel === approvalState.activeLevel,
  );
  const levelApprovedCount = activeLevelApprovers.filter(
    (approver) => approver.response?.outcome === "approved",
  ).length;

  return {
    value: `Level ${approvalState.activeLevel} — ${levelApprovedCount} / ${activeLevelApprovers.length} approved`,
    detail: new Set(currentCycle.approvers.map((approver) => approver.approvalLevel)).size > 1
      ? `${approvedCount} / ${totalCount} total approvals`
      : undefined,
    valueClassName: "text-amber-700",
  };
}

function approvalErrorMessage(error: string) {
  if (error === "already_responded") {
    return "This frozen Approver has already responded to the current Review Cycle.";
  }
  if (error === "not_eligible") {
    return "This Approver is not eligible yet. All Approvers at earlier Approval Levels must approve first.";
  }
  if (error === "comment_required") {
    return "A return reason is required when returning a Gate for rework.";
  }
  if (error === "accepted_actions_missing") {
    return "A Gate Action accepted in the frozen Review Cycle is missing from the Master Action Register. Return the Gate for rework and resubmit it before approval can complete.";
  }
  if (error === "review_cycle_mismatch") {
    return "This response was created for an earlier Review Cycle. Refresh the Gate and respond to the current cycle.";
  }
  if (error === "approver_not_found") {
    return "The selected Approver is not part of the current frozen Review Cycle.";
  }
  if (error === "not_current") {
    return "This Gate no longer belongs to the current Stage and cannot accept a response.";
  }
  return "This Review Cycle is no longer accepting approval responses.";
}

function submissionErrorMessage(error: string) {
  if (error === "blocked") {
    return "Submission was not completed because one or more Gate requirements remain unresolved. Review the requirements below and try again.";
  }
  if (error === "not_current") {
    return "Submission was not completed because this Gate no longer belongs to the current Stage. Refresh the Project or Package workflow before trying again.";
  }
  if (error === "not_in_preparation") {
    return "Submission was not completed because this Gate is no longer in preparation. It may already have an active Review Cycle or a formal decision.";
  }
  return "Submission could not be completed because of an unexpected server error. No new Review Cycle was created; please try again.";
}

function deliverableStatusPriority(status: Deliverable["status"]) {
  if (status === "not_started") return 0;
  if (status === "in_progress") return 1;
  if (status === "completed") return 2;
  return 3;
}

function deliverableContainerClass(status: Deliverable["status"]) {
  if (status === "not_started") return "border-amber-200 bg-amber-50/70";
  if (status === "in_progress") return "border-sky-200 bg-sky-50/70";
  if (status === "completed") return "border-emerald-200 bg-emerald-50/50";
  return "border-slate-200 bg-slate-50";
}

function deliverableStatusClass(status: Deliverable["status"]) {
  if (status === "not_started") return "status-amber";
  if (status === "in_progress") return "bg-sky-100 text-sky-800";
  if (status === "completed") return "status-green";
  return "status-not_assessed";
}

function gateStatusClass(status: Gate["status"]) {
  if (status === "approved") {
    return "text-emerald-700";
  }

  if (status === "approved_with_actions") {
    return "text-amber-700";
  }

  if (status === "submitted_for_approval") {
    return "text-amber-700";
  }

  if (status === "returned_for_rework") {
    return "text-red-700";
  }

  return "text-slate-950";
}

function gateReviewCycleStatusClass(status: GateReviewCycle["status"]) {
  if (status === "approved") {
    return "status-green";
  }

  if (status === "returned_for_rework") {
    return "status-red";
  }

  if (status === "withdrawn") {
    return "status-not_assessed";
  }

  return "status-amber";
}

function approverResponseStatusClass(outcome: "approved" | "returned_for_rework" | undefined) {
  if (outcome === "approved") return "status-green";
  if (outcome === "returned_for_rework") return "status-red";
  return "status-amber";
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{value}</dd>
    </div>
  );
}
