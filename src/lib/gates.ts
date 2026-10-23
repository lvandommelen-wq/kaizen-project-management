export const gateStatuses = [
  "not_submitted",
  "submitted_for_approval",
  "approved",
  "approved_with_actions",
  "returned_for_rework",
] as const;
export const pmGateDecisions = ["approved", "approved_with_actions"] as const;
export const gateCriterionStatuses = ["pending", "completed"] as const;
export const applicabilityValues = ["applicable", "not_applicable"] as const;
export const historicalApplicabilityValues = [
  ...applicabilityValues,
  "to_be_determined",
] as const;
export const gateReviewCycleStatuses = [
  "awaiting_approval",
  "withdrawn",
  "returned_for_rework",
  "approved",
  "approved_with_actions",
] as const;
export const gateReviewApproverResponseOutcomes = ["approved", "returned_for_rework"] as const;
export const gateReviewInvitationAttemptStatuses = [
  "dispatching",
  "sent",
  "failed",
  "indeterminate",
] as const;
export const gateReviewBaselineTypes = ["scope", "cost", "schedule", "other"] as const;
export const gateReviewCycleSchemaVersion = 7 as const;

export type GateStatus = (typeof gateStatuses)[number];
export type PmGateDecision = (typeof pmGateDecisions)[number];
export type GateCriterionStatus = (typeof gateCriterionStatuses)[number];
export type Applicability = (typeof applicabilityValues)[number];
export type HistoricalApplicability = (typeof historicalApplicabilityValues)[number];
export type GateReviewCycleStatus = (typeof gateReviewCycleStatuses)[number];
export type GateReviewApproverResponseOutcome = (typeof gateReviewApproverResponseOutcomes)[number];
export type GateReviewInvitationAttemptStatus =
  (typeof gateReviewInvitationAttemptStatuses)[number];
export type GateReviewBaselineType = (typeof gateReviewBaselineTypes)[number];

export type GateCriterion = {
  id: string;
  templateId: string | null;
  description: string;
  status: GateCriterionStatus;
  applicability: Applicability;
  applicabilityJustification: string | null;
  applicabilityDecidedAt: string | null;
  applicabilityDecidedByUserId: string | null;
  applicabilityDecidedByDisplayName: string | null;
  applicabilityOrigin: "legacy" | "template" | "user";
  applicabilityLocked: boolean;
};

export type GateApprover = {
  id: string;
  name: string;
  email: string;
  organizationName?: string | null;
  roleFunction: string;
  approvalRole: string;
  approvalLevel: number;
  identityVerification?: "required" | "verified";
  assignedUserId?: string | null;
  expectedProviderTenantId?: string | null;
  expectedProviderObjectId?: string | null;
};

export type VerifiedApproverUser = {
  id: string;
  displayName: string;
  email: string;
  organizationName: string | null;
  accessClass: "internal" | "external_reviewer";
};

export type GateReviewActorSnapshot = {
  userId: string | null;
  displayName: string;
  email: string | null;
  providerTenantId?: string | null;
  providerObjectId?: string | null;
  authenticationMethod?: "microsoft_entra" | "email_otp";
  reviewSessionId?: string | null;
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
  status: GateCriterionStatus | "not_applicable" | "satisfied";
  applicability?: HistoricalApplicability;
  applicabilityJustification?: string | null;
};

export type GateReviewDeliverableSnapshot = {
  deliverableId: string;
  templateId: string | null;
  templateVersion: number | null;
  title: string;
  description: string;
  status: "not_started" | "in_progress" | "completed" | "not_applicable";
  applicability?: HistoricalApplicability;
  applicabilityJustification?: string | null;
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
  applicabilityMatrix?: ApplicabilityMatrixSnapshot | null;
  matrixReviewConfirmation?: import("./matrix-reviews").MatrixReviewConfirmation | null;
};

export type ApplicabilityMatrixItemSnapshot = {
  itemType: "criterion" | "deliverable";
  itemId: string;
  templateId: string | null;
  source: "default" | "custom";
  title: string;
  description: string;
  applicability: HistoricalApplicability;
  justification: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
};

export type ApplicabilityMatrixGateSnapshot = {
  stageId: string;
  stageLabel: string;
  gateId: string;
  gateName: string;
  items: ApplicabilityMatrixItemSnapshot[];
};

export type ApplicabilityMatrixSnapshot = {
  scopeLevel: "project" | "package";
  scopeId: string;
  generatedAt: string;
  gates: ApplicabilityMatrixGateSnapshot[];
};

