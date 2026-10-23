import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gateDetailPath = new URL(
  "../src/app/projects/_components/gate-detail.tsx",
  import.meta.url,
);
const applicabilityReviewPath = new URL(
  "../src/app/projects/_components/applicability-review.tsx",
  import.meta.url,
);
const applicabilityActionsPath = new URL(
  "../src/app/projects/applicability-actions.ts",
  import.meta.url,
);
const matrixReviewsPath = new URL("../src/lib/matrix-reviews.ts", import.meta.url);

test("active Deliverable UI omits acceptance requirements", async () => {
  const [gateDetail, applicabilityReview, applicabilityActions] = await Promise.all([
    readFile(gateDetailPath, "utf8"),
    readFile(applicabilityReviewPath, "utf8"),
    readFile(applicabilityActionsPath, "utf8"),
  ]);
  const deliverableForm = gateDetail.slice(
    gateDetail.indexOf("function DeliverableForm"),
    gateDetail.indexOf("function GateActionForm"),
  );

  assert.doesNotMatch(gateDetail, /acceptance requirements/i);
  assert.doesNotMatch(deliverableForm, /name="description"/);
  assert.doesNotMatch(applicabilityReview, /acceptance requirements/i);
  assert.doesNotMatch(applicabilityReview, /name="description"/);
  assert.doesNotMatch(applicabilityActions, /formData\.get\("description"\)/);
});

test("matrix fingerprints retain stored acceptance metadata", async () => {
  const matrixReviews = await readFile(matrixReviewsPath, "utf8");
  assert.match(matrixReviews, /description: item\.description/);
});

test("Stage Review navigation uses consistent generic terminology", async () => {
  const [gateDetail, applicabilityReview] = await Promise.all([
    readFile(gateDetailPath, "utf8"),
    readFile(applicabilityReviewPath, "utf8"),
  ]);

  assert.match(gateDetail, /"Review Next Stage Deliverables"/);
  assert.match(gateDetail, /"Confirm Next Stage Deliverables"/);
  assert.match(gateDetail, /"Review Final Applicability Matrix"/);
  assert.match(gateDetail, /"Confirm Final Applicability Matrix"/);
  assert.match(gateDetail, /\?review=final_lifecycle/);
  assert.match(applicabilityReview, /Reviewing Stage: \{reviewedStageLabel\}/);
  assert.match(applicabilityReview, /Reviewing Scope: Complete active lifecycle matrix/);
});
