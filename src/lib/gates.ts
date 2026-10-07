export const gateStatuses = [
  "not_submitted",
  "submitted_for_approval",
  "approved",
  "approved_with_actions",
  "returned_for_rework",
] as const;
export const pmGateDecisions = ["approved", "approved_with_actions"] as const;
export const gateCriterionStatuses = ["pending", "completed", "not_applicable"] as const;
export const gateReviewCycleStatuses = [
  "awaiting_approval",
  "withdrawn",
  "returned_for_rework",
  "approved",
  "approved_with_actions",
] as const;
export const gateReviewApproverResponseOutcomes = ["approved", "returned_for_rework"] as const;
export const gateReviewBaselineTypes = ["scope", "cost", "schedule", "other"] as const;
export const gateReviewCycleSchemaVersion = 2 as const;

export type GateStatus = (typeof gateStatuses)[number];
export type PmGateDecision = (typeof pmGateDecisions)[number];
export type GateCriterionStatus = (typeof gateCriterionStatuses)[number];
export type GateReviewCycleStatus = (typeof gateReviewCycleStatuses)[number];
export type GateReviewApproverResponseOutcome = (typeof gateReviewApproverResponseOutcomes)[number];
export type GateReviewBaselineType = (typeof gateReviewBaselineTypes)[number];

export type GateCriterion = {
  id: string;
  templateId: string | null;
  description: string;
  status: GateCriterionStatus;
};

export type GateApprover = {
  id: string;
  name: string;
  email: string;
  roleFunction: string;
  approvalRole: string;
  approvalLevel: number;
};

export type GateReviewActorSnapshot = {
  userId: string | null;
  displayName: string;
  email: string | null;
};

export type GateReviewProjectSnapshot = {
  id: string;
  projectNumber: string;
  name: string;
};

export type GateReviewPackageSnapshot = {
  id: string;
  packageCode: string;
  name: string;
};

export type GateReviewGateSnapshot = {
  id: string;
  name: string;
  stageId: string;
  stageLabel: string;
};

export type GateReviewCriterionSnapshot = {
  criterionId: string;
  templateId: string | null;
  description: string;
  status: GateCriterionStatus | "satisfied";
};

export type GateReviewDeliverableSnapshot = {
  deliverableId: string;
  templateId: string | null;
  templateVersion: number | null;
  title: string;
  description: string;
  status: "not_started" | "in_progress" | "completed" | "not_applicable";
  criterionIds: string[];
};

export type GateReviewActionSnapshot = {
  actionId: string;
  sequence: number;
  description: string;
  assignee: string;
  dueDate: string | null;
  status: "new" | "in_progress" | "finished" | "closed";
  priority: "low" | "medium" | "high" | "critical" | null;
  packageIds: string[];
};

export type GateReviewDocumentSnapshot = {
  documentId: string;
  title: string;
  engineeringRevision: string | null;
  repositoryItemId: string | null;
  repositoryVersion: string | null;
  repositoryUrl: string | null;
};

export type GateReviewBaselineSnapshot = {
  baselineId: string;
  type: GateReviewBaselineType;
  name: string;
  revision: string | null;
};

export type GateReviewFrozenEvidence = {
  frozenAt: string;
  criteria: GateReviewCriterionSnapshot[];
  deliverables: GateReviewDeliverableSnapshot[];
  acceptedActions: GateReviewActionSnapshot[];
  documents: GateReviewDocumentSnapshot[];
  baselines: GateReviewBaselineSnapshot[];
};

export type GateReviewApproverResponse = {
  outcome: GateReviewApproverResponseOutcome;
  respondedAt: string;
  respondedBy: GateReviewActorSnapshot;
  comment: string;
};

export type GateReviewApproverSnapshot = {
  gateApproverId: string;
  name: string;
  email: string;
  roleFunction: string;
  approvalRole: string;
  approvalLevel: number;
  response: GateReviewApproverResponse | null;
};

