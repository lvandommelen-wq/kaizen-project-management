import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGateMatrixReviewState,
  fingerprintMatrixReview,
  getMatrixReviewSubmissionIssues,
  resolveMatrixReviewTarget,
} from "../src/lib/matrix-reviews.ts";

const nextStageTarget = {
  reviewScope: "next_stage",
  targetStageId: "delivery",
  targetStageLabel: "Delivery",
  activeStageIds: ["initiation", "definition_design", "delivery", "closure"],
};

test("matrix fingerprint covers relevant configuration but excludes completion metadata", () => {
  const matrix = sampleMatrix();
  const fingerprint = fingerprintMatrixReview(matrix, nextStageTarget);

  assert.equal(fingerprintMatrixReview({ ...matrix, generatedAt: "later" }, nextStageTarget), fingerprint);
  assert.equal(
    fingerprintMatrixReview(withChangedItem(matrix, "closure", { description: "Changed later" }), nextStageTarget),
    fingerprint,
  );
  assert.notEqual(
    fingerprintMatrixReview(withChangedItem(matrix, "delivery", { description: "Changed acceptance" }), nextStageTarget),
    fingerprint,
  );
  assert.notEqual(
    fingerprintMatrixReview(withChangedItem(matrix, "delivery", { justification: "Changed reason" }), nextStageTarget),
    fingerprint,
  );
  assert.notEqual(
    fingerprintMatrixReview({
      ...matrix,
      gates: matrix.gates.map((gate) => gate.stageId === "delivery"
        ? { ...gate, items: [...gate.items, { ...gate.items[0], itemId: "new-custom-item", source: "custom" }] }
        : gate),
    }, nextStageTarget),
    fingerprint,
  );
});

test("matching confirmations remain valid and mismatches become outdated", () => {
  const matrix = sampleMatrix();
  const matrixFingerprint = fingerprintMatrixReview(matrix, nextStageTarget);
  const confirmation = {
    gateId: "baseline",
    reviewScope: "next_stage",
    targetStageId: "delivery",
    reviewer: { userId: "user-1", displayName: "Reviewer", email: "reviewer@example.com" },
    confirmedAt: "2026-10-23T10:00:00.000Z",
    status: "confirmed",
    matrixFingerprint,
  };
  const confirmed = buildGateMatrixReviewState("baseline", matrix, nextStageTarget, confirmation);
  assert.equal(confirmed.effectiveStatus, "confirmed");
  assert.deepEqual(getMatrixReviewSubmissionIssues(confirmed), []);

  const outdated = buildGateMatrixReviewState(
    "baseline",
    withChangedItem(matrix, "delivery", { applicability: "applicable" }),
    nextStageTarget,
    confirmation,
  );
  assert.equal(outdated.effectiveStatus, "outdated");
  assert.equal(getMatrixReviewSubmissionIssues(outdated)[0].code, "matrix_review_confirmation_required");
});

test("final lifecycle confirmation covers every active Stage", () => {
  const matrix = sampleMatrix();
  const target = {
    reviewScope: "final_lifecycle",
    targetStageId: null,
    targetStageLabel: "Final lifecycle",
    activeStageIds: ["delivery", "closure"],
  };
  const fingerprint = fingerprintMatrixReview(matrix, target);
  assert.notEqual(
    fingerprintMatrixReview(withChangedItem(matrix, "closure", { title: "Renamed closure item" }), target),
    fingerprint,
  );
});

test("target resolution skips disabled Validation and treats Closure as final", () => {
  const lifecycle = ["initiation", "definition_design", "delivery", "closure"];
  assert.equal(
    resolveMatrixReviewTarget("delivery", lifecycle, (stageId) => stageId).targetStageId,
    "closure",
  );
  assert.deepEqual(
    resolveMatrixReviewTarget("closure", lifecycle, (stageId) => stageId),
    {
      reviewScope: "final_lifecycle",
      targetStageId: null,
      targetStageLabel: "Final lifecycle",
      activeStageIds: lifecycle,
    },
  );
});

function sampleMatrix() {
  return {
    scopeLevel: "project",
    scopeId: "project-1",
    generatedAt: "2026-10-23T09:00:00.000Z",
    gates: [
      matrixGate("delivery", "delivery-complete", "Delivery Complete", "Delivery item"),
      matrixGate("closure", "project-closed", "Project Closed", "Closure item"),
    ],
  };
}

function matrixGate(stageId, gateId, gateName, title) {
  return {
    stageId,
    stageLabel: stageId,
    gateId,
    gateName,
    items: [{
      itemType: "deliverable",
      itemId: `${gateId}:item`,
      templateId: "template-item",
      source: "default",
      title,
      description: "Original acceptance",
      applicability: "not_applicable",
      justification: "Not required",
      decidedAt: "2026-10-23T08:00:00.000Z",
      decidedBy: "Earlier reviewer",
    }],
  };
}

function withChangedItem(matrix, stageId, changes) {
  return {
    ...matrix,
    gates: matrix.gates.map((gate) => gate.stageId === stageId
      ? { ...gate, items: gate.items.map((item) => ({ ...item, ...changes })) }
      : gate),
  };
}
