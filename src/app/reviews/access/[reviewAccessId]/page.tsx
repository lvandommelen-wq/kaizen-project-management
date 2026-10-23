import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  requestReviewCodeAction,
  respondToOtpGateReviewAction,
  verifyReviewCodeAction,
} from "./actions";
import { gateReviewSessionCookieName } from "@/lib/gate-review-otp";
import {
  gateReviewCycleStatusLabels,
  getGateCriterionStatusLabel,
  getGateReviewApprovalState,
  type GateReviewCycle,
} from "@/lib/gates";
import {
  getGateReviewOtpAccess,
  getOtpAssignedGateReview,
} from "@/lib/operational/postgres";

export const dynamic = "force-dynamic";

export default async function OtpGateReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ reviewAccessId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reviewAccessId } = await params;
  const query = await searchParams;
  const access = await getGateReviewOtpAccess(reviewAccessId);
  if (!access) notFound();
  const sessionToken = (await cookies()).get(gateReviewSessionCookieName)?.value;
  const assigned = sessionToken
    ? await getOtpAssignedGateReview(reviewAccessId, sessionToken)
    : null;

  if (!assigned) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div><p className="eyebrow">Gate Review</p><h1>Verify your email</h1><p className="mt-2 text-sm text-slate-600">A one-time code will be sent to {access.maskedEmail}. Frozen Gate evidence is available only after verification.</p></div>
        {resultMessage(firstValue(query.result)) ? <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">{resultMessage(firstValue(query.result))}</p> : null}
        {access.canRequestCode ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <form action={requestReviewCodeAction.bind(null, reviewAccessId)}>
              <button type="submit" className="button-secondary">Send verification code</button>
            </form>
            <form action={verifyReviewCodeAction.bind(null, reviewAccessId)} className="mt-6 space-y-4">
              <label className="grid gap-2 text-sm font-medium text-slate-800">Six-digit verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="h-12 rounded-lg border border-slate-300 px-3 font-mono text-lg tracking-[0.25em]" /></label>
              <button type="submit" className="button-primary">Verify and open Review</button>
            </form>
          </section>
        ) : <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This Review Cycle is no longer accepting verification or responses.</p>}
      </div>
    );
  }

  const { reviewCycle: cycle, assignedApprover: approver } = assigned;
  const approvalState = getGateReviewApprovalState(cycle);
  const isEligible = cycle.status === "awaiting_approval" && approvalState.eligibleApprovers.some(
    (candidate) => candidate.gateApproverId === approver.gateApproverId,
  );
  const result = firstValue(query.result);
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div><p className="eyebrow">Verified Gate Review</p><h1>{cycle.gate.name}</h1><p className="mt-2 text-sm text-slate-600">{cycle.project.projectNumber} - {cycle.project.name}{cycle.package ? ` / ${cycle.package.packageCode} - ${cycle.package.name}` : ""}</p></div>
      <section className="grid gap-4 md:grid-cols-3"><Summary label="Review cycle" value={String(cycle.cycleNumber)} /><Summary label="Status" value={gateReviewCycleStatusLabels[cycle.status]} /><Summary label="Your approval role" value={`Level ${approver.approvalLevel}: ${approver.approvalRole}`} /></section>
      {result === "recorded" ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Your verified response was recorded.</p> : null}
      {result && result !== "recorded" ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{responseError(result)}</p> : null}
      {cycle.status === "withdrawn" ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This Review Cycle was withdrawn. Previous responses remain historical but no longer affect Gate approval or Stage progression.</p> : null}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Frozen review evidence</h2><p className="mt-1 text-sm text-slate-600">Submitted {formatTimestamp(cycle.submittedAt)}. This is the immutable evidence for this Review Cycle.</p><div className="mt-6 grid gap-6 lg:grid-cols-2">{cycle.frozenEvidence.criteria.length > 0 ? <EvidenceList heading="Legacy Gate Criteria" empty="No legacy criteria were frozen." items={cycle.frozenEvidence.criteria.map((item) => ({ id: item.criterionId, title: item.description, detail: getGateCriterionStatusLabel(item.status) }))} /> : null}{cycle.frozenEvidence.matrixReviewConfirmation && cycle.frozenEvidence.applicabilityMatrix ? <EvidenceList heading="Confirmed Applicability Matrix review" empty="No Deliverables were frozen for the confirmed matrix scope." items={matrixReviewEvidenceItems(cycle)} /> : null}<EvidenceList heading="Deliverables" empty="No deliverables were frozen." items={cycle.frozenEvidence.deliverables.map((item) => ({ id: item.deliverableId, title: item.title, detail: `${item.status.replaceAll("_", " ")} — Acceptance requirements: ${item.description || "Not recorded in this historical Review Cycle."}` }))} /><EvidenceList heading="Accepted actions" empty="No open Gate Actions were accepted." items={cycle.frozenEvidence.acceptedActions.map((item) => ({ id: item.actionId, title: `Action ${item.sequence}: ${item.description}`, detail: `${item.assignee} / ${item.status.replaceAll("_", " ")}` }))} /><EvidenceList heading="Approval history" empty="No responses have been recorded." items={cycle.approvers.filter((item) => item.response).map((item) => ({ id: item.gateApproverId, title: `${item.approvalRole}: ${item.response?.outcome.replaceAll("_", " ")}`, detail: `${item.name} / ${formatTimestamp(item.response!.respondedAt)}` }))} /></div></section>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Your response</h2>{approver.response ? <p className="mt-3 text-sm text-slate-700">You responded <strong>{approver.response.outcome.replaceAll("_", " ")}</strong> at {formatTimestamp(approver.response.respondedAt)}.{cycle.status === "withdrawn" ? " This response is historical and no longer effective." : ""}</p> : isEligible ? <div className="mt-5 grid gap-5 lg:grid-cols-2"><form action={respondToOtpGateReviewAction.bind(null, reviewAccessId)} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><input type="hidden" name="outcome" value="approved"/><label className="text-sm font-medium">Approval comment (optional)<textarea name="comment" rows={4} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label><button type="submit" className="button-primary mt-4">Approve &amp; Sign</button></form><form action={respondToOtpGateReviewAction.bind(null, reviewAccessId)} className="rounded-lg border border-red-200 bg-red-50 p-4"><input type="hidden" name="outcome" value="returned_for_rework"/><label className="text-sm font-medium">Required rework reason<textarea name="comment" required rows={4} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label><button type="submit" className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Return for Rework</button></form></div> : <p className="mt-3 text-sm text-slate-700">This assignment is waiting for an earlier Approval Level or the Review Cycle no longer accepts responses.</p>}</section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 font-semibold">{value}</p></div>; }
