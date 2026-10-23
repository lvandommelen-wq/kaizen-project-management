import assert from "node:assert/strict";
import test from "node:test";
import {
  createGates,
  deriveStageDeliverableProtection,
  getGateSubmissionIssues,
  getScopeApplicabilitySubmissionIssues,
} from "../src/lib/gates.ts";

test("scope-wide applicability requires justification only for new Not Applicable decisions", () => {
  const issues = getScopeApplicabilitySubmissionIssues({
    scopeLabel: "Project",
    items: [
      applicabilityItem("applicable"),
      applicabilityItem("not_applicable", ""),
      { ...applicabilityItem("not_applicable", ""), applicabilityOrigin: "legacy" },
    ],
  });

  assert.deepEqual(issues, [{
    code: "missing_applicability_justification",
    message: "1 Project Not Applicable decision needs a justification. Complete the Project Applicability Review before submitting this Gate.",
  }]);
});

test("Not Applicable items retain completion state but are excluded from readiness", () => {
  const gate = readyGate();
  const deliverables = [readyDeliverable()];
  deliverables[0].status = "in_progress";
  deliverables[0].applicability = "not_applicable";
  deliverables[0].applicabilityJustification = "Covered by another Deliverable.";

  assert.deepEqual(
    getGateSubmissionIssues(gate, deliverables, [], {
      scopeLabel: "Package",
      items: deliverables,
    }),
    [],
  );
});

test("Applicable incomplete items continue to block Gate submission", () => {
  const gate = readyGate();
  const deliverable = readyDeliverable();
  deliverable.status = "in_progress";

  assert.ok(
    getGateSubmissionIssues(gate, [deliverable], [])
      .some((issue) => issue.code === "incomplete_deliverables"),
  );
});

test("new Gates have no active Criteria", () => {
  const gates = createGates("project-1", [{
    id: "authorization",
    templateVersion: 1,
    name: "Authorization",
    stageId: "initiation",
  }]);

  assert.deepEqual(gates[0].criteria, []);
});

test("Stage Deliverable protection distinguishes completed evidence from next-Stage configuration", () => {
  assert.deepEqual(
    deriveStageDeliverableProtection(
      { status: "approved", reapprovalRequired: false },
      null,
    ),
    {
      deliverableConfigurationLocked: true,
      deliverableCompletionLocked: true,
    },
  );
  assert.deepEqual(
    deriveStageDeliverableProtection(
      { status: "not_submitted", reapprovalRequired: false },
      { status: "approved" },
    ),
    {
      deliverableConfigurationLocked: true,
      deliverableCompletionLocked: false,
    },
  );
  assert.deepEqual(
    deriveStageDeliverableProtection(
      { status: "not_submitted", reapprovalRequired: true },
      { status: "approved" },
    ),
    {
      deliverableConfigurationLocked: false,
      deliverableCompletionLocked: false,
    },
  );
  assert.deepEqual(
    deriveStageDeliverableProtection(
      { status: "returned_for_rework", reapprovalRequired: false },
      { status: "approved" },
    ),
    {
      deliverableConfigurationLocked: true,
      deliverableCompletionLocked: false,
    },
  );
  assert.deepEqual(
    deriveStageDeliverableProtection(
      { status: "returned_for_rework", reapprovalRequired: true },
      { status: "approved" },
    ),
    {
      deliverableConfigurationLocked: false,
      deliverableCompletionLocked: false,
    },
  );
  assert.deepEqual(
    deriveStageDeliverableProtection(
      { status: "submitted_for_approval", reapprovalRequired: true },
      { status: "approved" },
    ),
    {
      deliverableConfigurationLocked: true,
      deliverableCompletionLocked: true,
    },
  );
});

test("default Deliverables retain acceptance-requirement validation", () => {
  const deliverable = readyDeliverable();
  deliverable.description = "";
  assert.ok(getGateSubmissionIssues(readyGate(), [deliverable], [])
    .some((issue) => issue.code === "missing_acceptance_requirements"));
});

test("custom Deliverables do not require acceptance requirements", () => {
  const deliverable = readyDeliverable();
  deliverable.templateId = null;
  deliverable.templateVersion = null;
  deliverable.description = "";
  assert.ok(!getGateSubmissionIssues(readyGate(), [deliverable], [])
    .some((issue) => issue.code === "missing_acceptance_requirements"));
});

function applicabilityItem(applicability, applicabilityJustification = null) {
  return {
    applicability,
    applicabilityJustification,
    applicabilityOrigin: "template",
  };
}

function readyGate() {
  return {
    id: "package-1:definition_complete",
    templateVersion: 1,
    name: "Definition Complete",
    stageId: "definition",
    status: "not_submitted",
    approvers: [{
      id: "approver-1",
      name: "Contact-only Approver",
      email: "approver@example.invalid",
      roleFunction: "Sponsor",
      approvalRole: "Approver",
      approvalLevel: 1,
    }],
    reviewCycles: [],
    criteria: [],
  };
}

function readyDeliverable() {
  return {
    id: "deliverable-1",
    templateId: "deliverable-1",
    templateVersion: 1,
    title: "Package definition",
    description: "Accepted when the Package definition is complete.",
    status: "completed",
    applicability: "applicable",
    applicabilityJustification: null,
    applicabilityOrigin: "template",
    criterionIds: [],
  };
}