export type GateReviewApproverResponse = {
  outcome: GateReviewApproverResponseOutcome;
  respondedAt: string;
  respondedBy: GateReviewActorSnapshot;
  comment: string;
};

export type GateReviewInvitationError = {
  code: string;
  message: string;
};

export type GateReviewInvitationAttempt = {
  id: string;
  idempotencyKey: string;
  provider: string;
  status: GateReviewInvitationAttemptStatus;
  attemptedAt: string;
  completedAt: string | null;
  providerMessageId: string | null;
  error: GateReviewInvitationError | null;
};

export type GateReviewInvitation = {
  activatedAt: string;
  attempts: GateReviewInvitationAttempt[];
};

export type GateReviewInvitationAttemptResult =
  | { status: "sent"; providerMessageId: string }
  | {
      status: "failed" | "indeterminate";
      error: GateReviewInvitationError;
    };

export type GateReviewApproverSnapshot = {
  gateApproverId: string;
  name: string;
  email: string;
  roleFunction: string;
  approvalRole: string;
  approvalLevel: number;
  assignedUserId?: string | null;
  expectedProviderTenantId?: string | null;
  expectedProviderObjectId?: string | null;
  authenticationMethod?: "email_otp" | null;
  reviewAccessId?: string | null;
  response: GateReviewApproverResponse | null;
  invitation: GateReviewInvitation | null;
};

export type GateReviewCycle = {
  schemaVersion: number;
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
  status: "not_started" | "in_progress" | "completed";
  applicability: Applicability;
  applicabilityJustification: string | null;
  applicabilityOrigin: "legacy" | "template" | "user";
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
    | "missing_applicability_justification"
    | "invalid_deliverables"
    | "missing_acceptance_requirements"
    | "incomplete_deliverables"
    | "invalid_actions"
    | "matrix_review_confirmation_required";
  message: string;
};

export type GateSubmissionScopeApplicability = {
  scopeLabel: "Project" | "Package";
  items: Array<{
    applicability: Applicability;
    applicabilityJustification: string | null;
    applicabilityOrigin: "legacy" | "template" | "user";
  }>;
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
  applicabilityMatrix?: ApplicabilityMatrixSnapshot | null;
  matrixReviewConfirmation?: import("./matrix-reviews").MatrixReviewConfirmation | null;
};

export type WithdrawGateReviewCycleInput = {
  withdrawnAt: string;
  withdrawnBy: GateReviewActorSnapshot;
  withdrawalReason: string;
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
      activatedApproverIds: string[];
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
  reapprovalRequired: boolean;
  deliverableConfigurationLocked: boolean;
  deliverableCompletionLocked: boolean;
  approvers: GateApprover[];
  reviewCycles: GateReviewCycle[];
  criteria: GateCriterion[];
};

export type GateCriterionDefinition = {
  id: string;
  description: string;
  previousDescriptions?: readonly string[];
  applicabilityLocked?: boolean;
};

export type GateDefinition<StageId extends string> = {
  id: string;
  templateVersion: number;
  name: string;
  previousNames?: readonly string[];
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
};

export const applicabilityLabels: Record<HistoricalApplicability, string> = {
  applicable: "Applicable",
  not_applicable: "Not Applicable",
  to_be_determined: "To Be Determined",
};

export function getGateCriterionStatusLabel(status: GateReviewCriterionSnapshot["status"]) {
  if (status === "satisfied") return "Completed";
  if (status === "not_applicable") return "Not Applicable";
  return gateCriterionStatusLabels[status];
}

export const gateReviewCycleStatusLabels: Record<GateReviewCycleStatus, string> = {
  awaiting_approval: "Submitted for Approval",
  withdrawn: "Withdrawn",
  returned_for_rework: "Returned for Rework",
  approved: "Approved",
  approved_with_actions: "Approved with Actions",
};

export type GateCriterionInput = Pick<GateCriterion, "description" | "status">;
export type GateApproverInput = Pick<
  GateApprover,
  "name" | "email" | "organizationName" | "roleFunction" | "approvalRole" | "approvalLevel"
>;

export type GateSubmissionResult<Entity> =
  | { outcome: "submitted"; entity: Entity; reviewCycle: GateReviewCycle }
  | { outcome: "blocked"; issues: GateSubmissionIssue[] }
  | { outcome: "not_in_preparation" }
  | { outcome: "not_current" };

export type GateWithdrawalResult<Entity> =
  | { outcome: "withdrawn"; entity: Entity; reviewCycle: GateReviewCycle }
  | { outcome: "not_submitted" }
  | { outcome: "not_current" };