export type GateReviewCycle = {
  schemaVersion: typeof gateReviewCycleSchemaVersion;
  id: string;
  cycleNumber: number;
  previousCycleId: string | null;
  project: GateReviewProjectSnapshot;
  package: GateReviewPackageSnapshot | null;
  gate: GateReviewGateSnapshot;
  status: GateReviewCycleStatus;
  submittedAt: string;
  submittedBy: GateReviewActorSnapshot;
  decision: PmGateDecision | null;
  decisionComments: string;
  completedAt: string | null;
  withdrawnAt: string | null;
  withdrawnBy: GateReviewActorSnapshot | null;
  withdrawalReason: string | null;
  frozenEvidence: GateReviewFrozenEvidence;
  approvers: GateReviewApproverSnapshot[];
  relatedReworkActionIds: string[];
};

export type GateSubmissionDeliverable = {
  id: string;
  templateId: string | null;
  templateVersion: number | null;
  title: string;
  description: string;
  status: GateReviewDeliverableSnapshot["status"];
  criterionIds: string[];
};

export type GateSubmissionAction = {
  id: string;
  sequence: number;
  description: string;
  assignee: string;
  dueDate: string | null;
  status: GateReviewActionSnapshot["status"];
  priority: GateReviewActionSnapshot["priority"];
  packageIds: string[];
};

export type GateSubmissionIssue = {
  code:
    | "awaiting_approval"
    | "no_approvers"
    | "invalid_approvers"
    | "invalid_criteria"
    | "incomplete_criteria"
    | "invalid_deliverables"
    | "incomplete_deliverables"
    | "invalid_actions";
  message: string;
};

export type CreateGateReviewCycleInput = {
  id: string;
  submittedAt: string;
  submittedBy: GateReviewActorSnapshot;
  project: GateReviewProjectSnapshot;
  package: GateReviewPackageSnapshot | null;
  gate: Gate;
  stageLabel: string;
  deliverables: GateSubmissionDeliverable[];
  gateActions: GateSubmissionAction[];
};

export type WithdrawGateReviewCycleInput = {
  withdrawnAt: string;
  withdrawnBy: GateReviewActorSnapshot;
  withdrawalReason?: string | null;
};

export type GateReviewResponseInput = {
  reviewCycleId: string;
  gateApproverId: string;
  outcome: GateReviewApproverResponseOutcome;
  comment: string;
};

export type GateReviewApprovalState = {
  activeLevel: number | null;
  approvedCount: number;
  eligibleApprovers: GateReviewApproverSnapshot[];
  totalCount: number;
};

export type GateReviewResponseCompletion =
  | "pending"
  | "returned_for_rework"
  | PmGateDecision;

export type GateReviewResponseTransition =
  | {
      outcome: "recorded";
      reviewCycle: GateReviewCycle;
      completion: GateReviewResponseCompletion;
      acceptedActionIds: string[];
    }
  | { outcome: "not_submitted" }
  | { outcome: "review_cycle_mismatch" }
  | { outcome: "approver_not_found" }
  | { outcome: "already_responded" }
  | { outcome: "not_eligible" }
  | { outcome: "comment_required" };

export type Gate<StageId extends string = string> = {
  id: string;
  templateVersion: number;
  name: string;
  stageId: StageId;
  status: GateStatus;
  approvers: GateApprover[];
  reviewCycles: GateReviewCycle[];
  criteria: GateCriterion[];
};

export type GateCriterionDefinition = {
  id: string;
  description: string;
  previousDescriptions?: readonly string[];
};

export type GateDefinition<StageId extends string> = {
  id: string;
  templateVersion: number;
  name: string;
  stageId: StageId;
  criteria?: GateCriterionDefinition[];
};

export const gateStatusLabels: Record<GateStatus, string> = {
  not_submitted: "Not Submitted",
  submitted_for_approval: "Submitted for Approval",
  approved: "Approved",
  approved_with_actions: "Approved with Actions",
  returned_for_rework: "Returned for Rework",
};

export const gateCriterionStatusLabels: Record<GateCriterionStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  not_applicable: "Not Applicable",
};

export function getGateCriterionStatusLabel(status: GateReviewCriterionSnapshot["status"]) {
  return status === "satisfied" ? "Completed" : gateCriterionStatusLabels[status];
}

export const gateReviewCycleStatusLabels: Record<GateReviewCycleStatus, string> = {
  awaiting_approval: "Submitted for Approval",
  withdrawn: "Withdrawn",
  returned_for_rework: "Returned for Rework",
  approved: "Approved",
  approved_with_actions: "Approved with Actions",
};

