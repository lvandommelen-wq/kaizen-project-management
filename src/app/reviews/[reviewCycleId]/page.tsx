import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { FrozenGateReviewEvidence } from "@/app/_components/frozen-gate-review-evidence";
import { SignOutButton } from "@/app/_components/sign-out-button";
import { respondToAssignedGateReviewAction } from "@/app/reviews/actions";
import { getCurrentUser } from "@/lib/current-user";
import {
  gateReviewCycleStatusLabels,
  getGateReviewApprovalState,
} from "@/lib/gates";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import { getAssignedGateReview } from "@/lib/operational/postgres";
import { isExternalGateReviewAccessEnabled } from "@/lib/pilot-policy";

export const dynamic = "force-dynamic";

export default async function AssignedReviewPage({
  params,
  searchParams,
}: PageProps<"/reviews/[reviewCycleId]">) {
  const { reviewCycleId } = await params;
  const query = await searchParams;
  if (getOperationalDataBackend() !== "postgres") notFound();
  if (!isExternalGateReviewAccessEnabled()) notFound();
  const actor = await getCurrentUser(await headers());
  if (!actor) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/reviews/${reviewCycleId}`)}`);
  }
  if (actor.status !== "active") {
    redirect("/access-denied?reason=inactive");
  }
  const assigned = await getAssignedGateReview(reviewCycleId, actor);
  if (!assigned) notFound();
  const { reviewCycle: cycle, assignedApprover: approver } = assigned;
  const approvalState = getGateReviewApprovalState(cycle);
  const isEligible = cycle.status === "awaiting_approval" && approvalState.eligibleApprovers.some(
    (candidate) => candidate.gateApproverId === approver.gateApproverId,
  );
  const action = respondToAssignedGateReviewAction.bind(null, cycle.id);
  const error = firstValue(query.error);
  const recorded = firstValue(query.recorded);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="eyebrow">Assigned Gate Review</p><h1>{cycle.gate.name}</h1><p className="mt-2 text-sm text-slate-600">{cycle.project.projectNumber} - {cycle.project.name}{cycle.package ? ` / ${cycle.package.packageCode} - ${cycle.package.name}` : ""}</p></div>
        <SignOutButton />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Summary label="Review cycle" value={String(cycle.cycleNumber)} />
        <Summary label="Status" value={gateReviewCycleStatusLabels[cycle.status]} />
        <Summary label="Your approval role" value={`Level ${approver.approvalLevel}: ${approver.approvalRole}`} />
      </section>

      {recorded ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Your authenticated response was recorded.</p> : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{reviewError(error)}</p> : null}
      {cycle.status === "withdrawn" ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This Review Cycle was withdrawn. Its frozen evidence and previous responses remain historical records, but any approvals shown no longer affect Gate approval or Stage progression and will not carry into a later Review Cycle.</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Frozen review evidence</h2>
        <p className="mt-1 text-sm text-slate-600">Submitted {formatTimestamp(cycle.submittedAt)}. The information below is the immutable evidence for this Review Cycle.</p>
        <div className="mt-6">
          <FrozenGateReviewEvidence cycle={cycle} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <EvidenceList heading="Accepted actions" empty="No open Gate Actions were accepted." items={cycle.frozenEvidence.acceptedActions.map((item) => ({ id: item.actionId, title: `Action ${item.sequence}: ${item.description}`, detail: `${item.assignee} / ${item.status.replaceAll("_", " ")}` }))} />
          <EvidenceList heading="Approval history" empty="No responses have been recorded." items={cycle.approvers.filter((item) => item.response).map((item) => ({ id: item.gateApproverId, title: `${item.approvalRole}: ${item.response?.outcome.replaceAll("_", " ")}`, detail: `${item.name} / ${formatTimestamp(item.response!.respondedAt)}` }))} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Your response</h2>
        {approver.response ? (
          <p className="mt-3 text-sm text-slate-700">You responded <strong>{approver.response.outcome.replaceAll("_", " ")}</strong> at {formatTimestamp(approver.response.respondedAt)}.{cycle.status === "withdrawn" ? " This response is historical and no longer effective." : ""}</p>
        ) : isEligible ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <form action={action} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><input type="hidden" name="outcome" value="approved"/><label className="text-sm font-medium">Approval comment (optional)<textarea name="comment" rows={4} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label><button type="submit" className="button-primary mt-4">Confirm approval</button></form>
            <form action={action} className="rounded-lg border border-red-200 bg-red-50 p-4"><input type="hidden" name="outcome" value="returned_for_rework"/><label className="text-sm font-medium">Required rework reason<textarea name="comment" required rows={4} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label><button type="submit" className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Return for rework</button></form>
          </div>
        ) : <p className="mt-3 text-sm text-slate-700">{cycle.status === "withdrawn" ? "This Review Cycle was withdrawn and no longer accepts responses." : "This assignment is waiting for an earlier Approval Level or the Review Cycle is no longer accepting responses."}</p>}
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 font-semibold">{value}</p></div>; }
function EvidenceList({ heading, empty, items }: { heading: string; empty: string; items: { id: string; title: string; detail: string }[] }) { return <div><h3 className="font-semibold">{heading}</h3>{items.length ? <ul className="mt-3 space-y-2">{items.map((item) => <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"><p className="font-medium">{item.title}</p><p className="mt-1 capitalize text-slate-600">{item.detail}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">{empty}</p>}</div>; }
function formatTimestamp(value: string) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)); }
function firstValue(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function reviewError(error: string) { if (error === "comment_required") return "A rework reason is required."; if (error === "not_eligible") return "An earlier Approval Level must complete first."; if (error === "already_responded") return "This assignment has already responded."; return "This Review Cycle is no longer accepting your response."; }