export type GateReviewResponseResult<Entity> =
  | {
      outcome: "recorded";
      entity: Entity;
      reviewCycle: GateReviewCycle;
      completion: GateReviewResponseCompletion;
      activatedApproverIds: string[];
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
    reapprovalRequired: false,
    deliverableConfigurationLocked: false,
    deliverableCompletionLocked: false,
    approvers: [],
    reviewCycles: [],
    criteria: [],
  }));
}

export function normalizeGates<StageId extends string>(
  scopeId: string,
  gates: Partial<Gate<StageId>>[] | undefined,
  definitions: GateDefinition<StageId>[],
): Gate<StageId>[] {
  const normalized = definitions.map((definition) => {
    const id = `${scopeId}:${definition.id}`;
    const existingGate = gates?.find((gate) => gate.id === id || gate.stageId === definition.stageId);
    const reviewCycles = normalizeGateReviewCycles(existingGate?.reviewCycles);
    const status = normalizeGateStatus(existingGate?.status, reviewCycles);

    return {
      id,
      templateVersion: definition.templateVersion,
      name: normalizeGateName(existingGate?.name, definition),
      stageId: definition.stageId,
      status,
      reapprovalRequired: existingGate?.reapprovalRequired === true,
      deliverableConfigurationLocked: false,
      deliverableCompletionLocked: false,
      approvers: normalizeGateApprovers(id, existingGate?.approvers),
      reviewCycles,
      criteria: [],
    };
  });
  return normalized.map((gate, index) => ({
    ...gate,
    ...deriveStageDeliverableProtection(gate, normalized[index - 1] ?? null),
  }));
}

export function deriveStageDeliverableProtection(
  gate: Pick<Gate, "status" | "reapprovalRequired">,
  previousGate: Pick<Gate, "status"> | null,
) {
  const ownGateFrozen = isGateDeliverableEvidenceFrozen(gate.status);
  const controlledReopeningRevision = gate.reapprovalRequired
    && (gate.status === "not_submitted" || gate.status === "returned_for_rework");
  const precedingGateConfigurationFrozen = previousGate !== null
    && isGateDeliverableEvidenceFrozen(previousGate.status)
    && !controlledReopeningRevision;

  return {
    deliverableConfigurationLocked: ownGateFrozen || precedingGateConfigurationFrozen,
    deliverableCompletionLocked: ownGateFrozen,
  };
}

function isGateDeliverableEvidenceFrozen(status: GateStatus) {
  return status === "submitted_for_approval"
    || status === "approved"
    || status === "approved_with_actions";
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

    if (normalizeGateName(gate?.name, definition) !== gate?.name) {
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

    if (
      gate.reviewCycles.some(
        (cycle) =>
          (cycle.status as string) === "submitted" ||
          !cycle.gate.stageLabel ||
          !("withdrawnAt" in cycle) ||
          !("withdrawnBy" in cycle) ||
          !("withdrawalReason" in cycle),
      )
    ) {
      return true;
    }

    return false;
  });
}

function normalizeGateName<StageId extends string>(
  existingName: string | undefined,
  definition: GateDefinition<StageId>,
) {
  if (!existingName || definition.previousNames?.includes(existingName)) {
    return definition.name;
  }
  return existingName;
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
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const organizationName = String(formData.get("organizationName") ?? "").trim() || null;
  const roleFunction = String(formData.get("roleFunction") ?? "").trim();
  const approvalRole = String(formData.get("approvalRole") ?? "").trim();
  const approvalLevelValue = String(formData.get("approvalLevel") ?? "").trim();
  const approvalLevel = Number(approvalLevelValue);

  if (!name || !email || !roleFunction || !approvalRole) {
    throw new Error("Name, email address, Role / Function and Gate Approval Role are required.");
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!approvalLevelValue || !Number.isInteger(approvalLevel) || approvalLevel < 1) {
    throw new Error("Approval Level must be a positive integer.");
  }

  return {
    name,
    email,
    organizationName,
    roleFunction,
    approvalRole,
    approvalLevel,
  };
}

export function getAwaitingGateReviewCycle(gate: Gate) {
  return [...gate.reviewCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)
    .find((cycle) => cycle.status === "awaiting_approval") ?? null;
}

export function canWithdrawGateReviewCycle(cycle: GateReviewCycle) {
  return cycle.status === "awaiting_approval";
}