export type GateCriterionInput = Omit<GateCriterion, "id" | "templateId">;
export type GateApproverInput = Omit<GateApprover, "id">;

export type GateSubmissionResult<Entity> =
  | { outcome: "submitted"; entity: Entity; reviewCycle: GateReviewCycle }
  | { outcome: "blocked"; issues: GateSubmissionIssue[] }
  | { outcome: "not_in_preparation" }
  | { outcome: "not_current" };

export type GateWithdrawalResult<Entity> =
  | { outcome: "withdrawn"; entity: Entity; reviewCycle: GateReviewCycle }
  | { outcome: "responses_recorded" }
  | { outcome: "not_submitted" }
  | { outcome: "not_current" };

export type GateReviewResponseResult<Entity> =
  | {
      outcome: "recorded";
      entity: Entity;
      reviewCycle: GateReviewCycle;
      completion: GateReviewResponseCompletion;
    }
  | Exclude<GateReviewResponseTransition, { outcome: "recorded" }>
  | { outcome: "accepted_actions_missing" }
  | { outcome: "not_current" };

export function createGates<StageId extends string>(
  scopeId: string,
  definitions: GateDefinition<StageId>[],
): Gate<StageId>[] {
  return definitions.map((definition) => ({
    id: `${scopeId}:${definition.id}`,
    templateVersion: definition.templateVersion,
    name: definition.name,
    stageId: definition.stageId,
    status: "not_submitted",
    approvers: [],
    reviewCycles: [],
    criteria: (definition.criteria ?? []).map((criterion) => ({
      id: `${scopeId}:${definition.id}:${criterion.id}`,
      templateId: criterion.id,
      description: criterion.description,
      status: "pending",
    })),
  }));
}

export function normalizeGates<StageId extends string>(
  scopeId: string,
  gates: Partial<Gate<StageId>>[] | undefined,
  definitions: GateDefinition<StageId>[],
): Gate<StageId>[] {
  return definitions.map((definition) => {
    const id = `${scopeId}:${definition.id}`;
    const existingGate = gates?.find((gate) => gate.id === id || gate.stageId === definition.stageId);
    const existingCriteria = existingGate?.criteria;
    const reviewCycles = normalizeGateReviewCycles(existingGate?.reviewCycles);
    const status = normalizeGateStatus(existingGate?.status, reviewCycles);

    return {
      id,
      templateVersion: definition.templateVersion,
      name: existingGate?.name || definition.name,
      stageId: definition.stageId,
      status,
      approvers: normalizeGateApprovers(id, existingGate?.approvers),
      reviewCycles,
      criteria: normalizeGateCriteria(id, existingCriteria, definition.criteria),
    };
  });
}

export function gatesRequireTemplateUpdate<StageId extends string>(
  scopeId: string,
  gates: Partial<Gate<StageId>>[] | undefined,
  definitions: GateDefinition<StageId>[],
) {
  return definitions.some((definition) => {
    const id = `${scopeId}:${definition.id}`;
    const gate = gates?.find((candidate) => candidate.id === id || candidate.stageId === definition.stageId);

    if (gate?.templateVersion !== definition.templateVersion) {
      return true;
    }

    if (gateApproversRequireUpdate(gate?.approvers)) {
      return true;
    }

    if (!Array.isArray(gate?.reviewCycles)) {
      return true;
    }

    const normalizedReviewCycles = normalizeGateReviewCycles(gate.reviewCycles);
    if (normalizeGateStatus(gate.status, normalizedReviewCycles) !== gate.status) {
      return true;
    }

    if ((gate.criteria ?? []).some((criterion) => (criterion.status as string) === "satisfied")) {
      return true;
    }

    if (
      gate.reviewCycles.some(
        (cycle) =>
          cycle.schemaVersion !== gateReviewCycleSchemaVersion ||
          (cycle.status as string) === "submitted" ||
          !cycle.gate.stageLabel ||
          !("withdrawnAt" in cycle) ||
          !("withdrawnBy" in cycle) ||
          !("withdrawalReason" in cycle),
      )
    ) {
      return true;
    }

    const expectedTemplateIds = new Set((definition.criteria ?? []).map((criterion) => criterion.id));
    const defaultTemplateIds = (gate.criteria ?? [])
      .map((criterion) => criterion.templateId)
      .filter((templateId): templateId is string => templateId != null);

    return (
      defaultTemplateIds.length !== expectedTemplateIds.size ||
      new Set(defaultTemplateIds).size !== defaultTemplateIds.length ||
      defaultTemplateIds.some((templateId) => !expectedTemplateIds.has(templateId))
    );
  });
}

