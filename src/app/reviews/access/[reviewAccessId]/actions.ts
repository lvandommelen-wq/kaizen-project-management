"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  dispatchPackageGateReviewInvitations,
  dispatchProjectGateReviewInvitations,
} from "@/lib/gate-review-invitations";
import { requestGateReviewOtp } from "@/lib/gate-review-otp-email";
import { gateReviewSessionCookieName } from "@/lib/gate-review-otp";
import {
  gateReviewApproverResponseOutcomes,
  type GateReviewApproverResponseOutcome,
} from "@/lib/gates";
import {
  recordOtpGateReviewResponse,
  verifyGateReviewOtp,
} from "@/lib/operational/postgres";

export async function requestReviewCodeAction(reviewAccessId: string) {
  const result = await requestGateReviewOtp(reviewAccessId);
  redirect(reviewAccessPath(reviewAccessId, result.outcome));
}

export async function verifyReviewCodeAction(
  reviewAccessId: string,
  formData: FormData,
) {
  const code = String(formData.get("code") ?? "").trim();
  const result = await verifyGateReviewOtp(reviewAccessId, code);
  if (result.outcome !== "verified") {
    redirect(reviewAccessPath(reviewAccessId, result.outcome));
  }
  const store = await cookies();
  store.set(gateReviewSessionCookieName, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/reviews",
    expires: new Date(result.expiresAt),
  });
  redirect(`/reviews/access/${encodeURIComponent(reviewAccessId)}`);
}

export async function respondToOtpGateReviewAction(
  reviewAccessId: string,
  formData: FormData,
) {
  const outcome = String(formData.get("outcome") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!gateReviewApproverResponseOutcomes.includes(outcome as GateReviewApproverResponseOutcome)) {
    throw new Error("Select a valid Gate Review response.");
  }
  if (outcome === "returned_for_rework" && !comment) {
    redirect(reviewAccessPath(reviewAccessId, "comment_required"));
  }
  const sessionToken = (await cookies()).get(gateReviewSessionCookieName)?.value;
  if (!sessionToken) redirect(reviewAccessPath(reviewAccessId, "session_expired"));
  const result = await recordOtpGateReviewResponse({
    reviewAccessId,
    sessionToken,
    outcome: outcome as GateReviewApproverResponseOutcome,
    comment,
  });
  if (!result) redirect(reviewAccessPath(reviewAccessId, "session_expired"));
  if (result.outcome !== "recorded") {
    redirect(reviewAccessPath(reviewAccessId, result.outcome));
  }
  if (result.activatedApproverIds.length > 0) {
    if (result.assigned.packageId) {
      await dispatchPackageGateReviewInvitations({
        projectId: result.assigned.projectId,
        packageId: result.assigned.packageId,
        gateId: result.assigned.gateId,
        reviewCycleId: result.assigned.reviewCycle.id,
        gateApproverIds: result.activatedApproverIds,
      });
    } else {
      await dispatchProjectGateReviewInvitations({
        projectId: result.assigned.projectId,
        gateId: result.assigned.gateId,
        reviewCycleId: result.assigned.reviewCycle.id,
        gateApproverIds: result.activatedApproverIds,
      });
    }
  }
  revalidatePath(`/reviews/access/${reviewAccessId}`);
  revalidatePath(`/projects/${result.assigned.projectId}`);
  redirect(reviewAccessPath(reviewAccessId, "recorded"));
}

function reviewAccessPath(reviewAccessId: string, result: string) {
  return `/reviews/access/${encodeURIComponent(reviewAccessId)}?result=${encodeURIComponent(result)}`;
}
