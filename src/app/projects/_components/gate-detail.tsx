import Link from "next/link";
import { ConfirmationAction } from "./confirmation-action";
import { GateApprovalTestPanel } from "./gate-approval-test-panel";
import {
  deliverableStatusLabels,
  deliverableStatuses,
  type Deliverable,
} from "@/lib/deliverables";
import {
  gateCriterionStatusLabels,
  gateCriterionStatuses,
  gateReviewCycleStatusLabels,
  gateStatusLabels,
  canWithdrawGateReviewCycle,
  getAwaitingGateReviewCycle,
  getGateCriterionStatusLabel,
  getGateReviewApprovalState,
  getGateSubmissionIssues,
  isGateInPreparation,
  type Gate,
  type GateReviewCycle,
} from "@/lib/gates";
import {
  formatProjectActionId,
  projectActionPriorities,
  projectActionPriorityLabels,
  projectActionStatusLabels,
  type ProjectAction,
} from "@/lib/project-actions";

type FormAction = (formData: FormData) => void | Promise<void>;
type ItemAction = (itemId: string) => void | Promise<void>;
type UpdateFormAction = (itemId: string, formData: FormData) => void | Promise<void>;

type GateDetailProps = {
  backHref: string;
  backLabel: string;
  contextLabel: string;
  createApproverAction: FormAction;
  createCriterionAction: FormAction;
  createDeliverableAction: FormAction;
  createGateActionAction: FormAction;
  deleteApproverAction: ItemAction;
  deleteCriterionAction: ItemAction;
  deleteDeliverableAction: ItemAction;
  deliverables: Deliverable[];
  gate: Gate;
  gateActions: ProjectAction[];
  gateActionPackageId: string | null;
  isCurrentGate: boolean;
  packages: { id: string; label: string }[];
  actionRegisterHref: string;
  approvalError?: string;
  approvalResponseAction: FormAction;
  reopenAction: FormAction;
  scopeLabel: string;
  stageLabel: string;
  submissionAction: FormAction;
  submittedCycleNumber?: number;
  updateApproverAction: UpdateFormAction;
  updateCriterionAction: UpdateFormAction;
  updateDeliverableAction: UpdateFormAction;
  withdrawSubmissionAction: FormAction;
};