export function parseGateCriterionFormData(formData: FormData): GateCriterionInput {
  const description = String(formData.get("description") ?? "").trim();
  const status = String(formData.get("status") ?? "pending");

  if (!description) {
    throw new Error("Criterion description is required.");
  }

  if (!gateCriterionStatuses.includes(status as GateCriterionStatus)) {
    throw new Error("Invalid Gate Criterion status.");
  }

  return {
    description,
    status: status as GateCriterionStatus,
  };
}

export function parseGateApproverFormData(formData: FormData): GateApproverInput {
  const input = {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    roleFunction: String(formData.get("roleFunction") ?? "").trim(),
    approvalRole: String(formData.get("approvalRole") ?? "").trim(),
  };
  const approvalLevelValue = String(formData.get("approvalLevel") ?? "").trim();
  const approvalLevel = Number(approvalLevelValue);

  if (!input.name || !input.email || !input.roleFunction || !input.approvalRole) {
    throw new Error("Name, email address, role / function, and approval role are required.");
  }

  if (!/^[^\s@]+@[^\s@]+$/.test(input.email)) {
    throw new Error("Enter a valid email address.");
  }

  if (!approvalLevelValue || !Number.isInteger(approvalLevel) || approvalLevel < 1) {
    throw new Error("Approval Level must be a positive integer.");
  }

  return {
    ...input,
    approvalLevel,
  };
}

export function getAwaitingGateReviewCycle(gate: Gate) {
  return [...gate.reviewCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)
    .find((cycle) => cycle.status === "awaiting_approval") ?? null;
}

export function canWithdrawGateReviewCycle(cycle: GateReviewCycle) {
  return cycle.status === "awaiting_approval" && cycle.approvers.every((approver) => approver.response === null);
}

export function withdrawGateReviewCycle(gate: Gate, input: WithdrawGateReviewCycleInput) {
  const reviewCycle = getAwaitingGateReviewCycle(gate);

  if (gate.status !== "submitted_for_approval" || !reviewCycle) {
    return { outcome: "not_submitted" as const };
  }

  if (!canWithdrawGateReviewCycle(reviewCycle)) {
    return { outcome: "responses_recorded" as const };
  }

  reviewCycle.status = "withdrawn";
  reviewCycle.completedAt = input.withdrawnAt;
  reviewCycle.withdrawnAt = input.withdrawnAt;
  reviewCycle.withdrawnBy = { ...input.withdrawnBy };
  reviewCycle.withdrawalReason = input.withdrawalReason ?? null;
  gate.status = "not_submitted";

  return { outcome: "withdrawn" as const, reviewCycle };
}

export function getGateReviewApprovalState(
  cycle: GateReviewCycle,
): GateReviewApprovalState {
  const pendingApprovers = cycle.approvers.filter(
    (approver) => approver.response === null,
  );
  const activeLevel = pendingApprovers.length > 0
    ? Math.min(...pendingApprovers.map((approver) => approver.approvalLevel))
    : null;

  return {
    activeLevel,
    approvedCount: cycle.approvers.filter(
      (approver) => approver.response?.outcome === "approved",
    ).length,
    eligibleApprovers: activeLevel === null
      ? []
      : pendingApprovers.filter(
          (approver) => approver.approvalLevel === activeLevel,
        ),
    totalCount: cycle.approvers.length,
  };
}

