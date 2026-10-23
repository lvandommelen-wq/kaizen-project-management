import assert from "node:assert/strict";
import test from "node:test";
import { createGates } from "../src/lib/gates.ts";
import {
  getProjectGateTemplates,
  packageGateTemplates,
  projectGateTemplates,
} from "../src/lib/governance-templates.ts";

test("Deliverables-only templates contain exactly 52 Project and 42 Package defaults", () => {
  assert.deepEqual(
    projectGateTemplates.map((gate) => gate.deliverables.length),
    [7, 18, 12, 7, 8],
  );
  assert.deepEqual(
    packageGateTemplates.map((gate) => gate.deliverables.length),
    [9, 7, 4, 17, 5],
  );
  assert.equal(projectGateTemplates.flatMap((gate) => gate.deliverables).length, 52);
  assert.equal(packageGateTemplates.flatMap((gate) => gate.deliverables).length, 42);
});

test("Project Site Organization & EHS Plan is ordered after Project Governance", () => {
  const baseline = projectGateTemplates.find((gate) => gate.id === "project_baseline_approval");
  assert.ok(baseline);
  const governanceIndex = baseline.deliverables.findIndex(
    (deliverable) => deliverable.id === "project_governance_escalation_plan",
  );
  const sitePlan = baseline.deliverables[governanceIndex + 1];
  assert.equal(sitePlan?.id, "project_site_organization_ehs_plan");
  assert.equal(sitePlan?.title, "Project Site Organization & EHS Plan");
  assert.equal(sitePlan?.applicabilityLocked, false);
  assert.equal(
    packageGateTemplates.flatMap((gate) => gate.deliverables)
      .some((deliverable) => deliverable.id === "project_site_organization_ehs_plan"),
    false,
  );
});

test("all default Deliverables have acceptance requirements and no active Criteria", () => {
  const templates = [...projectGateTemplates, ...packageGateTemplates];
  assert.ok(templates.flatMap((gate) => gate.deliverables)
    .every((deliverable) => deliverable.description.trim().length > 0));

  const gates = createGates("methodology-test", templates);
  assert.ok(gates.every((gate) => gate.criteria.length === 0));
});

test("RTM remains Applicable without Validation and both matrices are locked", () => {
  const projectTemplatesWithoutValidation = getProjectGateTemplates(false);
  assert.equal(
    projectTemplatesWithoutValidation.some((gate) => gate.stageId === "validation"),
    false,
  );

  const projectRtm = projectTemplatesWithoutValidation
    .flatMap((gate) => gate.deliverables)
    .find((deliverable) => deliverable.id === "initial_traceability_structure");
  assert.ok(projectRtm);

  const projectMatrix = projectTemplatesWithoutValidation
    .flatMap((gate) => gate.deliverables)
    .find((deliverable) => deliverable.id === "project_stage_gate_applicability_matrix");
  const packageMatrix = packageGateTemplates
    .flatMap((gate) => gate.deliverables)
    .find((deliverable) => deliverable.id === "package_stage_gate_applicability_matrix");
  assert.equal(projectMatrix?.applicabilityLocked, true);
  assert.equal(packageMatrix?.applicabilityLocked, true);

  const projectGates = createGates("project-methodology-test", projectTemplatesWithoutValidation);
  const packageGates = createGates("package-methodology-test", packageGateTemplates);
  assert.equal(projectGates.length, 4);
  assert.equal(packageGates.length, 5);
  assert.ok(projectGates.every((gate) => gate.criteria.length === 0));
  assert.ok(packageGates.every((gate) => gate.criteria.length === 0));
});
