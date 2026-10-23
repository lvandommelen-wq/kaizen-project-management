import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export const gateReviewOtpLifetimeMinutes = 10;
export const gateReviewSessionLifetimeMinutes = 30;
export const gateReviewOtpResendSeconds = 60;
export const gateReviewOtpHourlyLimit = 5;
export const gateReviewOtpMaximumAttempts = 5;
export const gateReviewSessionCookieName = "kaizen_gate_review_session";

export function generateGateReviewOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function digestGateReviewOtp(reviewAccessId: string, code: string) {
  return createHmac("sha256", gateReviewOtpSecret())
    .update(`${reviewAccessId}:${code}`, "utf8")
    .digest("hex");
}

export function verifyGateReviewOtpDigest(
  reviewAccessId: string,
  code: string,
  expectedDigest: string,
) {
  const actual = Buffer.from(digestGateReviewOtp(reviewAccessId, code), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateGateReviewSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashGateReviewSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function maskGateReviewEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "the configured email address";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function gateReviewOtpSecret() {
  const secret = process.env.GATE_REVIEW_OTP_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("GATE_REVIEW_OTP_SECRET must contain at least 32 characters.");
  }
  return secret;
}
