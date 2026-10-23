import type {
  GateReviewCycle,
  GateReviewDeliverableSnapshot,
} from "./gates";

type PresentedDeliverable = Pick<GateReviewDeliverableSnapshot, "deliverableId" | "title">;

export type FrozenGateReviewPresentation =
  | {
      kind: "stage_transition";
      currentStageLabel: string;
      reviewedStageLabel: string;
      reviewerName: string;
      confirmedAt: string;
      currentStageDeliverables: PresentedDeliverable[];
      nextStageDeliverables: PresentedDeliverable[];
    }
  | {
      kind: "closure";
      reviewedScopeLabel: string;
      reviewerName: string;
      confirmedAt: string;
    }
  | {
      kind: "legacy";
      notice: string;
    };

const legacyEvidenceNotice =
  "This historical Review Cycle does not contain enough explicit applicability and confirmation evidence to classify its completed and agreed Deliverables reliably.";

export function projectFrozenGateReviewEvidence(
  cycle: GateReviewCycle,
): FrozenGateReviewPresentation {
  const confirmation = cycle.frozenEvidence.matrixReviewConfirmation;
  const isClosure = cycle.gate.stageId === "closure"
    || confirmation?.reviewScope === "final_lifecycle";

  if (isClosure) {
    if (
      confirmation?.reviewScope !== "final_lifecycle"
      || !hasConfirmationAttribution(confirmation)
    ) {
      return legacyPresentation();
    }

    return {
      kind: "closure",
      reviewedScopeLabel: confirmation.targetStageLabel,
      reviewerName: confirmation.reviewer.displayName,
      confirmedAt: confirmation.confirmedAt,
    };
  }

  const matrix = cycle.frozenEvidence.applicabilityMatrix;
  if (
    confirmation?.reviewScope !== "next_stage"
    || !confirmation.targetStageId
    || !hasConfirmationAttribution(confirmation)
    || !matrix
    || !hasText(cycle.gate.stageLabel)
  ) {
    return legacyPresentation();
  }

  const reviewedGates = matrix.gates.filter(
    (gate) => gate.stageId === confirmation.targetStageId,
  );
  if (reviewedGates.length === 0) return legacyPresentation();

  const currentDeliverablesAreClassifiable = cycle.frozenEvidence.deliverables.every(
    (deliverable) =>
      (deliverable.applicability === "applicable"
        || deliverable.applicability === "not_applicable")
      && (
        deliverable.status === "not_started"
        || deliverable.status === "in_progress"
        || deliverable.status === "completed"
        || deliverable.status === "not_applicable"
      ),
  );
  const reviewedItems = reviewedGates.flatMap((gate) => gate.items);
  const nextDeliverablesAreClassifiable = reviewedItems.every((item) =>
    (item.itemType === "criterion" || item.itemType === "deliverable")
    && (item.itemType !== "deliverable"
      || item.applicability === "applicable"
      || item.applicability === "not_applicable"));

  if (!currentDeliverablesAreClassifiable || !nextDeliverablesAreClassifiable) {
    return legacyPresentation();
  }

  return {
    kind: "stage_transition",
    currentStageLabel: cycle.gate.stageLabel,
    reviewedStageLabel: confirmation.targetStageLabel,
    reviewerName: confirmation.reviewer.displayName,
    confirmedAt: confirmation.confirmedAt,
    currentStageDeliverables: cycle.frozenEvidence.deliverables
      .filter((deliverable) =>
        deliverable.applicability === "applicable"
        && deliverable.status === "completed")
      .map(toPresentedDeliverable),
    nextStageDeliverables: reviewedItems
      .filter((item) =>
        item.itemType === "deliverable"
        && item.applicability === "applicable")
      .map((item) => ({
        deliverableId: item.itemId,
        title: item.title,
      })),
  };
}

function hasConfirmationAttribution(confirmation: {
  status: string;
  targetStageLabel: string;
  reviewer: { displayName: string };
  confirmedAt: string;
}) {
  return confirmation.status === "confirmed"
    && hasText(confirmation.targetStageLabel)
    && hasText(confirmation.reviewer?.displayName)
    && hasText(confirmation.confirmedAt)
    && !Number.isNaN(new Date(confirmation.confirmedAt).getTime());
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function legacyPresentation(): FrozenGateReviewPresentation {
  return { kind: "legacy", notice: legacyEvidenceNotice };
}

function toPresentedDeliverable(
  deliverable: GateReviewDeliverableSnapshot,
): PresentedDeliverable {
  return {
    deliverableId: deliverable.deliverableId,
    title: deliverable.title,
  };
}
