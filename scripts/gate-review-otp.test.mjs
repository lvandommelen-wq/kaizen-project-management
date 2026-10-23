import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {}", shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const otp = await import("../src/lib/gate-review-otp.ts");

test("Gate Review OTP codes use assignment-bound keyed digests", () => {
  const previousSecret = process.env.GATE_REVIEW_OTP_SECRET;
  process.env.GATE_REVIEW_OTP_SECRET = "unit-test-gate-review-otp-secret-0000001";
  try {
    const codes = Array.from({ length: 50 }, () => otp.generateGateReviewOtp());
    assert.ok(codes.every((code) => /^\d{6}$/.test(code)));
    assert.ok(new Set(codes).size > 1);

    const accessA = "10000000-0000-4000-8000-000000000001";
    const accessB = "10000000-0000-4000-8000-000000000002";
    const digestA = otp.digestGateReviewOtp(accessA, "012345");
    assert.match(digestA, /^[0-9a-f]{64}$/);
    assert.equal(otp.digestGateReviewOtp(accessA, "012345"), digestA);
    assert.notEqual(otp.digestGateReviewOtp(accessB, "012345"), digestA);
    assert.notEqual(otp.digestGateReviewOtp(accessA, "012346"), digestA);
    assert.equal(otp.verifyGateReviewOtpDigest(accessA, "012345", digestA), true);
    assert.equal(otp.verifyGateReviewOtpDigest(accessA, "012346", digestA), false);
    assert.doesNotMatch(digestA, /012345/);
  } finally {
    restoreEnvironment("GATE_REVIEW_OTP_SECRET", previousSecret);
  }
});

test("Gate Review sessions use random tokens and store only SHA-256 hashes", () => {
  const first = otp.generateGateReviewSessionToken();
  const second = otp.generateGateReviewSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  const hash = otp.hashGateReviewSessionToken(first);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, first);
  assert.notEqual(hash, otp.hashGateReviewSessionToken(second));
});

test("Gate Review OTP configuration and masking fail safely", () => {
  const previousSecret = process.env.GATE_REVIEW_OTP_SECRET;
  try {
    delete process.env.GATE_REVIEW_OTP_SECRET;
    assert.throws(
      () => otp.digestGateReviewOtp("10000000-0000-4000-8000-000000000001", "123456"),
      /at least 32 characters/,
    );
    process.env.GATE_REVIEW_OTP_SECRET = "too-short";
    assert.throws(
      () => otp.digestGateReviewOtp("10000000-0000-4000-8000-000000000001", "123456"),
      /at least 32 characters/,
    );
    assert.equal(otp.maskGateReviewEmail("approver@example.com"), "ap••••••@example.com");
    assert.equal(otp.maskGateReviewEmail("x@example.com"), "x•••@example.com");
    assert.equal(otp.maskGateReviewEmail("invalid"), "the configured email address");
  } finally {
    restoreEnvironment("GATE_REVIEW_OTP_SECRET", previousSecret);
  }
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
