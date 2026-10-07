"use client";

import { useState } from "react";
import type {
  GateReviewApproverResponseOutcome,
  GateReviewApproverSnapshot,
} from "@/lib/gates";

type FormAction = (formData: FormData) => void | Promise<void>;

type GateApprovalTestPanelProps = {
  acceptedActionCount: number;
  action: FormAction;
  approvers: GateReviewApproverSnapshot[];
  reviewCycleId: string;
  reviewCycleNumber: number;
};

export function GateApprovalTestPanel({
  acceptedActionCount,
  action,
  approvers,
  reviewCycleId,
  reviewCycleNumber,
}: GateApprovalTestPanelProps) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.gateApproverId ?? "",
  );
  const [responseOutcome, setResponseOutcome] =
    useState<GateReviewApproverResponseOutcome | null>(null);
  const selectedApprover = approvers.find(
    (approver) => approver.gateApproverId === selectedApproverId,
  ) ?? approvers[0];

  if (!selectedApprover) return null;

  const isReturn = responseOutcome === "returned_for_rework";

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Development identity substitute
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">
            Test as Approver
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            This selector temporarily stands in for authenticated identity. Only
            frozen Approvers currently eligible at this Approval Level are
            available.
          </p>
        </div>
        <span className="status-pill bg-indigo-100 text-indigo-800">
          Test workflow
        </span>
      </div>

      <label className="mt-4 block text-sm font-medium text-slate-700">
        Test as Approver
        <select
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
          value={selectedApprover.gateApproverId}
          onChange={(event) => setSelectedApproverId(event.target.value)}
        >
          {approvers.map((approver) => (
            <option
              key={approver.gateApproverId}
              value={approver.gateApproverId}
            >
              Level {approver.approvalLevel}: {approver.approvalRole} - {approver.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 rounded-lg border border-indigo-100 bg-white/80 p-3 text-sm text-slate-700">
        <p className="font-semibold text-slate-950">{selectedApprover.name}</p>
        <p>
          Level {selectedApprover.approvalLevel} | {selectedApprover.approvalRole} | {selectedApprover.roleFunction}
        </p>
        <p className="mt-2">
          Approval confirms frozen Review Cycle {reviewCycleNumber}
          {acceptedActionCount > 0
            ? ` and accepts ${acceptedActionCount} open Gate Action${acceptedActionCount === 1 ? "" : "s"}.`
            : "."} The application determines the final Gate decision after all
          required approvals.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="button-primary"
          onClick={() => setResponseOutcome("approved")}
        >
          Approve
        </button>
        <button
          type="button"
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          onClick={() => setResponseOutcome("returned_for_rework")}
        >
          Return for Rework
        </button>
      </div>

      {responseOutcome ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4"
          role="presentation"
        >
          <div
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            role="dialog"
          >
            <h2 className="text-xl font-semibold text-slate-950">
              {isReturn ? "Return Gate for Rework" : "Confirm Approval"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Record {isReturn ? "a return response" : "an approval"} as {selectedApprover.name}, acting as {selectedApprover.approvalRole} at Approval Level {selectedApprover.approvalLevel}?
            </p>

            <form action={action} className="mt-5">
              <input type="hidden" name="reviewCycleId" value={reviewCycleId} />
              <input
                type="hidden"
                name="gateApproverId"
                value={selectedApprover.gateApproverId}
              />
              <input type="hidden" name="outcome" value={responseOutcome} />
              <label className="block text-sm font-medium text-slate-700">
                {isReturn ? "Return reason" : "Comment (optional)"}
                <textarea
                  name="comment"
                  required={isReturn}
                  rows={4}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950"
                  placeholder={
                    isReturn
                      ? "Describe the rework required before resubmission."
                      : "Add context for this approval."
                  }
                />
              </label>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setResponseOutcome(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={isReturn
                    ? "rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
                    : "button-primary"}
                >
                  {isReturn ? "Confirm Return" : "Confirm Approval"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
