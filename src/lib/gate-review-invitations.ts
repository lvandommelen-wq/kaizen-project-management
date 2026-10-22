import "server-only";

import { sendEmail, type EmailMessage } from "./email";
import type {
  GateReviewApproverSnapshot,
  GateReviewCycle,
  GateReviewInvitationAttempt,
  GateReviewInvitationAttemptResult,
} from "./gates";
import {
  claimPackageGateReviewInvitation,
  completePackageGateReviewInvitation,
} from "./packages";
import {
  claimProjectGateReviewInvitation,
  completeProjectGateReviewInvitation,
} from "./projects";
import { getOperationalDataBackend } from "./operational/backend";

export type GateReviewInvitationDispatchSummary = {
  sent: number;
  failed: number;
  skipped: number;
};

type ClaimedInvitation = {
  reviewCycle: GateReviewCycle;
  approver: GateReviewApproverSnapshot;
  attempt: GateReviewInvitationAttempt;
  claimToken?: string;
};

class InvitationConfigurationError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(code: string, safeMessage: string) {
    super(safeMessage);
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export async function dispatchProjectGateReviewInvitations(input: {
  projectId: string;
  gateId: string;
  reviewCycleId: string;
  gateApproverIds: string[];
  retryFailed?: boolean;
}) {
  return dispatchGateReviewInvitations(
    input.gateApproverIds,
    (gateApproverId) => claimProjectGateReviewInvitation(
      input.projectId,
      input.gateId,
      input.reviewCycleId,
      gateApproverId,
      input.retryFailed ?? false,
    ),
    (gateApproverId, attemptId, result, claimToken) => completeProjectGateReviewInvitation(
      input.projectId,
      input.gateId,
      input.reviewCycleId,
      gateApproverId,
      attemptId,
      result,
      claimToken,
    ),
    (cycle) => getOperationalDataBackend() === "postgres"
      ? buildAssignedReviewUrl(cycle.id)
      : buildReviewUrl(
          `/projects/${encodeURIComponent(input.projectId)}/gates/${encodeURIComponent(input.gateId)}`,
          cycle.id,
        ),
  );
}

export async function dispatchPackageGateReviewInvitations(input: {
  projectId: string;
  packageId: string;
  gateId: string;
  reviewCycleId: string;
  gateApproverIds: string[];
  retryFailed?: boolean;
}) {
  return dispatchGateReviewInvitations(
    input.gateApproverIds,
    (gateApproverId) => claimPackageGateReviewInvitation(
      input.projectId,
      input.packageId,
      input.gateId,
      input.reviewCycleId,
      gateApproverId,
      input.retryFailed ?? false,
    ),
    (gateApproverId, attemptId, result, claimToken) => completePackageGateReviewInvitation(
      input.projectId,
      input.packageId,
      input.gateId,
      input.reviewCycleId,
      gateApproverId,
      attemptId,
      result,
      claimToken,
    ),
    (cycle) => getOperationalDataBackend() === "postgres"
      ? buildAssignedReviewUrl(cycle.id)
      : buildReviewUrl(
          `/projects/${encodeURIComponent(input.projectId)}/packages/${encodeURIComponent(input.packageId)}/gates/${encodeURIComponent(input.gateId)}`,
          cycle.id,
        ),
  );
}

async function dispatchGateReviewInvitations(
  gateApproverIds: string[],
  claim: (gateApproverId: string) => Promise<ClaimedInvitation | null>,
  complete: (
    gateApproverId: string,
    attemptId: string,
    result: GateReviewInvitationAttemptResult,
    claimToken?: string,
  ) => Promise<boolean>,
  getReviewUrl: (cycle: GateReviewCycle) => string,
): Promise<GateReviewInvitationDispatchSummary> {
  const summary: GateReviewInvitationDispatchSummary = {
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const gateApproverId of [...new Set(gateApproverIds)]) {
    const claimed = await claim(gateApproverId);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    let result: GateReviewInvitationAttemptResult;
    try {
      const message = composeGateReviewInvitation(
        claimed.reviewCycle,
        claimed.approver,
        claimed.attempt.idempotencyKey,
        getReviewUrl(claimed.reviewCycle),
      );
      result = await sendEmail(message);
    } catch (error) {
      result = invitationPreparationFailure(error);
    }

    const recorded = await complete(
      gateApproverId,
      claimed.attempt.id,
      result,
      claimed.claimToken,
    );
    if (!recorded) {
      summary.failed += 1;
    } else if (result.status === "sent") {
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

function buildReviewUrl(pathname: string, reviewCycleId: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) {
    throw new InvitationConfigurationError(
      "app_base_url_missing",
      "APP_BASE_URL is not configured for Gate Review links.",
    );
  }

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new InvitationConfigurationError(
      "app_base_url_invalid",
      "APP_BASE_URL must be a valid absolute URL.",
    );
  }
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username ||
    base.password
  ) {
    throw new InvitationConfigurationError(
      "app_base_url_invalid",
      "APP_BASE_URL must be a credential-free HTTP or HTTPS URL.",
    );
  }
  const url = new URL(pathname, base);
  url.searchParams.set("reviewCycle", reviewCycleId);
  url.hash = `review-cycle-${reviewCycleId}`;
  return url.toString();
}

function buildAssignedReviewUrl(reviewCycleId: string) {
  return buildReviewUrl(`/reviews/${encodeURIComponent(reviewCycleId)}`, reviewCycleId);
}

function invitationPreparationFailure(
  error: unknown,
): GateReviewInvitationAttemptResult {
  if (error instanceof InvitationConfigurationError) {
    return {
      status: "failed",
      error: { code: error.code, message: error.safeMessage },
    };
  }
  return {
    status: "failed",
    error: {
      code: "invitation_preparation_failed",
      message: "The invitation could not be prepared. Check the application email configuration.",
    },
  };
}

function composeGateReviewInvitation(
  cycle: GateReviewCycle,
  approver: GateReviewApproverSnapshot,
  idempotencyKey: string,
  reviewUrl: string,
): EmailMessage {
  const packageLabel = cycle.package
    ? `${cycle.package.packageCode} - ${cycle.package.name}`
    : null;
  const submittedBy = cycle.submittedBy.email
    ? `${cycle.submittedBy.displayName} (${cycle.submittedBy.email})`
    : cycle.submittedBy.displayName;
  const details = [
    ["Project", `${cycle.project.projectNumber} - ${cycle.project.name}`],
    ...(packageLabel ? [["Package", packageLabel]] : []),
    ["Gate", cycle.gate.name],
    ["Review Cycle", String(cycle.cycleNumber)],
    ["Approval Role", approver.approvalRole],
    ["Approval Level", String(approver.approvalLevel)],
    ["Submitted By", submittedBy],
    ["Submitted At", formatTimestamp(cycle.submittedAt)],
  ];

  const textDetails = details.map(([label, value]) => `${label}: ${value}`).join("\n");
  const htmlDetails = details
    .map(([label, value]) => `<tr><th align="left" style="padding:6px 16px 6px 0;color:#52606d;font-weight:600;vertical-align:top">${escapeHtml(label)}</th><td style="padding:6px 0;color:#172b4d">${escapeHtml(value)}</td></tr>`)
    .join("");

  return {
    to: approver.email,
    subject: `Gate review requested: ${cycle.gate.name} - ${cycle.project.projectNumber}`,
    idempotencyKey,
    text: [
      "Kaizen Project Management",
      "",
      `Hello ${approver.name},`,
      "",
      "A Gate Review is ready for your approval.",
      "",
      textDetails,
      "",
      `Review Gate: ${reviewUrl}`,
      "",
      "This link opens the frozen Review Cycle. It does not record an approval.",
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#172b4d"><div style="max-width:640px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #dfe1e6;border-radius:8px;padding:28px"><p style="margin:0 0 24px;color:#0052cc;font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Kaizen Project Management</p><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">Gate Review requested</h1><p style="margin:0 0 20px">Hello ${escapeHtml(approver.name)},</p><p style="margin:0 0 20px">A Gate Review is ready for your approval.</p><table role="presentation" style="border-collapse:collapse;margin:0 0 24px">${htmlDetails}</table><p style="margin:0 0 24px"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#0052cc;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:4px">Review Gate</a></p><p style="margin:0;color:#52606d;font-size:13px;line-height:1.5">This link opens the frozen Review Cycle. It does not record an approval.</p></div></div></body></html>`,
  };
}

function formatTimestamp(value: string) {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
