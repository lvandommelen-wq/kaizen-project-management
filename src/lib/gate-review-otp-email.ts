import "server-only";

import { sendEmail, type EmailMessage } from "./email";
import { gateReviewOtpLifetimeMinutes } from "./gate-review-otp";
import {
  claimGateReviewOtpChallenge,
  completeGateReviewOtpDelivery,
} from "./operational/postgres";
import type { GateReviewInvitationAttemptResult } from "./gates";

export async function requestGateReviewOtp(reviewAccessId: string) {
  const claim = await claimGateReviewOtpChallenge(reviewAccessId);
  if (claim.outcome !== "created") return claim;

  let delivery: GateReviewInvitationAttemptResult;
  try {
    delivery = await sendEmail(composeOtpEmail(claim));
  } catch {
    delivery = {
      status: "failed",
      error: {
        code: "otp_delivery_failed",
        message: "The verification code could not be sent. Check the email configuration.",
      },
    };
  }
  const recorded = await completeGateReviewOtpDelivery(claim.challengeId, delivery);
  if (!recorded || delivery.status !== "sent") return { outcome: "delivery_failed" as const };
  return { outcome: "sent" as const };
}

function composeOtpEmail(input: {
  challengeId: string;
  code: string;
  email: string;
  approverName: string;
  projectLabel: string;
  gateName: string;
}): EmailMessage {
  return {
    to: input.email,
    subject: `Your Gate Review verification code - ${input.gateName}`,
    idempotencyKey: `gate-review-otp/${input.challengeId}`,
    text: [
      "Kaizen Project Management",
      "",
      `Hello ${input.approverName},`,
      "",
      `Your verification code is: ${input.code}`,
      "",
      `Project: ${input.projectLabel}`,
      `Gate: ${input.gateName}`,
      `This code expires in ${gateReviewOtpLifetimeMinutes} minutes and can be used once.`,
      "",
      "If you did not request this code, you can ignore this message.",
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#172b4d"><div style="max-width:640px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #dfe1e6;border-radius:8px;padding:28px"><p style="margin:0 0 24px;color:#0052cc;font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Kaizen Project Management</p><h1 style="margin:0 0 16px;font-size:24px">Gate Review verification code</h1><p>Hello ${escapeHtml(input.approverName)},</p><p>Use this one-time code to access your frozen Gate Review assignment:</p><p style="margin:24px 0;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:.18em">${input.code}</p><p><strong>Project:</strong> ${escapeHtml(input.projectLabel)}<br><strong>Gate:</strong> ${escapeHtml(input.gateName)}</p><p style="color:#52606d;font-size:13px">This code expires in ${gateReviewOtpLifetimeMinutes} minutes and can be used once. If you did not request it, ignore this message.</p></div></div></body></html>`,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
