import { createHash } from "node:crypto";
import type {
  ApplicabilityMatrixGateSnapshot,
  ApplicabilityMatrixSnapshot,
  GateReviewActorSnapshot,
  GateSubmissionIssue,
} from "./gates";

export type MatrixReviewScope = "next_stage" | "final_lifecycle";
export type MatrixReviewEffectiveStatus = "not_confirmed" | "confirmed" | "outdated";

export type MatrixReviewTarget = {
  reviewScope: MatrixReviewScope;
  targetStageId: string | null;
  targetStageLabel: string;
  activeStageIds: string[];
};

export type MatrixReviewConfirmation = {
  gateId: string;
  reviewScope: MatrixReviewScope;
  targetStageId: string | null;
  targetStageLabel: string;
  reviewer: GateReviewActorSnapshot;
  confirmedAt: string;
  status: "confirmed";
  matrixFingerprint: string;
  applicableCount: number;
  notApplicableCount: number;
};

export type GateMatrixReviewState = {
  target: MatrixReviewTarget;
  matrixFingerprint: string;
  applicableCount: number;
  notApplicableCount: number;
  effectiveStatus: MatrixReviewEffectiveStatus;
  confirmation: MatrixReviewConfirmation | null;
};

export function resolveMatrixReviewTarget(
  gateStageId: string,
  activeStageIds: string[],
  stageLabel: (stageId: string) => string,
): MatrixReviewTarget {
  if (gateStageId === "closure") {
    return {
      reviewScope: "final_lifecycle",
      targetStageId: null,
      targetStageLabel: "Final lifecycle",
      activeStageIds,
    };
  }

  const nextStageId = activeStageIds[activeStageIds.indexOf(gateStageId) + 1] ?? null;
  if (!nextStageId) {
    throw new Error("The next applicable Stage could not be determined for this Gate.");
  }
  return {
    reviewScope: "next_stage",
    targetStageId: nextStageId,
    targetStageLabel: stageLabel(nextStageId),
    activeStageIds,
  };
}

export function buildGateMatrixReviewState(
  gateId: string,
  matrix: ApplicabilityMatrixSnapshot,
  target: MatrixReviewTarget,
  confirmation: Omit<MatrixReviewConfirmation, "targetStageLabel" | "applicableCount" | "notApplicableCount"> | null,
): GateMatrixReviewState {
  const reviewedGates = selectReviewedMatrixGates(matrix, target);
  const matrixFingerprint = fingerprintMatrixReview(matrix, target);
  const items = reviewedGates.flatMap((gate) => gate.items);
  const applicableCount = items.filter((item) => item.applicability === "applicable").length;
  const notApplicableCount = items.filter(
    (item) => item.applicability === "not_applicable",
  ).length;
  const targetMatches = confirmation !== null &&
    confirmation.gateId === gateId &&
    confirmation.reviewScope === target.reviewScope &&
    confirmation.targetStageId === target.targetStageId;
  const effectiveStatus: MatrixReviewEffectiveStatus = confirmation === null
    ? "not_confirmed"
    : targetMatches && confirmation.matrixFingerprint === matrixFingerprint
      ? "confirmed"
      : "outdated";

  return {
    target,
    matrixFingerprint,
    applicableCount,
    notApplicableCount,
    effectiveStatus,
    confirmation: confirmation
      ? {
          ...confirmation,
          targetStageLabel: target.targetStageLabel,
          applicableCount,
          notApplicableCount,
        }
      : null,
  };
}

export function fingerprintMatrixReview(
  matrix: ApplicabilityMatrixSnapshot,
  target: MatrixReviewTarget,
) {
  const canonical = {
    scopeLevel: matrix.scopeLevel,
    scopeId: matrix.scopeId,
    reviewScope: target.reviewScope,
    targetStageId: target.targetStageId,
    gates: selectReviewedMatrixGates(matrix, target).map((gate) => ({
      stageId: gate.stageId,
      gateId: gate.gateId,
      items: [...gate.items]
        .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0)
        .map((item) => ({
          itemId: item.itemId,
          templateId: item.templateId,
          source: item.source,
          title: item.title,
          description: item.description,
          applicability: item.applicability,
          justification: item.justification,
        })),
    })),
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function selectReviewedMatrixGates(
  matrix: ApplicabilityMatrixSnapshot,
  target: MatrixReviewTarget,
): ApplicabilityMatrixGateSnapshot[] {
  if (target.reviewScope === "next_stage") {
    return matrix.gates.filter((gate) => gate.stageId === target.targetStageId);
  }

  const activeStageOrder = new Map(
    target.activeStageIds.map((stageId, index) => [stageId, index]),
  );
  return matrix.gates
    .filter((gate) => activeStageOrder.has(gate.stageId))
    .sort(
      (left, right) =>
        (activeStageOrder.get(left.stageId) ?? 0) -
        (activeStageOrder.get(right.stageId) ?? 0),
    );
}

export function getMatrixReviewSubmissionIssues(
  state: GateMatrixReviewState,
): GateSubmissionIssue[] {
  if (state.effectiveStatus === "confirmed") return [];

  return [{
    code: "matrix_review_confirmation_required",
    message: state.effectiveStatus === "outdated"
      ? `The ${state.target.targetStageLabel} Applicability Matrix review is outdated. Review and confirm it again before submission.`
      : `Confirm the ${state.target.targetStageLabel} Applicability Matrix review before submission.`,
  }];
}
