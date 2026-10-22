import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const mockState = {
  sendEmail: async () => {
    throw new Error("Unexpected email send.");
  },
  claimProject: async () => null,
  completeProject: async () => false,
  claimPackage: async () => null,
  completePackage: async () => false,
};
globalThis.__gateInvitationTestMocks = mockState;

const mockEmailUrl = moduleUrl(`
  export function sendEmail(message) {
    return globalThis.__gateInvitationTestMocks.sendEmail(message);
  }
`);
const mockProjectsUrl = moduleUrl(`
  export function claimProjectGateReviewInvitation(...args) {
    return globalThis.__gateInvitationTestMocks.claimProject(...args);
  }
  export function completeProjectGateReviewInvitation(...args) {
    return globalThis.__gateInvitationTestMocks.completeProject(...args);
  }
`);
const mockPackagesUrl = moduleUrl(`
  export function claimPackageGateReviewInvitation(...args) {
    return globalThis.__gateInvitationTestMocks.claimPackage(...args);
  }
  export function completePackageGateReviewInvitation(...args) {
    return globalThis.__gateInvitationTestMocks.completePackage(...args);
  }
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: moduleUrl("export {};"), shortCircuit: true };
    }
    if (context.parentURL?.endsWith("/src/lib/gate-review-invitations.ts")) {
      if (specifier === "./email") {
        return { url: mockEmailUrl, shortCircuit: true };
      }
      if (specifier === "./projects") {
        return { url: mockProjectsUrl, shortCircuit: true };
      }
      if (specifier === "./packages") {
        return { url: mockPackagesUrl, shortCircuit: true };
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  canRetryGateReviewInvitation,
  claimGateReviewInvitationAttempt,
  completeGateReviewInvitationAttempt,
  createGateReviewCycle,
  recordGateReviewResponse,
} = await import("../src/lib/gates.ts");
const { sendEmail } = await import("../src/lib/email.ts");
const {
  dispatchPackageGateReviewInvitations,
  dispatchProjectGateReviewInvitations,
} = await import("../src/lib/gate-review-invitations.ts");

test("Gate Review invitations follow approval levels and preserve attempt history", () => {
  const gate = createTestGate();
  const cycle = createGateReviewCycle({
    id: "cycle-1",
    submittedAt: "2026-10-22T10:00:00.000Z",
    submittedBy: { userId: null, displayName: "Project Manager", email: null },
    project: { id: "project-1", projectNumber: "PRJ-001", name: "Test Project" },
    package: null,
    gate,
    stageLabel: "Initiation",
    deliverables: [],
    gateActions: [],
  });
  gate.reviewCycles.push(cycle);
  gate.status = "submitted_for_approval";

  const first = cycle.approvers[0];
  const second = cycle.approvers[1];
  assert.ok(first.invitation);
  assert.equal(second.invitation, null);
  assert.equal(claimGateReviewInvitationAttempt(cycle, second.gateApproverId, {
    attemptId: "early-attempt",
    idempotencyKey: "early-key",
    provider: "resend",
    attemptedAt: "2026-10-22T10:01:00.000Z",
  }), null);

  const failedClaim = claimGateReviewInvitationAttempt(cycle, first.gateApproverId, {
    attemptId: "attempt-1",
    idempotencyKey: "gate-review-invitation/attempt-1",
    provider: "resend",
    attemptedAt: "2026-10-22T10:01:00.000Z",
  });
  assert.ok(failedClaim);
  assert.equal(claimGateReviewInvitationAttempt(cycle, first.gateApproverId, {
    attemptId: "duplicate-attempt",
    idempotencyKey: "duplicate-key",
    provider: "resend",
    attemptedAt: "2026-10-22T10:01:01.000Z",
  }), null);
  assert.equal(completeGateReviewInvitationAttempt(
    cycle,
    first.gateApproverId,
    failedClaim.attempt.id,
    {
      status: "failed",
      error: { code: "provider_rejected", message: "Provider rejected the message." },
    },
    "2026-10-22T10:02:00.000Z",
  ), true);
  assert.equal(gate.status, "submitted_for_approval");
  assert.equal(first.response, null);
  assert.equal(canRetryGateReviewInvitation(cycle, first.gateApproverId), true);

  const retry = claimGateReviewInvitationAttempt(cycle, first.gateApproverId, {
    attemptId: "attempt-2",
    idempotencyKey: "gate-review-invitation/attempt-2",
    provider: "resend",
    attemptedAt: "2026-10-22T10:03:00.000Z",
    allowFailedRetry: true,
  });
  assert.ok(retry);
  assert.equal(completeGateReviewInvitationAttempt(
    cycle,
    first.gateApproverId,
    retry.attempt.id,
    { status: "sent", providerMessageId: "message-1" },
    "2026-10-22T10:04:00.000Z",
  ), true);
  assert.deepEqual(first.invitation.attempts.map((attempt) => attempt.status), [
    "failed",
    "sent",
  ]);
  assert.equal(canRetryGateReviewInvitation(cycle, first.gateApproverId), false);

  const transition = recordGateReviewResponse(gate, {
    reviewCycleId: cycle.id,
    gateApproverId: first.gateApproverId,
    outcome: "approved",
    comment: "Approved.",
  }, "2026-10-22T10:05:00.000Z");
  assert.equal(transition.outcome, "recorded");
  assert.equal(transition.completion, "pending");
  assert.deepEqual(transition.activatedApproverIds, [second.gateApproverId]);
  assert.ok(second.invitation);
});

test("invitation dispatcher deduplicates recipients and records safe results", async () => {
  const previousBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://kaizen.example/";
  const cycle = createDispatchCycle();
  const sentMessages = [];
  const completions = [];
  const claims = [];

  mockState.claimProject = async (_projectId, _gateId, _cycleId, approverId) => {
    claims.push(approverId);
    return approverId === "approver-1" ? claimedInvitation(cycle) : null;
  };
  mockState.sendEmail = async (message) => {
    sentMessages.push(message);
    return { status: "sent", providerMessageId: "resend-message-1" };
  };
  mockState.completeProject = async (...args) => {
    completions.push(args);
    return true;
  };

  try {
    const summary = await dispatchProjectGateReviewInvitations({
      projectId: "project / 1",
      gateId: "gate / 1",
      reviewCycleId: cycle.id,
      gateApproverIds: ["approver-1", "approver-1", "not-eligible"],
    });
    assert.deepEqual(summary, { sent: 1, failed: 0, skipped: 1 });
    assert.deepEqual(claims, ["approver-1", "not-eligible"]);
    assert.equal(completions.length, 1);
    assert.equal(completions[0][5].status, "sent");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, "approver@example.com");
    assert.equal(sentMessages[0].idempotencyKey, "gate-review-invitation/attempt-1");
    assert.match(sentMessages[0].text, /This link opens the frozen Review Cycle/);
    assert.match(sentMessages[0].html, /Hello &lt;Approver&gt;/);
    assert.match(
      sentMessages[0].text,
      /https:\/\/kaizen\.example\/projects\/project%20%2F%201\/gates\/gate%20%2F%201\?reviewCycle=cycle-1#review-cycle-cycle-1/,
    );
  } finally {
    restoreEnvironment("APP_BASE_URL", previousBaseUrl);
  }
});

test("invalid link configuration and failed delivery are recorded without sending", async () => {
  const previousBaseUrl = process.env.APP_BASE_URL;
  const cycle = createDispatchCycle();
  const results = [];
  let sendCount = 0;
  let retryFlag = null;

  process.env.APP_BASE_URL = "file:///tmp/kaizen";
  mockState.claimPackage = async (
    _projectId,
    _packageId,
    _gateId,
    _cycleId,
    _approverId,
    allowFailedRetry,
  ) => {
    retryFlag = allowFailedRetry;
    return claimedInvitation(cycle);
  };
  mockState.sendEmail = async () => {
    sendCount += 1;
    return { status: "sent", providerMessageId: "unexpected" };
  };
  mockState.completePackage = async (
    _projectId,
    _packageId,
    _gateId,
    _cycleId,
    _approverId,
    _attemptId,
    result,
  ) => {
    results.push(result);
    return true;
  };

  try {
    const summary = await dispatchPackageGateReviewInvitations({
      projectId: "project-1",
      packageId: "package-1",
      gateId: "gate-1",
      reviewCycleId: cycle.id,
      gateApproverIds: ["approver-1"],
      retryFailed: true,
    });
    assert.deepEqual(summary, { sent: 0, failed: 1, skipped: 0 });
    assert.equal(retryFlag, true);
    assert.equal(sendCount, 0);
    assert.deepEqual(results, [{
      status: "failed",
      error: {
        code: "app_base_url_invalid",
        message: "APP_BASE_URL must be a credential-free HTTP or HTTPS URL.",
      },
    }]);
  } finally {
    restoreEnvironment("APP_BASE_URL", previousBaseUrl);
  }
});

test("Resend transport validates configuration and never exposes credentials", async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.EMAIL_FROM;
  const previousFetch = globalThis.fetch;
  const message = {
    to: "approver@example.com",
    subject: "Gate Review",
    text: "Review the Gate.",
    html: "<p>Review the Gate.</p>",
    idempotencyKey: "gate-review-invitation/attempt-1",
  };

  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    globalThis.fetch = async () => {
      throw new Error("fetch must not be called without configuration");
    };
    assert.deepEqual(await sendEmail(message), {
      status: "failed",
      error: {
        code: "email_not_configured",
        message: "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
      },
    });

    process.env.RESEND_API_KEY = "test-secret-key";
    process.env.EMAIL_FROM = "Kaizen PM <notifications@example.com>";
    assert.equal((await sendEmail({ ...message, to: "invalid address" })).status, "failed");

    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "resend-message-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    assert.deepEqual(await sendEmail(message), {
      status: "sent",
      providerMessageId: "resend-message-1",
    });
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers.Authorization, "Bearer test-secret-key");
    assert.equal(request.options.headers["Idempotency-Key"], message.idempotencyKey);
    assert.doesNotMatch(request.options.body, /test-secret-key/);
    assert.deepEqual(JSON.parse(request.options.body).to, [message.to]);

    globalThis.fetch = async () => new Response("provider details", { status: 503 });
    const unavailable = await sendEmail(message);
    assert.equal(unavailable.status, "indeterminate");
    assert.doesNotMatch(unavailable.error.message, /provider details|test-secret-key/);

    globalThis.fetch = async () => {
      throw new Error("network details containing test-secret-key");
    };
    const unreachable = await sendEmail(message);
    assert.equal(unreachable.status, "indeterminate");
    assert.doesNotMatch(unreachable.error.message, /test-secret-key/);
  } finally {
    restoreEnvironment("RESEND_API_KEY", previousApiKey);
    restoreEnvironment("EMAIL_FROM", previousFrom);
    globalThis.fetch = previousFetch;
  }
});

function createTestGate() {
  return {
    id: "gate-1",
    templateVersion: 1,
    name: "Baseline Approval",
    stageId: "initiation",
    status: "not_submitted",
    approvers: [
      {
        id: "approver-1",
        name: "First Approver",
        email: "first@example.com",
        roleFunction: "Engineering",
        approvalRole: "Technical Approver",
        approvalLevel: 1,
      },
      {
        id: "approver-2",
        name: "Second Approver",
        email: "second@example.com",
        roleFunction: "Sponsor",
        approvalRole: "Business Approver",
        approvalLevel: 2,
      },
    ],
    reviewCycles: [],
    criteria: [],
  };
}

function createDispatchCycle() {
  return {
    id: "cycle-1",
    cycleNumber: 1,
    project: { projectNumber: "PRJ-001", name: "Project <Alpha>" },
    package: null,
    gate: { name: "Gate <One>" },
    submittedBy: { displayName: "Project Manager", email: null },
    submittedAt: "2026-10-22T10:00:00.000Z",
  };
}

function claimedInvitation(cycle) {
  return {
    reviewCycle: cycle,
    approver: {
      gateApproverId: "approver-1",
      name: "<Approver>",
      email: "approver@example.com",
      approvalRole: "Technical Approver",
      approvalLevel: 1,
    },
    attempt: {
      id: "attempt-1",
      idempotencyKey: "gate-review-invitation/attempt-1",
    },
    claimToken: "claim-token-1",
  };
}

function moduleUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