function EvidenceList({ heading, empty, items }: { heading: string; empty: string; items: { id: string; title: string; detail: string }[] }) { return <div><h3 className="font-semibold">{heading}</h3>{items.length ? <ul className="mt-3 space-y-2">{items.map((item) => <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"><p className="font-medium">{item.title}</p><p className="mt-1 capitalize text-slate-600">{item.detail}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">{empty}</p>}</div>; }
function matrixReviewEvidenceItems(cycle: GateReviewCycle) { const confirmation = cycle.frozenEvidence.matrixReviewConfirmation!; const matrix = cycle.frozenEvidence.applicabilityMatrix!; const gates = confirmation.reviewScope === "final_lifecycle" ? matrix.gates : matrix.gates.filter((gate) => gate.stageId === confirmation.targetStageId); return [{ id: `confirmation:${cycle.id}`, title: `${confirmation.targetStageLabel} — confirmed by ${confirmation.reviewer.displayName}`, detail: `${formatTimestamp(confirmation.confirmedAt)} — fingerprint ${confirmation.matrixFingerprint}` }, ...gates.flatMap((gate) => gate.items.map((item) => ({ id: `${gate.gateId}:${item.itemId}`, title: `${gate.stageLabel}: ${item.title}`, detail: `${item.applicability.replaceAll("_", " ")}${item.justification ? ` — justification: ${item.justification}` : ""} — acceptance requirements: ${item.description}` })))]; }
function formatTimestamp(value: string) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)); }
function firstValue(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function resultMessage(result?: string) { if (result === "sent") return "A verification code was sent. Check your email and enter it below."; if (result === "rate_limited") return "Please wait before requesting another code."; if (result === "delivery_failed") return "The code could not be delivered. Try again later."; if (result === "invalid_code") return "The code is invalid or expired."; if (result === "locked") return "Too many unsuccessful attempts. Request a new code later."; if (result === "unavailable") return "This Review Cycle is not accepting verification."; return null; }
function responseError(result: string) { if (result === "comment_required") return "A rework reason is required."; if (result === "session_expired") return "Your Review session expired. Verify a new code to continue."; if (result === "already_responded") return "This assignment has already responded."; if (result === "not_eligible") return "An earlier Approval Level must complete first."; return "This Review Cycle is no longer accepting your response."; }