export function recordGateReviewResponse(
  gate: Gate,
  input: GateReviewResponseInput,
  respondedAt: string,
): GateReviewResponseTransition {
  const reviewCycle = getAwaitingGateReviewCycle(gate);
  if (gate.status !== "submitted_for_approval" || !reviewCycle) {
    return { outcome: "not_submitted" };
  }
  if (reviewCycle.id !== input.reviewCycleId) {
    return { outcome: "review_cycle_mismatch" };
  }

  const approver = reviewCycle.approvers.find(
    (candidate) => candidate.gateApproverId === input.gateApproverId,
  );
  if (!approver) {
    return { outcome: "approver_not_found" };
  }
  if (approver.response) {
    return { outcome: "already_responded" };
  }

  const approvalState = getGateReviewApprovalState(reviewCycle);
  if (approver.approvalLevel !== approvalState.activeLevel) {
    return { outcome: "not_eligible" };
  }

  const comment = input.comment.trim();
  if (input.outcome === "returned_for_rework" && !comment) {
    return { outcome: "comment_required" };
  }

  approver.response = {
    outcome: input.outcome,
    respondedAt,
    respondedBy: {
      userId: null,
      displayName: approver.name,
      email: approver.email,
    },
    comment,
  };

  if (input.outcome === "returned_for_rework") {
    reviewCycle.status = "returned_for_rework";
    reviewCycle.decision = null;
    reviewCycle.decisionComments = comment;
    reviewCycle.completedAt = respondedAt;
    gate.status = "returned_for_rework";
    return {
      outcome: "recorded",
      reviewCycle,
      completion: "returned_for_rework",
      acceptedActionIds: [],
    };
  }

  const nextState = getGateReviewApprovalState(reviewCycle);
  if (nextState.eligibleApprovers.length > 0) {
    return {
      outcome: "recorded",
      reviewCycle,
      completion: "pending",
      acceptedActionIds: [],
    };
  }

  const acceptedActionIds = reviewCycle.frozenEvidence.acceptedActions
    .filter((action) => action.status !== "closed")
    .map((action) => action.actionId);
  const decision: PmGateDecision = acceptedActionIds.length > 0
    ? "approved_with_actions"
    : "approved";
  reviewCycle.status = decision;
  reviewCycle.decision = decision;
  reviewCycle.completedAt = respondedAt;
  gate.status = decision;

  return {
    outcome: "recorded",
    reviewCycle,
    completion: decision,
    acceptedActionIds,
  };
}

export function isGateInPreparation(gate: Gate) {
  return (
    (gate.status === "not_submitted" || gate.status === "returned_for_rework") &&
    getAwaitingGateReviewCycle(gate) === null
  );
}

export function getGateSubmissionIssues(
  gate: Gate,
  deliverables: GateSubmissionDeliverable[],
  gateActions: GateSubmissionAction[],
): GateSubmissionIssue[] {
  const issues: GateSubmissionIssue[] = [];

  if (getAwaitingGateReviewCycle(gate)) {
    issues.push({
      code: "awaiting_approval",
      message: "This Gate already has a Review Cycle submitted for approval.",
    });
  }

  if (gate.approvers.length === 0) {
    issues.push({
      code: "no_approvers",
      message: "Add at least one Gate Approver before submission.",
    });
  } else if (
    gate.approvers.some(
      (approver) =>
        !approver.id ||
        !approver.name.trim() ||
        !approver.email.trim() ||
        !/^[^\s@]+@[^\s@]+$/.test(approver.email) ||
        !approver.roleFunction.trim() ||
        !approver.approvalRole.trim() ||
        !Number.isInteger(approver.approvalLevel) ||
        approver.approvalLevel < 1,
    )
  ) {
    issues.push({
      code: "invalid_approvers",
      message: "Every Approver must have valid identity details, an Approval Role, and a positive Approval Level.",
    });
  }

  if (gate.criteria.some((criterion) => !gateCriterionStatuses.includes(criterion.status))) {
    issues.push({
      code: "invalid_criteria",
      message: "One or more Gate Criteria have an invalid status.",
    });
  }

  const incompleteCriteria = gate.criteria.filter(
    (criterion) => criterion.status !== "completed" && criterion.status !== "not_applicable",
  );
  if (incompleteCriteria.length > 0) {
    issues.push({
      code: "incomplete_criteria",
      message: `${incompleteCriteria.length} Gate ${incompleteCriteria.length === 1 ? "Criterion is" : "Criteria are"} still pending.`,
    });
  }

  const validDeliverableStatuses = new Set<GateReviewDeliverableSnapshot["status"]>([
    "not_started",
    "in_progress",
    "completed",
    "not_applicable",
  ]);
  if (deliverables.some((deliverable) => !validDeliverableStatuses.has(deliverable.status))) {
    issues.push({
      code: "invalid_deliverables",
      message: "One or more Deliverables have an invalid status.",
    });
  }

  const incompleteDeliverables = deliverables.filter(
    (deliverable) => deliverable.status !== "completed" && deliverable.status !== "not_applicable",
  );
  if (incompleteDeliverables.length > 0) {
    issues.push({
      code: "incomplete_deliverables",
      message: `${incompleteDeliverables.length} ${incompleteDeliverables.length === 1 ? "Deliverable is" : "Deliverables are"} incomplete.`,
    });
  }

  const invalidOpenActions = gateActions.filter(
    (action) =>
      action.status !== "closed" &&
      (!action.description.trim() || !action.assignee.trim() || !action.dueDate),
  );
  if (invalidOpenActions.length > 0) {
    issues.push({
      code: "invalid_actions",
      message: `${invalidOpenActions.length} open Gate ${invalidOpenActions.length === 1 ? "Action needs" : "Actions need"} a description, assignee, and due date.`,
    });
  }

  return issues;
}

