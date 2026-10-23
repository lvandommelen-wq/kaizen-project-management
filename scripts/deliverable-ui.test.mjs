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
const frozenEvidencePath = new URL(
  "../src/app/_components/frozen-gate-review-evidence.tsx",
  import.meta.url,
);
const assignedReviewPath = new URL(
  "../src/app/reviews/[reviewCycleId]/page.tsx",
  import.meta.url,
);
const otpReviewPath = new URL(
  "../src/app/reviews/access/[reviewAccessId]/page.tsx",
  import.meta.url,
);
const projectsPagePath = new URL("../src/app/projects/page.tsx", import.meta.url);

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

test("completed Stage UI is read-only while active next-Stage completion remains editable", async () => {
  const [gateDetail, applicabilityReview] = await Promise.all([
    readFile(gateDetailPath, "utf8"),
    readFile(applicabilityReviewPath, "utf8"),
  ]);

  assert.match(applicabilityReview, /gate\.deliverableCompletionLocked/);
  assert.match(applicabilityReview, /View Stage Deliverables/);
  assert.match(applicabilityReview, /configuration and completion evidence are protected/);
  assert.match(gateDetail, /!gate\.deliverableCompletionLocked/);
  assert.match(gateDetail, /execution completion remains editable/);
  assert.match(gateDetail, /configurationLocked=\{gate\.deliverableConfigurationLocked\}/);
});

test("all frozen Review surfaces use the shared concise renderer", async () => {
  const [gateDetail, assignedReview, otpReview, frozenEvidence] = await Promise.all([
    readFile(gateDetailPath, "utf8"),
    readFile(assignedReviewPath, "utf8"),
    readFile(otpReviewPath, "utf8"),
    readFile(frozenEvidencePath, "utf8"),
  ]);

  assert.match(gateDetail, /<FrozenGateReviewEvidence cycle=\{cycle\}/);
  assert.match(assignedReview, /<FrozenGateReviewEvidence cycle=\{cycle\}/);
  assert.match(otpReview, /<FrozenGateReviewEvidence cycle=\{cycle\}/);
  assert.match(frozenEvidence, /Current Stage — Completed Deliverables/);
  assert.match(frozenEvidence, /Next Stage — Agreed Deliverables/);
  assert.match(frozenEvidence, /Final Applicability Matrix — Confirmed/);
  assert.match(frozenEvidence, /Legacy frozen evidence/);
  assert.doesNotMatch(frozenEvidence, /acceptance requirements/i);
  assert.doesNotMatch(frozenEvidence, /fingerprint/i);
  assert.doesNotMatch(assignedReview, /acceptance requirements|fingerprint/i);
  assert.doesNotMatch(otpReview, /acceptance requirements|fingerprint/i);
});

test("Package navigation and Deliverable status colors follow 19A.3C", async () => {
  const [projectsPage, gateDetail, applicabilityReview] = await Promise.all([
    readFile(projectsPagePath, "utf8"),
    readFile(gateDetailPath, "utf8"),
    readFile(applicabilityReviewPath, "utf8"),
  ]);

  assert.match(projectsPage, /label: "Open package"/);
  assert.match(projectsPage, /label: "Action Register"/);
  assert.match(gateDetail, /deliverable\.applicability === "not_applicable"/);
  assert.match(gateDetail, /return "status-not_assessed"/);
  assert.match(gateDetail, /return "status-amber"/);
  assert.match(gateDetail, /return "status-green"/);
  assert.match(applicabilityReview, /applicabilityItemClass/);
  assert.match(applicabilityReview, /applicabilityItemStatusClass/);
});
