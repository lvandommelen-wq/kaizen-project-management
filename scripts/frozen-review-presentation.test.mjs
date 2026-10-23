import assert from "node:assert/strict";
import test from "node:test";

const { projectFrozenGateReviewEvidence } = await import(
  "../src/lib/gate-review-presentation.ts"
);

test("frozen Stage presentation uses only explicitly classified Deliverables", () => {
  const cycle = stageCycle();
  const unchangedEvidence = structuredClone(cycle.frozenEvidence);

  const presentation = projectFrozenGateReviewEvidence(cycle);

  assert.equal(presentation.kind, "stage_transition");
  assert.deepEqual(presentation.currentStageDeliverables, [
    { deliverableId: "current-complete", title: "Completed current Deliverable" },
  ]);
  assert.deepEqual(presentation.nextStageDeliverables, [
    { deliverableId: "next-applicable", title: "Agreed next Deliverable" },
  ]);
  assert.equal(presentation.currentStageLabel, "Definition");
  assert.equal(presentation.reviewedStageLabel, "Design");
  assert.equal(presentation.reviewerName, "Matrix Reviewer");
  assert.equal(presentation.confirmedAt, "2026-10-23T10:00:00.000Z");
  assert.deepEqual(cycle.frozenEvidence, unchangedEvidence);
});

test("legacy Stage evidence is not inferred when current applicability is missing", () => {
  const cycle = stageCycle();
  delete cycle.frozenEvidence.deliverables[0].applicability;

  const presentation = projectFrozenGateReviewEvidence(cycle);

  assert.equal(presentation.kind, "legacy");
  assert.match(presentation.notice, /does not contain enough explicit applicability/i);
});

test("legacy Stage evidence is not inferred when current completion is missing", () => {
  const cycle = stageCycle();
  delete cycle.frozenEvidence.deliverables[0].status;

  assert.equal(projectFrozenGateReviewEvidence(cycle).kind, "legacy");
});

test("legacy Stage evidence is not inferred from undecided next-Stage applicability", () => {
  const cycle = stageCycle();
  cycle.frozenEvidence.applicabilityMatrix.gates[0].items[0].applicability =
    "to_be_determined";

  assert.equal(projectFrozenGateReviewEvidence(cycle).kind, "legacy");
});

test("legacy Stage evidence requires explicit next-Stage item types", () => {
  const cycle = stageCycle();
  delete cycle.frozenEvidence.applicabilityMatrix.gates[0].items[0].itemType;

  assert.equal(projectFrozenGateReviewEvidence(cycle).kind, "legacy");
});

test("legacy Stage evidence requires an explicit matrix confirmation", () => {
  const cycle = stageCycle();
  cycle.frozenEvidence.matrixReviewConfirmation = null;

  assert.equal(projectFrozenGateReviewEvidence(cycle).kind, "legacy");
});

test("Closure presentation contains confirmation attribution without lifecycle items", () => {
  const cycle = stageCycle();
  cycle.gate.stageId = "closure";
  cycle.gate.stageLabel = "Closure";
  cycle.frozenEvidence.matrixReviewConfirmation = {
    ...cycle.frozenEvidence.matrixReviewConfirmation,
    reviewScope: "final_lifecycle",
    targetStageId: null,
    targetStageLabel: "Final lifecycle",
  };

  assert.deepEqual(projectFrozenGateReviewEvidence(cycle), {
    kind: "closure",
    reviewedScopeLabel: "Final lifecycle",
    reviewerName: "Matrix Reviewer",
    confirmedAt: "2026-10-23T10:00:00.000Z",
  });
});

function stageCycle() {
  return {
    schemaVersion: 7,
    id: "cycle-1",
    cycleNumber: 1,
    previousCycleId: null,
    project: { id: "project-1", projectNumber: "PRJ-001", name: "Project" },
    package: null,
    gate: {
      id: "definition-gate",
      name: "Definition Complete",
      stageId: "definition",
      stageLabel: "Definition",
    },
    status: "awaiting_approval",
    submittedAt: "2026-10-23T10:05:00.000Z",
    submittedBy: { userId: "pm-1", displayName: "Project Manager", email: null },
    decision: null,
    decisionComments: "",
    completedAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawalReason: null,
    frozenEvidence: {
      frozenAt: "2026-10-23T10:05:00.000Z",
      criteria: [],
      deliverables: [
        deliverable("current-complete", "Completed current Deliverable", "completed", "applicable"),
        deliverable("current-progress", "Incomplete current Deliverable", "in_progress", "applicable"),
        deliverable("current-na", "N/A current Deliverable", "completed", "not_applicable"),
      ],
      acceptedActions: [],
      documents: [],
      baselines: [],
      applicabilityMatrix: {
        scopeLevel: "project",
        scopeId: "project-1",
        generatedAt: "2026-10-23T10:00:00.000Z",
        gates: [
          {
            stageId: "design",
            stageLabel: "Design",
            gateId: "design-gate",
            gateName: "Design Complete",
            items: [
              matrixItem("next-applicable", "deliverable", "Agreed next Deliverable", "applicable"),
              matrixItem("next-na", "deliverable", "N/A next Deliverable", "not_applicable"),
              matrixItem("legacy-criterion", "criterion", "Legacy Criterion", "applicable"),
            ],
          },
          {
            stageId: "procurement",
            stageLabel: "Procurement",
            gateId: "procurement-gate",
            gateName: "Procurement Complete",
            items: [
              matrixItem("future-applicable", "deliverable", "Unrelated future Deliverable", "applicable"),
            ],
          },
        ],
      },
      matrixReviewConfirmation: {
        gateId: "definition-gate",
        reviewScope: "next_stage",
        targetStageId: "design",
        targetStageLabel: "Design",
        reviewer: {
          userId: "reviewer-1",
          displayName: "Matrix Reviewer",
          email: "reviewer@example.com",
        },
        confirmedAt: "2026-10-23T10:00:00.000Z",
        status: "confirmed",
        matrixFingerprint: "technical-fingerprint",
        applicableCount: 2,
        notApplicableCount: 1,
      },
    },
    approvers: [],
    relatedReworkActionIds: [],
  };
}

function deliverable(deliverableId, title, status, applicability) {
  return {
    deliverableId,
    templateId: null,
    templateVersion: null,
    title,
    description: "Stored acceptance requirements",
    status,
    applicability,
    applicabilityJustification: applicability === "not_applicable" ? "Not required" : null,
    criterionIds: [],
  };
}

function matrixItem(itemId, itemType, title, applicability) {
  return {
    itemType,
    itemId,
    templateId: null,
    source: "custom",
    title,
    description: "Stored acceptance requirements",
    applicability,
    justification: applicability === "not_applicable" ? "Not required" : null,
    decidedAt: "2026-10-23T09:00:00.000Z",
    decidedBy: "Matrix Reviewer",
  };
}