export function withdrawGateReviewCycle(gate: Gate, input: WithdrawGateReviewCycleInput) {
  const withdrawalReason = input.withdrawalReason.trim();
  if (!withdrawalReason) {
    throw new Error("A withdrawal reason is required.");
  }
  const reviewCycle = getAwaitingGateReviewCycle(gate);

  if (gate.status !== "submitted_for_approval" || !reviewCycle) {
    return { outcome: "not_submitted" as const };
  }

  reviewCycle.status = "withdrawn";
  reviewCycle.completedAt = input.withdrawnAt;
  reviewCycle.withdrawnAt = input.withdrawnAt;
  reviewCycle.withdrawnBy = { ...input.withdrawnBy };
  reviewCycle.withdrawalReason = withdrawalReason;
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

export function activateGateReviewInvitations(
  cycle: GateReviewCycle,
  activatedAt: string,
) {
  const activatedApproverIds: string[] = [];
  for (const approver of getGateReviewApprovalState(cycle).eligibleApprovers) {
    if (approver.invitation) continue;
    approver.invitation = { activatedAt, attempts: [] };
    activatedApproverIds.push(approver.gateApproverId);
  }
  return activatedApproverIds;
}

export function claimGateReviewInvitationAttempt(
  cycle: GateReviewCycle,
  gateApproverId: string,
  input: {
    attemptId: string;
    idempotencyKey: string;
    provider: string;
    attemptedAt: string;
    allowFailedRetry?: boolean;
  },
) {
  const approver = cycle.approvers.find(
    (candidate) => candidate.gateApproverId === gateApproverId,
  );
  const invitation = approver?.invitation;
  if (
    !approver ||
    !invitation ||
    !canDispatchGateReviewInvitation(
      cycle,
      approver,
      input.allowFailedRetry ?? false,
    )
  ) {
    return null;
  }

  const attempt: GateReviewInvitationAttempt = {
    id: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    provider: input.provider,
    status: "dispatching",
    attemptedAt: input.attemptedAt,
    completedAt: null,
    providerMessageId: null,
    error: null,
  };
  invitation.attempts.push(attempt);
  return { approver, attempt };
}

export function canRetryGateReviewInvitation(
  cycle: GateReviewCycle,
  gateApproverId: string,
) {
  const approver = cycle.approvers.find(
    (candidate) => candidate.gateApproverId === gateApproverId,
  );
  return approver
    ? canDispatchGateReviewInvitation(cycle, approver, true)
    : false;
}

function canDispatchGateReviewInvitation(
  cycle: GateReviewCycle,
  approver: GateReviewApproverSnapshot,
  allowFailedRetry: boolean,
) {
  if (
    cycle.status !== "awaiting_approval" ||
    !approver.invitation ||
    approver.response ||
    !getGateReviewApprovalState(cycle).eligibleApprovers.some(
      (candidate) => candidate.gateApproverId === approver.gateApproverId,
    )
  ) {
    return false;
  }

  const attempts = approver.invitation.attempts;
  if (attempts.some((attempt) => attempt.status === "sent")) return false;
  if (attempts.length === 0) return true;
  return allowFailedRetry && attempts.at(-1)?.status === "failed";
}

export function completeGateReviewInvitationAttempt(
  cycle: GateReviewCycle,
  gateApproverId: string,
  attemptId: string,
  result: GateReviewInvitationAttemptResult,
  completedAt: string,
) {
  const approver = cycle.approvers.find(
    (candidate) => candidate.gateApproverId === gateApproverId,
  );
  const attempt = approver?.invitation?.attempts.find(
    (candidate) => candidate.id === attemptId,
  );
  if (!attempt || attempt.status !== "dispatching") return false;

  attempt.status = result.status;
  attempt.completedAt = completedAt;
  if (result.status === "sent") {
    attempt.providerMessageId = result.providerMessageId;
    attempt.error = null;
  } else {
    attempt.providerMessageId = null;
    attempt.error = { ...result.error };
  }
  return true;
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
      activatedApproverIds: [],
    };
  }

  const nextState = getGateReviewApprovalState(reviewCycle);
  if (nextState.eligibleApprovers.length > 0) {
    const activatedApproverIds = nextState.activeLevel !== approvalState.activeLevel
      ? activateGateReviewInvitations(reviewCycle, respondedAt)
      : [];
    return {
      outcome: "recorded",
      reviewCycle,
      completion: "pending",
      acceptedActionIds: [],
      activatedApproverIds,
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
    activatedApproverIds: [],
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
  scopeApplicability?: GateSubmissionScopeApplicability,
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
      message: "Every Approver must have a name, valid email address, Role / Function, Gate Approval Role, and positive Approval Level.",
    });
  }

  issues.push(...getScopeApplicabilitySubmissionIssues(
    scopeApplicability ?? { items: deliverables },
  ));

  const validDeliverableStatuses = new Set<GateSubmissionDeliverable["status"]>([
    "not_started",
    "in_progress",
    "completed",
  ]);
  if (deliverables.some((deliverable) => !validDeliverableStatuses.has(deliverable.status))) {
    issues.push({
      code: "invalid_deliverables",
      message: "One or more Deliverables have an invalid status.",
    });
  }

  const missingDefaultAcceptanceRequirements = deliverables.filter(
    (deliverable) => deliverable.templateId !== null && !deliverable.description.trim(),
  );
  if (missingDefaultAcceptanceRequirements.length > 0) {
    issues.push({
      code: "missing_acceptance_requirements",
      message: `${missingDefaultAcceptanceRequirements.length} default ${missingDefaultAcceptanceRequirements.length === 1 ? "Deliverable needs" : "Deliverables need"} acceptance requirements before submission.`,
    });
  }

  const incompleteDeliverables = deliverables.filter(
    (deliverable) => deliverable.applicability === "applicable" && deliverable.status !== "completed",
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

export function getScopeApplicabilitySubmissionIssues(
  input: GateSubmissionScopeApplicability | {
    scopeLabel?: undefined;
    items: GateSubmissionScopeApplicability["items"];
  },
): GateSubmissionIssue[] {
  const issues: GateSubmissionIssue[] = [];
  const scopePrefix = input.scopeLabel ? `${input.scopeLabel} ` : "";
  const reviewInstruction = input.scopeLabel
    ? ` Complete the ${input.scopeLabel} Applicability Review before submitting this Gate.`
    : "";

  const missingJustificationCount = input.items.filter((item) =>
    item.applicability === "not_applicable" &&
    item.applicabilityOrigin !== "legacy" &&
    !item.applicabilityJustification?.trim()).length;
  if (missingJustificationCount > 0) {
    issues.push({
      code: "missing_applicability_justification",
      message: input.scopeLabel
        ? `${missingJustificationCount} ${scopePrefix}Not Applicable ${missingJustificationCount === 1 ? "decision needs" : "decisions need"} a justification.${reviewInstruction}`
        : `${missingJustificationCount} Not Applicable ${missingJustificationCount === 1 ? "decision needs" : "decisions need"} a justification.`,
    });
  }

  return issues;
}

export function createGateReviewCycle(input: CreateGateReviewCycleInput): GateReviewCycle {
  const previousCycle = [...input.gate.reviewCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)[0] ?? null;
  const cycleNumber = (previousCycle?.cycleNumber ?? 0) + 1;

  const reviewCycle: GateReviewCycle = {
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
      criteria: [],
      deliverables: input.deliverables.map((deliverable) => ({
        deliverableId: deliverable.id,
        templateId: deliverable.templateId,
        templateVersion: deliverable.templateVersion,
        title: deliverable.title,
        description: deliverable.description,
        status: deliverable.status,
        applicability: deliverable.applicability,
        applicabilityJustification: deliverable.applicabilityJustification,
        criterionIds: [],
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
      applicabilityMatrix: input.applicabilityMatrix ?? null,
      matrixReviewConfirmation: input.matrixReviewConfirmation ?? null,
    },
    approvers: input.gate.approvers.map((approver) => ({
      gateApproverId: approver.id,
      name: approver.name,
      email: approver.email,
      roleFunction: approver.roleFunction,
      approvalRole: approver.approvalRole,
      approvalLevel: approver.approvalLevel,
      assignedUserId: approver.assignedUserId,
      expectedProviderTenantId: approver.expectedProviderTenantId,
      expectedProviderObjectId: approver.expectedProviderObjectId,
      response: null,
      invitation: null,
    })),
    relatedReworkActionIds: [],
  };
  activateGateReviewInvitations(reviewCycle, input.submittedAt);
  return reviewCycle;
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
    schemaVersion: cycle.schemaVersion ?? 3,
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
    approvers: cycle.approvers.map((approver) => ({
      ...approver,
      invitation: normalizeGateReviewInvitation(approver.invitation),
    })),
  }));
}

function normalizeGateReviewInvitation(
  invitation: GateReviewInvitation | null | undefined,
): GateReviewInvitation | null {
  if (!invitation || !Array.isArray(invitation.attempts)) return null;
  return {
    activatedAt: invitation.activatedAt,
    attempts: invitation.attempts.map((attempt) => ({
      ...attempt,
      completedAt: attempt.completedAt ?? null,
      providerMessageId: attempt.providerMessageId ?? null,
      error: attempt.error ? { ...attempt.error } : null,
    })),
  };
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