export function createGateReviewCycle(input: CreateGateReviewCycleInput): GateReviewCycle {
  const previousCycle = [...input.gate.reviewCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)[0] ?? null;
  const cycleNumber = (previousCycle?.cycleNumber ?? 0) + 1;

  return {
    schemaVersion: gateReviewCycleSchemaVersion,
    id: input.id,
    cycleNumber,
    previousCycleId: previousCycle?.id ?? null,
    project: { ...input.project },
    package: input.package ? { ...input.package } : null,
    gate: {
      id: input.gate.id,
      name: input.gate.name,
      stageId: input.gate.stageId,
      stageLabel: input.stageLabel,
    },
    status: "awaiting_approval",
    submittedAt: input.submittedAt,
    submittedBy: { ...input.submittedBy },
    decision: null,
    decisionComments: "",
    completedAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawalReason: null,
    frozenEvidence: {
      frozenAt: input.submittedAt,
      criteria: input.gate.criteria.map((criterion) => ({
        criterionId: criterion.id,
        templateId: criterion.templateId,
        description: criterion.description,
        status: criterion.status,
      })),
      deliverables: input.deliverables.map((deliverable) => ({
        deliverableId: deliverable.id,
        templateId: deliverable.templateId,
        templateVersion: deliverable.templateVersion,
        title: deliverable.title,
        description: deliverable.description,
        status: deliverable.status,
        criterionIds: [...deliverable.criterionIds],
      })),
      acceptedActions: input.gateActions
        .filter((action) => action.status !== "closed")
        .map((action) => ({
          actionId: action.id,
          sequence: action.sequence,
          description: action.description,
          assignee: action.assignee,
          dueDate: action.dueDate,
          status: action.status,
          priority: action.priority,
          packageIds: [...action.packageIds],
        })),
      documents: [],
      baselines: [],
    },
    approvers: input.gate.approvers.map((approver) => ({
      gateApproverId: approver.id,
      name: approver.name,
      email: approver.email,
      roleFunction: approver.roleFunction,
      approvalRole: approver.approvalRole,
      approvalLevel: approver.approvalLevel,
      response: null,
    })),
    relatedReworkActionIds: [],
  };
}

function normalizeGateCriteria(
  gateId: string,
  criteria: Partial<GateCriterion>[] | undefined,
  definitions: GateCriterionDefinition[] = [],
) {
  const matchedCriterionIds = new Set<string>();
  const templateCriteria = definitions.map((definition) => {
    const id = `${gateId}:${definition.id}`;
    const existingCriterion = criteria?.find(
      (criterion) =>
        criterion.templateId === definition.id ||
        (criterion.templateId != null && criterion.id === id),
    );

    if (existingCriterion?.id) {
      matchedCriterionIds.add(existingCriterion.id);
    }

    return normalizeGateCriterion(
      existingCriterion,
      existingCriterion?.id || id,
      definition.description,
      definition.id,
      definition.previousDescriptions,
    );
  });
  const templateIds = new Set(templateCriteria.map((criterion) => criterion.id));
  const customCriteria = (criteria ?? [])
    .filter(
      (criterion) =>
        criterion.id &&
        criterion.templateId == null &&
        !templateIds.has(criterion.id) &&
        !matchedCriterionIds.has(criterion.id),
    )
    .map((criterion) =>
      normalizeGateCriterion(
        criterion,
        criterion.id as string,
        criterion.description ?? "",
        criterion.templateId ?? null,
      ),
    )
    .filter((criterion) => criterion.description);

  return [...templateCriteria, ...customCriteria];
}