export function GateDetail({
  backHref,
  backLabel,
  contextLabel,
  createApproverAction,
  createCriterionAction,
  createDeliverableAction,
  createGateActionAction,
  deleteApproverAction,
  deleteCriterionAction,
  deleteDeliverableAction,
  deliverables,
  gate,
  gateActions,
  gateActionPackageId,
  isCurrentGate,
  packages,
  actionRegisterHref,
  approvalError,
  approvalResponseAction,
  reopenAction,
  scopeLabel,
  stageLabel,
  submissionAction,
  submittedCycleNumber,
  updateApproverAction,
  updateCriterionAction,
  updateDeliverableAction,
  withdrawSubmissionAction,
}: GateDetailProps) {
  const openGateActions = gateActions.filter((action) => action.status !== "closed");
  const awaitingReviewCycle = getAwaitingGateReviewCycle(gate);
  const awaitingApprovalState = awaitingReviewCycle
    ? getGateReviewApprovalState(awaitingReviewCycle)
    : null;
  const canPrepare = isGateInPreparation(gate);
  const canConfigureApprovers = canPrepare;
  const canAddGateAction = isCurrentGate && canPrepare;
  const submissionIssues = getGateSubmissionIssues(gate, deliverables, gateActions);
  const canSubmit = isCurrentGate && canPrepare && submissionIssues.length === 0;
  const approversByLevel = groupApproversByLevel(gate.approvers);
  const approvalStatus = getApprovalStatus(gate);
  const gateActionFollowUp = openGateActions.length > 0
    ? `${openGateActions.length} Gate Action${openGateActions.length === 1 ? "" : "s"} Open`
    : gateActions.length > 0
      ? "All Gate Actions Closed"
      : "No Gate Actions";
  const orderedCriteria = [...gate.criteria].sort(
    (left, right) => gateCriterionStatusPriority(left.status) - gateCriterionStatusPriority(right.status),
  );
  const completedCriteriaCount = gate.criteria.filter((criterion) => criterion.status === "completed").length;
  const pendingCriteriaCount = gate.criteria.filter((criterion) => criterion.status === "pending").length;
  const notApplicableCriteriaCount = gate.criteria.filter(
    (criterion) => criterion.status === "not_applicable",
  ).length;
  const applicableCriteriaCount = gate.criteria.length - notApplicableCriteriaCount;
  const orderedDeliverables = [...deliverables].sort(
    (left, right) => deliverableStatusPriority(left.status) - deliverableStatusPriority(right.status),
  );
  const completedDeliverableCount = deliverables.filter(
    (deliverable) => deliverable.status === "completed",
  ).length;
  const notApplicableDeliverableCount = deliverables.filter(
    (deliverable) => deliverable.status === "not_applicable",
  ).length;
  const applicableDeliverableCount = deliverables.length - notApplicableDeliverableCount;
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

        {awaitingReviewCycle ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Review Cycle {awaitingReviewCycle.cycleNumber}
              {submittedCycleNumber === awaitingReviewCycle.cycleNumber ? " was" : " is"} submitted for approval.
              The Gate Status is Submitted for Approval, and the {scopeLabel} Stage remains {stageLabel}.
            </p>
            {canWithdrawGateReviewCycle(awaitingReviewCycle) ? (
              <ConfirmationAction
                action={withdrawSubmissionAction}
                buttonLabel="Withdraw Submission"
                confirmLabel="Withdraw Submission"
                message={`Withdraw Review Cycle ${awaitingReviewCycle.cycleNumber} from approval? The current Review Cycle will be preserved as Withdrawn, the Gate will become editable again, and a later resubmission will create a new Review Cycle.`}
                title="Withdraw Submission"
              />
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Withdrawal is unavailable because at least one Approver has submitted a formal response.
              </p>
            )}
            {approvalError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                {approvalErrorMessage(approvalError)}
              </p>
            ) : null}
            {process.env.NODE_ENV === "development" &&
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
              Criteria, Deliverables, Actions, and the current lifecycle Stage.
            </p>
            <ConfirmationAction
              action={reopenAction}
              buttonLabel="Reopen Gate"
              confirmLabel="Reopen Gate"
              message="This resets the Gate decision to Not Submitted. It does not change the current Stage or remove existing Gate information."
              title="Reopen Gate"
            />
          </div>
        ) : isCurrentGate && canPrepare ? (
          <div className="mt-5 space-y-5">
            {gate.status === "returned_for_rework" ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                The latest Review Cycle was returned for rework. Update the Gate preparation and resubmit it when ready.
              </p>
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

      <ReviewHistory cycles={gate.reviewCycles} />

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
            <h2 className="text-lg font-semibold text-slate-950">Gate Criteria</h2>
            <p className="mt-1 text-sm text-slate-600">
              Conditions assessed during Gate Review. Pending Criteria prevent normal approval.
            </p>
          </div>
          {gate.criteria.length > 0 ? (
            <p className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">
              {completedCriteriaCount} / {applicableCriteriaCount} completed
              <span aria-hidden="true"> &middot; </span>
              {pendingCriteriaCount} pending
              {notApplicableCriteriaCount > 0 ? (
                <>
                  <span aria-hidden="true"> &middot; </span>
                  {notApplicableCriteriaCount} not applicable
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        {gate.criteria.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No Gate Criteria have been added.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {orderedCriteria.map((criterion) => (
              <details
                key={criterion.id}
                open={criterion.status === "pending"}
                className={`overflow-hidden rounded-lg border ${gateCriterionContainerClass(criterion.status)}`}
              >
                <summary className="cursor-pointer px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900">
                  <div className="ml-1 flex flex-wrap items-center justify-between gap-3">
                    <p className={`min-w-0 flex-1 text-sm font-medium ${criterion.status === "not_applicable" ? "text-slate-600" : "text-slate-950"}`}>
                      {criterion.description}
                    </p>
                    <span className={`status-pill shrink-0 ${gateCriterionStatusClass(criterion.status)}`}>
                      {gateCriterionStatusLabels[criterion.status]}
                    </span>
                  </div>
                </summary>
                <div className="border-t border-black/5 px-4 pb-4 pt-3">
                  <p className="text-xs font-semibold text-slate-500">
                    {criterion.templateId ? "Default Criterion" : "Custom Criterion"}
                  </p>
                  {canPrepare ? (
                    <CriterionForm
                      action={updateCriterionAction.bind(null, criterion.id)}
                      description={criterion.description}
                      status={criterion.status}
                      submitLabel="Save criterion"
                    />
                  ) : null}
                  {canPrepare && !criterion.templateId ? (
                    <form action={deleteCriterionAction.bind(null, criterion.id)} className="mt-3 flex justify-end">
                      <button type="submit" className="button-secondary">Delete custom criterion</button>
                    </form>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        )}

        {canPrepare ? (
          <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Add Gate Criterion</summary>
            <CriterionForm action={createCriterionAction} submitLabel="Add criterion" />
          </details>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Related Deliverables</h2>
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
            No Deliverables are related to this Gate.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {orderedDeliverables.map((deliverable) => {
              const supportedCriteria = gate.criteria.filter((criterion) =>
                deliverable.criterionIds.includes(criterion.id),
              );

              return (
                <details
                  key={deliverable.id}
                  open={deliverable.status === "not_started" || deliverable.status === "in_progress"}
                  className={`overflow-hidden rounded-lg border ${deliverableContainerClass(deliverable.status)}`}
                >
                  <summary className="cursor-pointer px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900">
                    <div className="ml-1 flex flex-wrap items-center justify-between gap-3">
                      <h3 className={`min-w-0 flex-1 text-sm font-semibold ${deliverable.status === "not_applicable" ? "text-slate-600" : "text-slate-950"}`}>
                        {deliverable.title}
                      </h3>
                      <span className={`status-pill shrink-0 ${deliverableStatusClass(deliverable.status)}`}>
                        {deliverableStatusLabels[deliverable.status]}
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-black/5 px-4 pb-4 pt-3">
                    <p className="text-xs font-semibold text-slate-500">
                      {deliverable.templateId ? "Default Deliverable" : "Custom Deliverable"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {deliverable.description || "No description entered."}
                    </p>
                    <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                      <Detail label="Related stage" value={stageLabel} />
                      <Detail label="Scope level" value={scopeLabel} />
                      <div className="md:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Supports Gate Criteria
                        </dt>
                        <dd className="mt-1 text-slate-900">
                          {supportedCriteria.length > 0
                            ? supportedCriteria.map((criterion) => criterion.description).join("; ")
                            : "No Criteria linked."}
                        </dd>
                      </div>
                    </dl>
                    {canPrepare ? (
                      <DeliverableForm
                        action={updateDeliverableAction.bind(null, deliverable.id)}
                        deliverable={deliverable}
                        gate={gate}
                        stageLabel={stageLabel}
                        submitLabel="Save Deliverable"
                      />
                    ) : null}
                    {canPrepare && !deliverable.templateId ? (
                      <form action={deleteDeliverableAction.bind(null, deliverable.id)} className="mt-3 flex justify-end">
                        <button type="submit" className="button-secondary">Delete custom Deliverable</button>
                      </form>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}

        {canPrepare ? (
          <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Add Deliverable</summary>
            <DeliverableForm
              action={createDeliverableAction}
              gate={gate}
              stageLabel={stageLabel}
              submitLabel="Add Deliverable"
            />
          </details>
        ) : null}
      </section>
    </div>
  );
}

function ReviewHistory({ cycles }: { cycles: GateReviewCycle[] }) {
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
            <article key={cycle.id} className="rounded-lg border border-slate-200 p-4">
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
                open={cycle.status === "awaiting_approval"}
              >
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  View frozen Review Cycle
                </summary>
                <div className="mt-4 space-y-5">
                  <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <Detail label="Project" value={`${cycle.project.projectNumber} - ${cycle.project.name}`} />
                    <Detail
                      label="Package"
                      value={cycle.package ? `${cycle.package.packageCode} - ${cycle.package.name}` : "Project Gate"}
                    />
                    <Detail label="Gate" value={cycle.gate.name} />
                    <Detail label="Related Stage" value={cycle.gate.stageLabel} />
                  </dl>

                  <FrozenList
                    heading={`Criteria (${cycle.frozenEvidence.criteria.length})`}
                    emptyLabel="No Criteria were included."
                    items={cycle.frozenEvidence.criteria.map((criterion) => ({
                      id: criterion.criterionId,
                      title: criterion.description,
                      detail: getGateCriterionStatusLabel(criterion.status),
                    }))}
                  />
                  <FrozenList
                    heading={`Deliverables (${cycle.frozenEvidence.deliverables.length})`}
                    emptyLabel="No Deliverables were included."
                    items={cycle.frozenEvidence.deliverables.map((deliverable) => ({
                      id: deliverable.deliverableId,
                      title: deliverable.title,
                      detail: deliverableStatusLabels[deliverable.status],
                    }))}
                  />
                  <FrozenList
                    heading={`Gate Actions (${cycle.frozenEvidence.acceptedActions.length})`}
                    emptyLabel="No Gate Actions were included."
                    items={cycle.frozenEvidence.acceptedActions.map((action) => ({
                      id: action.actionId,
                      title: `${formatProjectActionId(action.sequence)} - ${action.description}`,
                      detail: `${projectActionStatusLabels[action.status]} | ${action.assignee} | Due ${formatDate(action.dueDate)}`,
                    }))}
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
                              </div>
                              <span className={`status-pill ${approverResponseStatusClass(approver.response?.outcome)}`}>
                                 {approver.response?.outcome === "approved"
                                   ? "Approved"
                                   : approver.response?.outcome === "returned_for_rework"
                                     ? "Returned for Rework"
                                    : "Pending Response"}
                              </span>
                            </div>
                            {approver.response ? (
                              <p className="mt-2 text-slate-600">
                                {formatDateTime(approver.response.respondedAt)} by {approver.response.respondedBy.displayName}
                                {approver.response.comment ? ` - ${approver.response.comment}` : ""}
                              </p>
                            ) : null}
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

function ApproverForm({
  action,
  approver,
  submitLabel,
}: {
  action: FormAction;
  approver?: Gate["approvers"][number];
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Name
        <input
          name="name"
          required
          defaultValue={approver?.name}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Email address
        <input
          type="email"
          name="email"
          required
          defaultValue={approver?.email}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Role / Function
        <input
          name="roleFunction"
          required
          defaultValue={approver?.roleFunction}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Gate Approval Role
        <input
          name="approvalRole"
          required
          defaultValue={approver?.approvalRole}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Approval Level
        <input
          type="number"
          name="approvalLevel"
          required
          min="1"
          step="1"
          defaultValue={approver?.approvalLevel ?? 1}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <div className="flex items-end justify-end">
        <button type="submit" className="button-primary">{submitLabel}</button>
      </div>
    </form>
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

function CriterionForm({
  action,
  description,
  status = "pending",
  submitLabel,
}: {
  action: FormAction;
  description?: string;
  status?: Gate["criteria"][number]["status"];
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-end">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Description
        <textarea
          name="description"
          required
          rows={3}
          defaultValue={description}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Status
        <select
          name="status"
          defaultValue={status}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        >
          {gateCriterionStatuses.map((criterionStatus) => (
            <option key={criterionStatus} value={criterionStatus}>
              {gateCriterionStatusLabels[criterionStatus]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="button-primary">
        {submitLabel}
      </button>
    </form>
  );
}

function DeliverableForm({
  action,
  deliverable,
  gate,
  stageLabel,
  submitLabel,
}: {
  action: FormAction;
  deliverable?: Deliverable;
  gate: Gate;
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
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        Description
        <textarea
          name="description"
          rows={3}
          defaultValue={deliverable?.description}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        Related Stage: <span className="font-semibold text-slate-950">{stageLabel}</span>
      </div>
      <fieldset className="rounded-lg border border-slate-200 bg-white px-4 py-3 md:col-span-2">
        <legend className="px-1 text-sm font-medium text-slate-700">Supports Gate Criteria</legend>
        {gate.criteria.length === 0 ? (
          <p className="text-sm text-slate-500">Add Gate Criteria before linking this Deliverable to them.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {gate.criteria.map((criterion) => (
              <label key={criterion.id} className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="criterionIds"
                  value={criterion.id}
                  defaultChecked={deliverable?.criterionIds.includes(criterion.id)}
                  className="mt-1 size-4 accent-slate-900"
                />
                {criterion.description}
              </label>
            ))}
          </div>
        )}
      </fieldset>
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

function gateCriterionStatusPriority(status: Gate["criteria"][number]["status"]) {
  if (status === "pending") return 0;
  if (status === "completed") return 1;
  return 2;
}

function deliverableStatusPriority(status: Deliverable["status"]) {
  if (status === "not_started") return 0;
  if (status === "in_progress") return 1;
  if (status === "completed") return 2;
  return 3;
}

function gateCriterionContainerClass(status: Gate["criteria"][number]["status"]) {
  if (status === "pending") return "border-amber-200 bg-amber-50/70";
  if (status === "completed") return "border-emerald-200 bg-emerald-50/50";
  return "border-slate-200 bg-slate-50";
}

function gateCriterionStatusClass(status: Gate["criteria"][number]["status"]) {
  if (status === "pending") return "status-amber";
  if (status === "completed") return "status-green";
  return "status-not_assessed";
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

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{value}</dd>
    </div>
  );
}
