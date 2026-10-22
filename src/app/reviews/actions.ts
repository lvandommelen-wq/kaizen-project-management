"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/authorization";
import {
  gateReviewApproverResponseOutcomes,
  type GateReviewApproverResponseOutcome,
} from "@/lib/gates";
import {
  dispatchPackageGateReviewInvitations,
  dispatchProjectGateReviewInvitations,
} from "@/lib/gate-review-invitations";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import { recordAssignedGateReviewResponse } from "@/lib/operational/postgres";

export async function respondToAssignedGateReviewAction(
  reviewCycleId: string,
  formData: FormData,
) {
  if (getOperationalDataBackend() !== "postgres") notFound();
  const actor = await requireActiveUser();
  const outcome = String(formData.get("outcome") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!gateReviewApproverResponseOutcomes.includes(outcome as GateReviewApproverResponseOutcome)) {
    throw new Error("Select a valid Gate Review response.");
  }
  if (outcome === "returned_for_rework" && !comment) {
    redirect(`/reviews/${reviewCycleId}?error=comment_required`);
  }

  const result = await recordAssignedGateReviewResponse({
    reviewCycleId,
    actor,
    outcome: outcome as GateReviewApproverResponseOutcome,
    comment,
  });
  if (!result) notFound();
  if (result.outcome !== "recorded") {
    redirect(`/reviews/${reviewCycleId}?error=${encodeURIComponent(result.outcome)}`);
  }

  if (result.activatedApproverIds.length > 0) {
    if (result.assigned.packageId) {
      await dispatchPackageGateReviewInvitations({
        projectId: result.assigned.projectId,
        packageId: result.assigned.packageId,
        gateId: result.assigned.gateId,
        reviewCycleId,
        gateApproverIds: result.activatedApproverIds,
      });
    } else {
      await dispatchProjectGateReviewInvitations({
        projectId: result.assigned.projectId,
        gateId: result.assigned.gateId,
        reviewCycleId,
        gateApproverIds: result.activatedApproverIds,
      });
    }
  }

  revalidatePath(`/reviews/${reviewCycleId}`);
  revalidatePath(`/projects/${result.assigned.projectId}`);
  redirect(`/reviews/${reviewCycleId}?recorded=${encodeURIComponent(outcome)}`);
}