function normalizeGateApprovers(
  gateId: string,
  approvers: Partial<GateApprover>[] | undefined,
): GateApprover[] {
  const ids = new Set<string>();

  return (approvers ?? []).map((approver, index) => {
    const storedId = approver.id?.trim();
    const fallbackId = `${gateId}:approver:${index + 1}`;
    let id = storedId || fallbackId;
    let suffix = 1;

    while (ids.has(id)) {
      id = `${fallbackId}:${suffix}`;
      suffix += 1;
    }

    ids.add(id);

    return {
      id,
      name: approver.name?.trim() ?? "",
      email: approver.email?.trim() ?? "",
      roleFunction: approver.roleFunction?.trim() ?? "",
      approvalRole: approver.approvalRole?.trim() ?? "",
      approvalLevel:
        typeof approver.approvalLevel === "number" &&
        Number.isInteger(approver.approvalLevel) &&
        approver.approvalLevel > 0
          ? approver.approvalLevel
          : 1,
    };
  });
}

function gateApproversRequireUpdate(approvers: Partial<GateApprover>[] | undefined) {
  return (approvers ?? []).some((approver) => {
    const stored = approver as Partial<GateApprover> & { required?: unknown };

    return (
      "required" in stored ||
      typeof stored.approvalLevel !== "number" ||
      !Number.isInteger(stored.approvalLevel) ||
      stored.approvalLevel < 1
    );
  });
}

function normalizeGateReviewCycles(reviewCycles: GateReviewCycle[] | undefined) {
  if (!Array.isArray(reviewCycles)) return [];

  return reviewCycles.map((cycle) => ({
    ...cycle,
    schemaVersion: gateReviewCycleSchemaVersion,
    status:
      (cycle.status as string) === "submitted"
        ? "awaiting_approval" as const
        : cycle.status,
    withdrawnAt: cycle.withdrawnAt ?? null,
    withdrawnBy: cycle.withdrawnBy ? { ...cycle.withdrawnBy } : null,
    withdrawalReason: cycle.withdrawalReason ?? null,
    gate: {
      ...cycle.gate,
      stageLabel: cycle.gate.stageLabel || cycle.gate.stageId,
    },
  }));
}

function normalizeGateStatus(
  status: GateStatus | undefined,
  reviewCycles: GateReviewCycle[],
): GateStatus {
  if (status === "approved" || status === "approved_with_actions") {
    return status;
  }

  const latestCycle = [...reviewCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)[0];

  if (latestCycle?.status === "awaiting_approval") {
    return "submitted_for_approval";
  }

  if (latestCycle?.status === "returned_for_rework") {
    return "returned_for_rework";
  }

  if (latestCycle?.status === "withdrawn") {
    return "not_submitted";
  }

  if ((status as string) === "rejected_rework") {
    return "returned_for_rework";
  }

  if ((status as string) === "not_reviewed") {
    return "not_submitted";
  }

  return gateStatuses.includes(status as GateStatus) ? (status as GateStatus) : "not_submitted";
}

function normalizeGateCriterion(
  criterion: Partial<GateCriterion> | undefined,
  id: string,
  defaultDescription: string,
  templateId: string | null,
  previousDescriptions: readonly string[] = [],
): GateCriterion {
  const storedStatus = criterion?.status as string | undefined;
  const status = storedStatus === "satisfied"
    ? "completed"
    : gateCriterionStatuses.includes(storedStatus as GateCriterionStatus)
      ? (storedStatus as GateCriterionStatus)
      : "pending";

  return {
    id,
    templateId,
    description: previousDescriptions.includes(criterion?.description?.trim() ?? "")
      ? defaultDescription
      : criterion?.description?.trim() || defaultDescription,
    status,
  };
}
