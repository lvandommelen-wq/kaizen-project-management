import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getOperationalPool } from "../database";
import type { Deliverable, DeliverableInput } from "../deliverables";
import {
  digestGateReviewOtp,
  gateReviewOtpHourlyLimit,
  gateReviewOtpLifetimeMinutes,
  gateReviewOtpMaximumAttempts,
  gateReviewOtpResendSeconds,
  gateReviewSessionLifetimeMinutes,
  generateGateReviewOtp,
  generateGateReviewSessionToken,
  hashGateReviewSessionToken,
  maskGateReviewEmail,
  verifyGateReviewOtpDigest,
} from "../gate-review-otp";
import {
  createGateReviewCycle,
  createGates,
  getGateReviewApprovalState,
  getGateSubmissionIssues,
  isGateInPreparation,
  recordGateReviewResponse,
  withdrawGateReviewCycle,
  type Gate,
  type Applicability,
  type ApplicabilityMatrixSnapshot,
  type GateApproverInput,
  type GateReviewActorSnapshot,
  type GateReviewInvitationAttemptResult,
  type GateReviewResponseInput,
  type GateReviewResponseResult,
  type GateSubmissionResult,
  type GateWithdrawalResult,
  type HistoricalApplicability,
  type VerifiedApproverUser,
} from "../gates";
import {
  getProjectGateTemplates,
  packageGateTemplates,
  type GovernanceGateTemplate,
} from "../governance-templates";
import type { PackageFormInput, ProjectPackage } from "../packages";
import type {
  ActionActor,
  GateActionProtectionResult,
  GateProjectActionInput,
  ProjectAction,
  ProjectActionChange,
  ProjectActionDeletionResult,
  ProjectActionInput,
  ProjectActionStatus,
  ReopenedProjectActionStatus,
} from "../project-actions";
import type {
  GovernanceTierInput,
  Project,
  ProjectFormInput,
} from "../projects";
import type { CurrentUser } from "../current-user";
import { insertAuditEvent } from "../audit";
import {
  buildGateMatrixReviewState,
  getMatrixReviewSubmissionIssues,
  resolveMatrixReviewTarget,
  type GateMatrixReviewState,
  type MatrixReviewConfirmation,
  type MatrixReviewTarget,
} from "../matrix-reviews";
import {
  loadDeliverable,
  loadGate,
  loadGateDeliverables,
  loadPackage,
  loadPackages,
  loadProject,
  loadProjectAction,
  loadProjectActions,
  loadProjects,
} from "./mappers";
import {
  getOperationalTransactionClient,
  withOperationalTransaction,
} from "./transaction";

type Scope = {
  projectId: string;
  packageId: string | null;
};

type InvitationClaim = {
  claimToken: string;
  attemptId: string;
  idempotencyKey: string;
};

export type ProjectMembershipRole = "owner" | "editor" | "viewer";

export type ProjectMembership = {
  projectId: string;
  userId: string;
  role: ProjectMembershipRole;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMembershipDetail = ProjectMembership & {
  displayName: string;
  email: string;
  status: string;
  accessClass: string;
};

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  eventType: string;
  resourceType: string;
  resourceId: string;
  changeSummary: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type ApplicabilityItemType = "deliverable";
type LegacyApplicabilityItemType = "criterion" | ApplicabilityItemType;

export type ApplicabilityMutationInput = {
  projectId: string;
  packageId: string | null;
  gateId: string;
  itemType: ApplicabilityItemType;
  itemId: string;
  applicability: Applicability;
  justification: string;
};

export type ApplicabilityChange = {
  id: string;
  gateId: string;
  itemType: LegacyApplicabilityItemType;
  itemId: string;
  previousApplicability: HistoricalApplicability | null;
  applicability: HistoricalApplicability;
  justification: string | null;
  changeReason: string | null;
  changedAt: string;
  changedByDisplayName: string;
};

const projectStageOrder = [
  "initiation",
  "definition_design",
  "delivery",
  "validation",
  "closure",
] as const;
const packageStageOrder = [
  "definition",
  "tendering",
  "procurement",
  "execution",
  "closure",
] as const;
const invitationLeaseMs = 5 * 60 * 1_000;

async function withOperationalClient<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const transactionClient = getOperationalTransactionClient();
  if (transactionClient) return operation(transactionClient);

  let client: PoolClient;
  try {
    client = await getOperationalPool().connect();
  } catch {
    throw new Error("Could not connect to the operational database.");
  }
  try {
    const schema = await client.query(
      `SELECT 1 FROM identity_schema_migration
       WHERE name = '010_gate_review_email_otp.sql'`,
    );
    if (schema.rowCount !== 1) {
      throw new Error("Operational PostgreSQL migration 010 has not been applied.");
    }
    return await operation(client);
  } finally {
    client.release();
  }
}

function timestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function lifecycleNext<T extends string>(stages: readonly T[], current: T) {
  const index = stages.indexOf(current);
  return stages[index + 1] ?? null;
}

function lifecyclePrevious<T extends string>(stages: readonly T[], current: T) {
  const index = stages.indexOf(current);
  return stages[index - 1] ?? null;
}

function projectLifecycle(validationRequired: boolean) {
  return validationRequired
    ? projectStageOrder
    : projectStageOrder.filter((stage) => stage !== "validation");
}

function projectStageLabel(stageId: string) {
  return {
    initiation: "Initiation",
    definition_design: "Definition & Design",
    delivery: "Delivery",
    validation: "Validation",
    closure: "Closure",
  }[stageId] ?? stageId;
}

function packageStageLabel(stageId: string) {
  return {
    definition: "Definition",
    tendering: "Tendering",
    procurement: "Procurement",
    execution: "Execution",
    closure: "Closure",
  }[stageId] ?? stageId;
}

function getMatrixReviewTarget(
  scope: Scope,
  gateStageId: string,
  validationRequired: boolean,
): MatrixReviewTarget {
  const activeStageIds: string[] = scope.packageId
    ? [...packageStageOrder]
    : [...projectLifecycle(validationRequired)];
  return resolveMatrixReviewTarget(
    gateStageId,
    activeStageIds,
    scope.packageId ? packageStageLabel : projectStageLabel,
  );
}

export async function getProjects(userId?: string) {
  return withOperationalClient((client) => loadProjects(client, false, userId));
}

export async function getProject(projectId: string) {
  return withOperationalClient((client) => loadProject(client, projectId));
}

export async function getArchivedProject(projectId: string) {
  return withOperationalClient((client) => loadProject(client, projectId, true));
}

export async function createProject(input: ProjectFormInput, ownerUserId?: string) {
  return withOperationalTransaction(async (client) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO project (
         id, project_number, name, description, project_manager, customer,
         reports_to, site_location, planned_start_date, planned_completion_date,
         validation_required, current_stage, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::date,
         NULLIF($10, '')::date, $11, 'initiation', $12, $12)`,
      [
        id,
        input.projectNumber,
        input.name,
        input.description,
        input.projectManager,
        input.customer,
        input.reportsTo,
        input.siteLocation,
        input.plannedStartDate,
        input.plannedCompletionDate,
        input.validationRequired,
        now,
      ],
    );
    await client.query(
      "INSERT INTO project_action_sequence (project_id, next_sequence) VALUES ($1, 1)",
      [id],
    );
    if (ownerUserId) {
      await client.query(
        `INSERT INTO project_membership (project_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)`,
        [id, ownerUserId, now],
      );
    }
    const templates = getProjectGateTemplates(input.validationRequired);
    await insertGatesAndDefaultDeliverables(
      client,
      { projectId: id, packageId: null },
      createGates(id, templates),
      templates,
      now,
    );
    const project = await loadProject(client, id);
    if (!project) throw new Error("The Project could not be loaded after creation.");
    return project;
  });
}

export async function updateProject(projectId: string, input: ProjectFormInput) {
  return withOperationalTransaction(async (client) => {
    const locked = await client.query(
      "SELECT current_stage FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (locked.rowCount === 0) return null;
    const now = new Date().toISOString();
    await client.query(
      `UPDATE project SET
         project_number = $2, name = $3, description = $4, project_manager = $5,
         customer = $6, reports_to = $7, site_location = $8,
         planned_start_date = NULLIF($9, '')::date,
         planned_completion_date = NULLIF($10, '')::date,
         validation_required = $11, updated_at = $12
       WHERE id = $1`,
      [
        projectId,
        input.projectNumber,
        input.name,
        input.description,
        input.projectManager,
        input.customer,
        input.reportsTo,
        input.siteLocation,
        input.plannedStartDate,
        input.plannedCompletionDate,
        input.validationRequired,
        now,
      ],
    );
    return loadProject(client, projectId);
  });
}

export async function getPackages(projectId: string) {
  return withOperationalClient((client) => loadPackages(client, projectId));
}

export async function getPackage(projectId: string, packageId: string) {
  return withOperationalClient((client) => loadPackage(client, projectId, packageId));
}

export async function getArchivedPackage(projectId: string, packageId: string) {
  return withOperationalClient((client) => loadPackage(client, projectId, packageId, true));
}

export async function createPackage(projectId: string, input: PackageFormInput) {
  return withOperationalTransaction(async (client) => {
    const projectLock = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (projectLock.rowCount === 0) return null;
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await client.query(
        `INSERT INTO project_package (
           id, project_id, package_code, package_name, description, package_owner,
           execution_model, current_stage, status, target_delivery_date,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'definition', $8,
           NULLIF($9, '')::date, $10, $10)`,
        [
          id,
          projectId,
          input.packageCode,
          input.packageName,
          input.description,
          input.packageOwner,
          input.executionModel,
          input.status,
          input.targetDeliveryDate,
          now,
        ],
      );
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw new Error("Package code must be unique within the Project.");
      }
      throw error;
    }
    await insertGatesAndDefaultDeliverables(
      client,
      { projectId, packageId: id },
      createGates(id, packageGateTemplates),
      packageGateTemplates,
      now,
    );
    const projectPackage = await loadPackage(client, projectId, id);
    if (!projectPackage) throw new Error("The Package could not be loaded after creation.");
    return projectPackage;
  });
}

export async function updatePackage(
  projectId: string,
  packageId: string,
  input: PackageFormInput,
) {
  return withOperationalTransaction(async (client) => {
    const locked = await client.query(
      `SELECT package.id FROM project_package AS package
       JOIN project ON project.id = package.project_id
       WHERE package.project_id = $1 AND package.id = $2
         AND package.archived_at IS NULL AND project.archived_at IS NULL
       FOR UPDATE OF package`,
      [projectId, packageId],
    );
    if (locked.rowCount === 0) return null;
    try {
      await client.query(
        `UPDATE project_package SET
           package_code = $3, package_name = $4, description = $5,
           package_owner = $6, execution_model = $7, status = $8,
           target_delivery_date = NULLIF($9, '')::date, updated_at = $10
         WHERE project_id = $1 AND id = $2`,
        [
          projectId,
          packageId,
          input.packageCode,
          input.packageName,
          input.description,
          input.packageOwner,
          input.executionModel,
          input.status,
          input.targetDeliveryDate,
          new Date().toISOString(),
        ],
      );
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw new Error("Package code must be unique within the Project.");
      }
      throw error;
    }
    return loadPackage(client, projectId, packageId);
  });
}

async function insertGatesAndDefaultDeliverables<StageId extends string>(
  client: PoolClient,
  scope: Scope,
  gates: Gate<StageId>[],
  templates: GovernanceGateTemplate<StageId>[],
  now: string,
) {
  for (const [gateIndex, gate] of gates.entries()) {
    await client.query(
      `INSERT INTO gate (
         id, project_id, package_id, scope_level, sequence, template_version,
         name, stage_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        gate.id,
        scope.projectId,
        scope.packageId,
        scope.packageId ? "package" : "project",
        gateIndex + 1,
        gate.templateVersion,
        gate.name,
        gate.stageId,
        gate.status,
      ],
    );
    for (const [approverIndex, approver] of gate.approvers.entries()) {
      await client.query(
        `INSERT INTO gate_approver (
           id, gate_id, sequence, name, email, role_function, approval_role,
           approval_level
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          approver.id,
          gate.id,
          approverIndex + 1,
          approver.name,
          approver.email,
          approver.roleFunction,
          approver.approvalRole,
          approver.approvalLevel,
        ],
      );
    }
    const template = templates.find((candidate) => candidate.stageId === gate.stageId);
    if (!template) continue;
    for (const [deliverableIndex, definition] of template.deliverables.entries()) {
      const deliverableId = `${gate.id}:deliverable:${definition.id}`;
      await client.query(
        `INSERT INTO deliverable (
           id, template_id, template_version, project_id, package_id, gate_id,
           sequence, title, description, status, stage_id, scope_level,
           created_at, updated_at, applicability, applicability_origin,
           applicability_locked
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'not_started',
            $10, $11, $12, $12, $13, 'template', $14)`,
        [
          deliverableId,
          definition.id,
          template.templateVersion,
          scope.projectId,
          scope.packageId,
          gate.id,
          deliverableIndex + 1,
          definition.title,
          definition.description,
          gate.stageId,
          scope.packageId ? "package" : "project",
          now,
          "applicable",
          definition.applicabilityLocked ?? false,
        ],
      );
    }
  }
}

async function touchScope(client: PoolClient, scope: Scope, now: string) {
  if (scope.packageId) {
    await client.query(
      `UPDATE project_package SET updated_at = $3
       WHERE project_id = $1 AND id = $2`,
      [scope.projectId, scope.packageId, now],
    );
  } else {
    await client.query(
      "UPDATE project SET updated_at = $2 WHERE id = $1",
      [scope.projectId, now],
    );
  }
}

async function lockScopeGate(
  client: PoolClient,
  scope: Scope,
  gateId: string,
) {
  if (scope.packageId) {
    const parent = await client.query(
      `SELECT package.id FROM project_package AS package
       JOIN project ON project.id = package.project_id
       WHERE package.project_id = $1 AND package.id = $2
         AND package.archived_at IS NULL AND project.archived_at IS NULL
       FOR UPDATE OF package`,
      [scope.projectId, scope.packageId],
    );
    if (parent.rowCount === 0) return null;
  } else {
    const parent = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [scope.projectId],
    );
    if (parent.rowCount === 0) return null;
  }
  const gateLock = await client.query(
    `SELECT id FROM gate
     WHERE id = $1 AND project_id = $2
       AND package_id IS NOT DISTINCT FROM $3::text
     FOR UPDATE`,
    [gateId, scope.projectId, scope.packageId],
  );
  if (gateLock.rowCount === 0) return null;
  return loadGate(client, scope.projectId, scope.packageId, gateId);
}

export async function getGateDeliverables(
  projectId: string,
  packageId: string | null,
  gateId: string,
) {
  return withOperationalClient((client) =>
    loadGateDeliverables(client, projectId, packageId, gateId),
  );
}

export async function createDeliverable(input: DeliverableInput) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId: input.projectId, packageId: input.packageId };
    const gate = await lockScopeGate(client, scope, input.gateId);
    if (!gate || !isGateInPreparation(gate)) {
      throw new Error("Deliverables can only be changed while the Gate is in preparation.");
    }
    const sequenceResult = await client.query(
      `SELECT coalesce(max(sequence), 0) + 1 AS sequence
       FROM deliverable WHERE gate_id = $1`,
      [input.gateId],
    );
    const sequence = Number(sequenceResult.rows[0]?.sequence);
    const id = randomUUID();
    const now = new Date().toISOString();
    await client.query(
        `INSERT INTO deliverable (
         id, template_id, template_version, project_id, package_id, gate_id,
         sequence, title, description, status, stage_id, scope_level,
          created_at, updated_at, applicability, applicability_origin
       ) VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $11, 'applicable', 'legacy')`,
      [
        id,
        input.projectId,
        input.packageId,
        input.gateId,
        sequence,
        input.title,
        input.description,
        input.status,
        input.stageId,
        input.scopeLevel,
        now,
      ],
    );
    await touchScope(client, scope, now);
    const deliverable = await loadDeliverable(client, id);
    if (!deliverable) throw new Error("The Deliverable could not be loaded after creation.");
    return deliverable;
  });
}

export async function updateDeliverable(
  deliverableId: string,
  input: DeliverableInput,
) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId: input.projectId, packageId: input.packageId };
    const gate = await lockScopeGate(client, scope, input.gateId);
    if (!gate || !isGateInPreparation(gate)) return null;
    const locked = await client.query(
      `SELECT * FROM deliverable
       WHERE id = $1 FOR UPDATE`,
      [deliverableId],
    );
    const row = locked.rows[0];
    if (
      !row ||
      row.project_id !== input.projectId ||
      row.package_id !== input.packageId ||
      row.gate_id !== input.gateId
    ) {
      return null;
    }
    const now = new Date().toISOString();
    await client.query(
      `UPDATE deliverable SET title = $2, status = $3,
         stage_id = $4, scope_level = $5, updated_at = $6
       WHERE id = $1`,
      [
        deliverableId,
        input.title,
        input.status,
        input.stageId,
        input.scopeLevel,
        now,
      ],
    );
    await touchScope(client, scope, now);
    return loadDeliverable(client, deliverableId);
  });
}

export async function deleteDeliverable(
  deliverableId: string,
  context: { projectId: string; packageId: string | null; gateId: string },
) {
  return withOperationalTransaction(async (client) => {
    const gate = await lockScopeGate(client, context, context.gateId);
    if (!gate || !isGateInPreparation(gate)) return false;
    if (await itemHasReviewEvidence(client, context, "deliverable", deliverableId)) {
      return false;
    }
    const result = await client.query(
      `DELETE FROM deliverable
       WHERE id = $1 AND project_id = $2
         AND package_id IS NOT DISTINCT FROM $3::text
         AND gate_id = $4 AND template_id IS NULL`,
      [deliverableId, context.projectId, context.packageId, context.gateId],
    );
    if (result.rowCount === 0) return false;
    await touchScope(client, context, new Date().toISOString());
    return true;
  });
}

export async function ensureDefaultDeliverables<StageId extends string>(context: {
  projectId: string;
  packageId: string | null;
  gates: Gate<StageId>[];
  templates: GovernanceGateTemplate<StageId>[];
}) {
  return withOperationalTransaction(async (client) => {
    for (const gate of context.gates) {
      const template = context.templates.find(
        (candidate) => candidate.stageId === gate.stageId,
      );
      if (!template) continue;
      const lockedGate = await lockScopeGate(client, context, gate.id);
      if (!lockedGate) continue;
      await synchronizeGateDefaultDeliverables(
        client,
        context,
        lockedGate,
        template,
      );
    }
  });
}

async function synchronizeGateDefaultDeliverables<StageId extends string>(
  client: PoolClient,
  scope: Scope,
  gate: Gate,
  template: GovernanceGateTemplate<StageId>,
) {
  if (!isGateInPreparation(gate)) return;
  const maximumResult = await client.query(
    "SELECT coalesce(max(sequence), 0) AS sequence FROM deliverable WHERE gate_id = $1",
    [gate.id],
  );
  let nextSequence = Number(maximumResult.rows[0]?.sequence) + 1;
  const now = new Date().toISOString();
  for (const definition of template.deliverables) {
    const id = `${gate.id}:deliverable:${definition.id}`;
    await client.query(
      `INSERT INTO deliverable (
         id, template_id, template_version, project_id, package_id, gate_id,
         sequence, title, description, status, stage_id, scope_level,
          created_at, updated_at, applicability, applicability_origin,
          applicability_locked
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'not_started',
           $10, $11, $12, $12, $13, 'template', $14)
        ON CONFLICT (gate_id, template_id) WHERE template_id IS NOT NULL
        DO UPDATE SET template_version = EXCLUDED.template_version,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          applicability_locked = EXCLUDED.applicability_locked,
          updated_at = EXCLUDED.updated_at
       `,
      [
        id,
        definition.id,
        template.templateVersion,
        scope.projectId,
        scope.packageId,
        gate.id,
        nextSequence,
        definition.title,
        definition.description,
        gate.stageId,
        scope.packageId ? "package" : "project",
        now,
        "applicable",
        definition.applicabilityLocked ?? false,
      ],
    );
    nextSequence += 1;
  }

  await client.query(
    "UPDATE gate SET template_version = greatest(template_version, $2) WHERE id = $1",
    [gate.id, template.templateVersion],
  );
}

export async function getApplicabilityReview(projectId: string, packageId: string | null) {
  return withOperationalTransaction(async (client) => {
    const project = await loadProject(client, projectId);
    const entity = packageId ? await loadPackage(client, projectId, packageId) : project;
    if (!project || !entity) return null;
    const gates = packageId ? (entity as ProjectPackage).gates : project.gates;
    const templates = packageId ? packageGateTemplates : getProjectGateTemplates(project.validationRequired);

    for (const gate of gates) {
      if (!isGateInPreparation(gate)) continue;
      const template = templates.find((candidate) => candidate.stageId === gate.stageId);
      if (template) await synchronizeGateDefaultDeliverables(client, { projectId, packageId }, gate, template);
    }

    const refreshed = packageId
      ? await loadPackage(client, projectId, packageId)
      : await loadProject(client, projectId);
    if (!refreshed) return null;
    const refreshedGates = packageId ? (refreshed as ProjectPackage).gates : (refreshed as Project).gates;
    const reviewGates: Array<{
      gate: Gate;
      stageLabel: string;
      deliverables: Deliverable[];
    }> = [];
    for (const gate of refreshedGates) {
      reviewGates.push({
        gate,
        stageLabel: packageId ? packageStageLabel(gate.stageId) : projectStageLabel(gate.stageId),
        deliverables: await loadGateDeliverables(client, projectId, packageId, gate.id),
      });
    }
    const changeRows = await client.query(
      `SELECT id, gate_id, item_type, item_id, previous_applicability,
         applicability, justification, change_reason, changed_at,
         changed_by_display_name
       FROM applicability_change
       WHERE project_id = $1 AND package_id IS NOT DISTINCT FROM $2::text
       ORDER BY changed_at DESC, id DESC`,
      [projectId, packageId],
    );
    const changes: ApplicabilityChange[] = changeRows.rows.map((row) => ({
      id: String(row.id),
      gateId: String(row.gate_id),
      itemType: String(row.item_type) as LegacyApplicabilityItemType,
      itemId: String(row.item_id),
      previousApplicability: row.previous_applicability == null
        ? null
        : String(row.previous_applicability) as HistoricalApplicability,
      applicability: String(row.applicability) as HistoricalApplicability,
      justification: row.justification == null ? null : String(row.justification),
      changeReason: row.change_reason == null ? null : String(row.change_reason),
      changedAt: row.changed_at instanceof Date
        ? row.changed_at.toISOString()
        : new Date(String(row.changed_at)).toISOString(),
      changedByDisplayName: String(row.changed_by_display_name),
    }));
    const methodologyApproved = refreshedGates.some((gate) =>
      gate.stageId === (packageId ? "definition" : "initiation") &&
      gate.reviewCycles.some((cycle) => cycle.status === "approved" || cycle.status === "approved_with_actions"));
    const methodologyAwaitingApproval = refreshedGates.some((gate) =>
      gate.stageId === (packageId ? "definition" : "initiation") &&
      gate.reviewCycles.some((cycle) => cycle.status === "awaiting_approval"));
    return {
      project,
      entity: refreshed,
      gates: reviewGates,
      changes,
      methodologyApproved,
      methodologyAwaitingApproval,
    };
  });
}

function buildApplicabilityMatrix(
  scopeId: string,
  packageId: string | null,
  gates: Array<{
    gate: Gate;
    stageLabel: string;
    deliverables: Deliverable[];
  }>,
  generatedAt: string,
): ApplicabilityMatrixSnapshot {
  return {
    scopeLevel: packageId ? "package" : "project",
    scopeId,
    generatedAt,
    gates: gates.map(({ gate, stageLabel, deliverables }) => ({
      stageId: gate.stageId,
      stageLabel,
      gateId: gate.id,
      gateName: gate.name,
      items: deliverables.map((deliverable) => ({
          itemType: "deliverable" as const,
          itemId: deliverable.id,
          templateId: deliverable.templateId,
          source: deliverable.templateId ? "default" as const : "custom" as const,
          title: deliverable.title,
          description: deliverable.description,
          applicability: deliverable.applicability,
          justification: deliverable.applicabilityJustification,
          decidedAt: deliverable.applicabilityDecidedAt,
          decidedBy: deliverable.applicabilityDecidedByDisplayName,
        })),
    })),
  };
}

async function lockScopeMatrixGates(client: PoolClient, scope: Scope) {
  await client.query(
    `SELECT id
     FROM gate
     WHERE project_id = $1 AND package_id IS NOT DISTINCT FROM $2::text
     ORDER BY sequence
     FOR UPDATE`,
    [scope.projectId, scope.packageId],
  );
}

async function loadStoredMatrixReviewConfirmation(
  client: PoolClient,
  gateId: string,
): Promise<Omit<MatrixReviewConfirmation, "targetStageLabel" | "applicableCount" | "notApplicableCount"> | null> {
  const result = await client.query(
    `SELECT gate_id, review_scope, target_stage_id, matrix_fingerprint, status,
            confirmed_at, confirmed_by_user_id, confirmed_by_display_name,
            confirmed_by_email
     FROM gate_matrix_review_confirmation
     WHERE gate_id = $1`,
    [gateId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    gateId: String(row.gate_id),
    reviewScope: String(row.review_scope) as MatrixReviewConfirmation["reviewScope"],
    targetStageId: row.target_stage_id == null ? null : String(row.target_stage_id),
    reviewer: {
      userId: row.confirmed_by_user_id == null ? null : String(row.confirmed_by_user_id),
      displayName: String(row.confirmed_by_display_name),
      email: String(row.confirmed_by_email),
      authenticationMethod: "microsoft_entra",
    },
    confirmedAt: row.confirmed_at instanceof Date
      ? row.confirmed_at.toISOString()
      : new Date(String(row.confirmed_at)).toISOString(),
    status: "confirmed",
    matrixFingerprint: String(row.matrix_fingerprint),
  };
}

async function loadGateMatrixReviewContext(
  client: PoolClient,
  scope: Scope,
  gateId: string,
): Promise<{
  matrix: ApplicabilityMatrixSnapshot;
  state: GateMatrixReviewState;
} | null> {
  const project = await loadProject(client, scope.projectId);
  const entity = scope.packageId
    ? await loadPackage(client, scope.projectId, scope.packageId)
    : project;
  const gate = await loadGate(client, scope.projectId, scope.packageId, gateId);
  if (!project || !entity || !gate) return null;

  const review = await getApplicabilityReview(scope.projectId, scope.packageId);
  if (!review) return null;
  const target = getMatrixReviewTarget(scope, gate.stageId, project.validationRequired);
  const activeStageIds = new Set(target.activeStageIds);
  const activeGates = review.gates.filter(({ gate: reviewGate }) =>
    activeStageIds.has(reviewGate.stageId));
  const matrix = buildApplicabilityMatrix(
    scope.packageId ?? scope.projectId,
    scope.packageId,
    activeGates,
    new Date().toISOString(),
  );
  const confirmation = await loadStoredMatrixReviewConfirmation(client, gateId);
  return {
    matrix,
    state: buildGateMatrixReviewState(gateId, matrix, target, confirmation),
  };
}

export async function getGateMatrixReview(
  projectId: string,
  packageId: string | null,
  gateId: string,
) {
  return withOperationalTransaction((client) =>
    loadGateMatrixReviewContext(client, { projectId, packageId }, gateId));
}

export async function confirmGateMatrixReview(
  projectId: string,
  packageId: string | null,
  gateId: string,
  actor: CurrentUser,
) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId, packageId };
    const gate = await lockScopeGate(client, scope, gateId);
    const project = await loadProject(client, projectId);
    const entity = packageId ? await loadPackage(client, projectId, packageId) : project;
    if (!gate || !project || !entity) return null;
    if (!isGateInPreparation(gate)) {
      throw new Error("The Applicability Matrix can only be confirmed while the Gate is in preparation.");
    }
    if (gate.stageId !== entity.currentStage) {
      throw new Error("Only the current Gate Applicability Matrix review can be confirmed.");
    }

    await lockScopeMatrixGates(client, scope);
    const context = await loadGateMatrixReviewContext(client, scope, gateId);
    if (!context) return null;
    const confirmedAt = new Date().toISOString();
    await client.query(
      `INSERT INTO gate_matrix_review_confirmation (
         gate_id, project_id, package_id, scope_level, review_scope,
         target_stage_id, matrix_fingerprint, status, confirmed_at,
         confirmed_by_user_id, confirmed_by_display_name, confirmed_by_email
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10, $11)
       ON CONFLICT (gate_id) DO UPDATE SET
         review_scope = EXCLUDED.review_scope,
         target_stage_id = EXCLUDED.target_stage_id,
         matrix_fingerprint = EXCLUDED.matrix_fingerprint,
         status = EXCLUDED.status,
         confirmed_at = EXCLUDED.confirmed_at,
         confirmed_by_user_id = EXCLUDED.confirmed_by_user_id,
         confirmed_by_display_name = EXCLUDED.confirmed_by_display_name,
         confirmed_by_email = EXCLUDED.confirmed_by_email`,
      [
        gateId,
        projectId,
        packageId,
        packageId ? "package" : "project",
        context.state.target.reviewScope,
        context.state.target.targetStageId,
        context.state.matrixFingerprint,
        confirmedAt,
        actor.id,
        actor.displayName,
        actor.email,
      ],
    );
    await touchScope(client, scope, confirmedAt);

    return buildGateMatrixReviewState(gateId, context.matrix, context.state.target, {
      gateId,
      reviewScope: context.state.target.reviewScope,
      targetStageId: context.state.target.targetStageId,
      reviewer: {
        userId: actor.id,
        displayName: actor.displayName,
        email: actor.email,
        authenticationMethod: "microsoft_entra",
      },
      confirmedAt,
      status: "confirmed",
      matrixFingerprint: context.state.matrixFingerprint,
    });
  });
}

async function scopeHasActiveMethodologyReview(client: PoolClient, scope: Scope) {
  const result = await client.query(
    `SELECT 1
     FROM gate
     JOIN gate_review_cycle AS cycle ON cycle.gate_id = gate.id
     WHERE gate.project_id = $1
       AND gate.package_id IS NOT DISTINCT FROM $2::text
       AND gate.stage_id = $3
       AND cycle.status = 'awaiting_approval'
     LIMIT 1`,
    [scope.projectId, scope.packageId, scope.packageId ? "definition" : "initiation"],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateApplicabilityItem(input: ApplicabilityMutationInput, actor: CurrentUser) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId: input.projectId, packageId: input.packageId };
    const gate = await lockScopeGate(client, scope, input.gateId);
    if (!gate) return null;
    if (gate.status === "submitted_for_approval" || await scopeHasActiveMethodologyReview(client, scope)) {
      throw new Error("Applicability cannot be changed while the relevant Review Cycle is awaiting approval.");
    }
    if (input.applicability === "not_applicable" && !input.justification.trim()) {
      throw new Error("A justification is required for Not Applicable.");
    }

    const locked = await client.query(
      `SELECT id, template_id, status, applicability, applicability_locked
       FROM deliverable WHERE id = $1 AND gate_id = $2 FOR UPDATE`,
      [input.itemId, input.gateId],
    );
    const row = locked.rows[0];
    if (!row) return null;
    if (row.applicability_locked && input.applicability !== "applicable") {
      throw new Error("This mandatory methodology control must remain Applicable.");
    }
    const now = new Date().toISOString();
    const completion = String(row.status);
    await client.query(
      `UPDATE deliverable
       SET applicability = $3, applicability_justification = $4,
             applicability_decided_at = $5, applicability_decided_by_user_id = $6,
             applicability_decided_by_display_name = $7, applicability_origin = 'user',
             updated_at = $5
       WHERE id = $1 AND gate_id = $2`,
      [
        input.itemId,
        input.gateId,
        input.applicability,
        input.applicability === "not_applicable" ? input.justification.trim() : null,
        now,
        actor.id,
        actor.displayName,
      ],
    );
    if (row.applicability !== input.applicability) {
      await client.query(
        `INSERT INTO applicability_change (
           project_id, package_id, gate_id, item_type, item_id, template_id,
           previous_applicability, applicability, justification, change_reason,
           previous_completion_status, completion_status, changed_at,
           changed_by_user_id, changed_by_display_name, changed_by_email
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11,
            $12, $13, $14, $15)`,
        [
          input.projectId, input.packageId, input.gateId, input.itemType,
          input.itemId, row.template_id, row.applicability, input.applicability,
          input.applicability === "not_applicable" ? input.justification.trim() : null,
          row.status, completion, now, actor.id, actor.displayName, actor.email,
        ],
      );
    }
    await touchScope(client, scope, now);
    return true;
  });
}

export async function createApplicabilityItem(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  itemType: ApplicabilityItemType;
  title: string;
}, actor: CurrentUser) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId: input.projectId, packageId: input.packageId };
    const gate = await lockScopeGate(client, scope, input.gateId);
    if (!gate) return null;
    if (gate.status === "submitted_for_approval" || await scopeHasActiveMethodologyReview(client, scope)) {
      throw new Error("Items cannot be added while the relevant Review Cycle is awaiting approval.");
    }
    const title = input.title.trim();
    if (!title) {
      throw new Error("A Deliverable title is required.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await client.query(
        `INSERT INTO deliverable (
           id, project_id, package_id, gate_id, sequence, title, description,
           status, stage_id, scope_level, created_at, updated_at, applicability,
           applicability_decided_at, applicability_decided_by_user_id,
           applicability_decided_by_display_name, applicability_origin
         ) SELECT $1, $2, $3, $4, coalesce(max(sequence), 0) + 1, $5, '',
           'not_started', $6, $7, $8, $8, 'applicable', $8, $9, $10, 'user'
           FROM deliverable WHERE gate_id = $4`,
        [id, input.projectId, input.packageId, input.gateId, title,
          gate.stageId, input.packageId ? "package" : "project", now, actor.id, actor.displayName],
    );
    await client.query(
      `INSERT INTO applicability_change (
         project_id, package_id, gate_id, item_type, item_id, previous_applicability,
         applicability, change_reason, completion_status, changed_at,
         changed_by_user_id, changed_by_display_name, changed_by_email
        ) VALUES ($1, $2, $3, $4, $5, NULL, 'applicable', NULL, $6, $7, $8, $9, $10)`,
      [input.projectId, input.packageId, input.gateId, input.itemType, id,
        "not_started",
        now, actor.id, actor.displayName, actor.email],
    );
    await touchScope(client, scope, now);
    return id;
  });
}

export async function deleteApplicabilityItem(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  itemType: ApplicabilityItemType;
  itemId: string;
}) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId: input.projectId, packageId: input.packageId };
    const gate = await lockScopeGate(client, scope, input.gateId);
    if (!gate || gate.status === "submitted_for_approval" || await scopeHasActiveMethodologyReview(client, scope)) return false;
    if (await itemHasReviewEvidence(client, scope, input.itemType, input.itemId)) {
      return false;
    }
    const result = await client.query(
      `DELETE FROM deliverable WHERE id = $1 AND gate_id = $2 AND template_id IS NULL`,
      [input.itemId, input.gateId],
    );
    if ((result.rowCount ?? 0) > 0) await touchScope(client, scope, new Date().toISOString());
    return (result.rowCount ?? 0) > 0;
  });
}

async function itemHasReviewEvidence(
  client: PoolClient,
  scope: Scope,
  itemType: LegacyApplicabilityItemType,
  itemId: string,
) {
  const history = await client.query(
      `SELECT 1 FROM gate_review_cycle AS cycle
       JOIN gate ON gate.id = cycle.gate_id
       WHERE gate.project_id = $1
         AND gate.package_id IS NOT DISTINCT FROM $2::text
         AND (
           EXISTS (
             SELECT 1
             FROM jsonb_array_elements(
               coalesce(cycle.frozen_evidence -> $4::text, '[]'::jsonb)
             ) AS frozen_item
             WHERE frozen_item ->> $5::text = $3
           )
           OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(coalesce(
               cycle.frozen_evidence #> '{applicabilityMatrix,gates}',
               '[]'::jsonb
             )) AS matrix_gate
             CROSS JOIN LATERAL jsonb_array_elements(coalesce(
               matrix_gate -> 'items',
               '[]'::jsonb
             )) AS matrix_item
             WHERE matrix_item ->> 'itemId' = $3
           )
         )
       LIMIT 1`,
      [
        scope.projectId,
        scope.packageId,
        itemId,
        itemType === "criterion" ? "criteria" : "deliverables",
        itemType === "criterion" ? "criterionId" : "deliverableId",
      ],
    );
  return (history.rowCount ?? 0) > 0;
}

export async function deleteDeliverablesForProject(projectId: string) {
  await withOperationalTransaction(async (client) => {
    await client.query("DELETE FROM deliverable WHERE project_id = $1", [projectId]);
  });
}

export async function deleteDeliverablesForPackage(
  projectId: string,
  packageId: string,
) {
  await withOperationalTransaction(async (client) => {
    await client.query(
      "DELETE FROM deliverable WHERE project_id = $1 AND package_id = $2",
      [projectId, packageId],
    );
  });
}

export async function createProjectGovernanceTier(
  projectId: string,
  input: GovernanceTierInput,
) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return null;
    await client.query(
      "SELECT id FROM governance_tier WHERE project_id = $1 FOR UPDATE",
      [projectId],
    );
    const sequenceResult = await client.query(
      `SELECT coalesce(max(sequence), 0) + 1 AS sequence
       FROM governance_tier WHERE project_id = $1`,
      [projectId],
    );
    const tier = {
      id: randomUUID(),
      sequence: Number(sequenceResult.rows[0]?.sequence),
      name: input.name,
      description: input.description,
    };
    try {
      await client.query(
        `INSERT INTO governance_tier (id, project_id, sequence, name, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [tier.id, projectId, tier.sequence, tier.name, tier.description],
      );
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw new Error("Governance Tier names must be unique within the Project.");
      }
      throw error;
    }
    await touchScope(client, { projectId, packageId: null }, new Date().toISOString());
    return tier;
  });
}

export async function updateProjectGovernanceTier(
  projectId: string,
  governanceTierId: string,
  input: GovernanceTierInput,
) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return null;
    const tier = await client.query(
      `SELECT * FROM governance_tier
       WHERE project_id = $1 AND id = $2 FOR UPDATE`,
      [projectId, governanceTierId],
    );
    if (tier.rowCount === 0) return null;
    try {
      const result = await client.query(
        `UPDATE governance_tier SET name = $3, description = $4
         WHERE project_id = $1 AND id = $2
         RETURNING id, sequence, name, description`,
        [projectId, governanceTierId, input.name, input.description],
      );
      await touchScope(client, { projectId, packageId: null }, new Date().toISOString());
      const row = result.rows[0];
      return {
        id: String(row.id),
        sequence: Number(row.sequence),
        name: String(row.name),
        description: String(row.description),
      };
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw new Error("Governance Tier names must be unique within the Project.");
      }
      throw error;
    }
  });
}

export async function moveProjectGovernanceTier(
  projectId: string,
  governanceTierId: string,
  direction: "up" | "down",
) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return null;
    await client.query("SET CONSTRAINTS governance_tier_project_id_sequence_key DEFERRED");
    const tiers = await client.query(
      `SELECT id, sequence, name, description FROM governance_tier
       WHERE project_id = $1 ORDER BY sequence, id FOR UPDATE`,
      [projectId],
    );
    const index = tiers.rows.findIndex((row) => row.id === governanceTierId);
    if (index < 0) return null;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tiers.rows.length) {
      const row = tiers.rows[index];
      return {
        id: String(row.id),
        sequence: Number(row.sequence),
        name: String(row.name),
        description: String(row.description),
      };
    }
    const current = tiers.rows[index];
    const target = tiers.rows[targetIndex];
    await client.query(
      `UPDATE governance_tier
       SET sequence = CASE id WHEN $2 THEN $3::integer WHEN $4 THEN $5::integer END
       WHERE project_id = $1 AND id IN ($2, $4)`,
      [projectId, current.id, target.sequence, target.id, current.sequence],
    );
    await touchScope(client, { projectId, packageId: null }, new Date().toISOString());
    return {
      id: String(current.id),
      sequence: Number(target.sequence),
      name: String(current.name),
      description: String(current.description),
    };
  });
}

function changeHistoryReferences(
  value: unknown,
  referenceId: string,
  field: "governanceTierId" | "packageIds",
) {
  if (!Array.isArray(value)) return false;
  return value.some((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) return false;
    const stored = change as Record<string, unknown>;
    if (stored.field !== field) return false;
    const values = [stored.from, stored.to];
    return values.some(
      (candidate) =>
        candidate === referenceId ||
        (Array.isArray(candidate) && candidate.includes(referenceId)),
    );
  });
}

async function getReferenceHistory(
  client: PoolClient,
  projectId: string,
  referenceId: string,
  currentColumn: "governance_tier_id" | "package",
) {
  const currentResult = currentColumn === "governance_tier_id"
    ? await client.query(
        `SELECT id FROM project_action
         WHERE project_id = $1 AND governance_tier_id = $2
         ORDER BY sequence, id`,
        [projectId, referenceId],
      )
    : await client.query(
        `SELECT action.id
         FROM project_action AS action
         JOIN project_action_package AS package ON package.action_id = action.id
         WHERE action.project_id = $1 AND package.package_id = $2
         ORDER BY action.sequence, action.id`,
        [projectId, referenceId],
      );
  const historyResult = await client.query(
    `SELECT DISTINCT action.id, update.changes
     FROM project_action AS action
     JOIN project_action_update AS update ON update.action_id = action.id
     WHERE action.project_id = $1
     ORDER BY action.id`,
    [projectId],
  );
  const currentActionIds = currentResult.rows.map((row) => String(row.id));
  const historicalActionIds = [...new Set(
    historyResult.rows
      .filter((row) =>
        changeHistoryReferences(
          row.changes,
          referenceId,
          currentColumn === "governance_tier_id" ? "governanceTierId" : "packageIds",
        ),
      )
      .map((row) => String(row.id)),
  )];
  return {
    currentActionIds,
    historicalActionIds,
    hasReferences: currentActionIds.length > 0 || historicalActionIds.length > 0,
  };
}

export async function getGovernanceTierActionReferences(
  projectId: string,
  governanceTierId: string,
) {
  return withOperationalClient((client) =>
    getReferenceHistory(client, projectId, governanceTierId, "governance_tier_id"),
  );
}

export async function deleteProjectGovernanceTier(
  projectId: string,
  governanceTierId: string,
) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return null;
    await client.query("SET CONSTRAINTS governance_tier_project_id_sequence_key DEFERRED");
    const tiers = await client.query(
      `SELECT id, sequence FROM governance_tier
       WHERE project_id = $1 ORDER BY sequence, id FOR UPDATE`,
      [projectId],
    );
    const index = tiers.rows.findIndex((row) => row.id === governanceTierId);
    if (index < 0) return null;
    const references = await getReferenceHistory(
      client,
      projectId,
      governanceTierId,
      "governance_tier_id",
    );
    if (references.hasReferences) {
      return { outcome: "referenced" as const, references };
    }
    await client.query(
      "DELETE FROM governance_tier WHERE project_id = $1 AND id = $2",
      [projectId, governanceTierId],
    );
    for (const [sequence, row] of tiers.rows
      .filter((row) => row.id !== governanceTierId)
      .entries()) {
      await client.query(
        "UPDATE governance_tier SET sequence = $3 WHERE project_id = $1 AND id = $2",
        [projectId, row.id, sequence + 1],
      );
    }
    await touchScope(client, { projectId, packageId: null }, new Date().toISOString());
    return { outcome: "deleted" as const };
  });
}

async function createGateApprover(
  scope: Scope,
  gateId: string,
  input: GateApproverInput,
) {
  return withOperationalTransaction(async (client) => {
    const gate = await lockScopeGate(client, scope, gateId);
    if (!gate || !isGateInPreparation(gate)) return null;
    const sequenceResult = await client.query(
      `SELECT coalesce(max(sequence), 0) + 1 AS sequence
       FROM gate_approver WHERE gate_id = $1`,
      [gateId],
    );
    const approver = {
      id: randomUUID(),
      ...input,
      assignedUserId: null,
      expectedProviderTenantId: null,
      expectedProviderObjectId: null,
    };
    await client.query(
      `INSERT INTO gate_approver (
         id, gate_id, sequence, name, email, role_function, approval_role,
         approval_level, assigned_user_id, expected_provider_tenant_id,
         expected_provider_object_id, organization_name
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        approver.id,
        gateId,
        Number(sequenceResult.rows[0]?.sequence),
        approver.name,
        approver.email,
        approver.roleFunction,
        approver.approvalRole,
        approver.approvalLevel,
        approver.assignedUserId,
        approver.expectedProviderTenantId,
        approver.expectedProviderObjectId,
        approver.organizationName,
      ],
    );
    await touchScope(client, scope, new Date().toISOString());
    return approver;
  });
}

async function updateGateApprover(
  scope: Scope,
  gateId: string,
  approverId: string,
  input: GateApproverInput,
) {
  return withOperationalTransaction(async (client) => {
    const gate = await lockScopeGate(client, scope, gateId);
    if (!gate || !isGateInPreparation(gate)) return null;
    const result = await client.query(
      `UPDATE gate_approver SET name = $3, email = $4, role_function = $5,
          approval_role = $6, approval_level = $7, organization_name = $8
       WHERE gate_id = $1 AND id = $2`,
      [
        gateId,
        approverId,
        input.name,
        input.email,
        input.roleFunction,
        input.approvalRole,
        input.approvalLevel,
        input.organizationName,
      ],
    );
    if (result.rowCount === 0) return null;
    await touchScope(client, scope, new Date().toISOString());
    return {
      id: approverId,
      ...input,
    };
  });
}

async function deleteGateApprover(
  scope: Scope,
  gateId: string,
  approverId: string,
) {
  return withOperationalTransaction(async (client) => {
    const gate = await lockScopeGate(client, scope, gateId);
    if (!gate || !isGateInPreparation(gate)) return false;
    const result = await client.query(
      "DELETE FROM gate_approver WHERE gate_id = $1 AND id = $2",
      [gateId, approverId],
    );
    if (result.rowCount === 0) return false;
    await touchScope(client, scope, new Date().toISOString());
    return true;
  });
}

export function createProjectGateApprover(
  projectId: string,
  gateId: string,
  input: GateApproverInput,
) {
  return createGateApprover({ projectId, packageId: null }, gateId, input);
}

export function updateProjectGateApprover(
  projectId: string,
  gateId: string,
  approverId: string,
  input: GateApproverInput,
) {
  return updateGateApprover({ projectId, packageId: null }, gateId, approverId, input);
}

export function deleteProjectGateApprover(
  projectId: string,
  gateId: string,
  approverId: string,
) {
  return deleteGateApprover({ projectId, packageId: null }, gateId, approverId);
}

export function createPackageGateApprover(
  projectId: string,
  packageId: string,
  gateId: string,
  input: GateApproverInput,
) {
  return createGateApprover({ projectId, packageId }, gateId, input);
}

export function updatePackageGateApprover(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
  input: GateApproverInput,
) {
  return updateGateApprover({ projectId, packageId }, gateId, approverId, input);
}

export function deletePackageGateApprover(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
) {
  return deleteGateApprover({ projectId, packageId }, gateId, approverId);
}

export async function getProjectActions(projectId: string) {
  return withOperationalClient((client) => loadProjectActions(client, projectId));
}

export async function getProjectAction(projectId: string, actionId: string) {
  return withOperationalClient((client) =>
    loadProjectAction(client, projectId, actionId),
  );
}

export async function getArchivedProjectActions(projectId: string) {
  return withOperationalClient((client) =>
    loadProjectActions(client, projectId, true),
  );
}

export async function hasActionsForPackage(projectId: string, packageId: string) {
  return withOperationalClient(async (client) => {
    const references = await getReferenceHistory(
      client,
      projectId,
      packageId,
      "package",
    );
    return references.hasReferences;
  });
}

export async function getProjectActionDeletionBlocker(projectId: string) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT count(DISTINCT action.id)::integer AS count
       FROM project_action AS action
       JOIN action_gate_decision_reference AS reference
         ON reference.action_id = action.id
       WHERE action.project_id = $1`,
      [projectId],
    );
    const count = Number(result.rows[0]?.count ?? 0);
    if (count === 0) return null;
    return `${count} Gate Action${count === 1 ? " is" : "s are"} retained as finalized governance history. Delete those governance records only through a future controlled archival process.`;
  });
}

export async function getGateActions(projectId: string, gateId: string) {
  return withOperationalClient(async (client) => {
    const actions = await loadProjectActions(client, projectId);
    return actions.filter(
      (action) => action.source === "gate" && action.gateId === gateId,
    );
  });
}

async function allocateProjectActionSequence(
  client: PoolClient,
  projectId: string,
) {
  const result = await client.query(
    `INSERT INTO project_action_sequence (project_id, next_sequence)
     VALUES ($1, 2)
     ON CONFLICT (project_id) DO UPDATE
       SET next_sequence = project_action_sequence.next_sequence + 1
     RETURNING next_sequence - 1 AS sequence`,
    [projectId],
  );
  return Number(result.rows[0]?.sequence);
}

async function validateActionLinks(
  client: PoolClient,
  projectId: string,
  packageIds: string[],
  governanceTierId: string | null,
  gateId: string | null,
) {
  const uniquePackageIds = [...new Set(packageIds)];
  if (uniquePackageIds.length !== packageIds.length) {
    throw new Error("One or more selected Packages are invalid.");
  }
  if (uniquePackageIds.length > 0) {
    const packages = await client.query(
      `SELECT id FROM project_package
       WHERE project_id = $1 AND archived_at IS NULL
         AND id = ANY($2::text[])`,
      [projectId, uniquePackageIds],
    );
    if (packages.rowCount !== uniquePackageIds.length) {
      throw new Error("One or more selected Packages are invalid.");
    }
  }
  if (governanceTierId) {
    const tier = await client.query(
      "SELECT id FROM governance_tier WHERE project_id = $1 AND id = $2",
      [projectId, governanceTierId],
    );
    if (tier.rowCount === 0) {
      throw new Error("The selected Governance Tier is invalid for this Project.");
    }
  }
  if (gateId) {
    const gate = await client.query(
      "SELECT id FROM gate WHERE project_id = $1 AND id = $2",
      [projectId, gateId],
    );
    if (gate.rowCount === 0) throw new Error("The selected Gate is invalid for this Project.");
  }
}

async function appendActionUpdate(
  client: PoolClient,
  actionId: string,
  updateActor: ActionActor,
  occurredAt: string,
  kind: "comment" | "change",
  updateText: string,
  changes: ProjectActionChange[] = [],
) {
  const sequenceResult = await client.query(
    `SELECT coalesce(max(sequence), 0) + 1 AS sequence
     FROM project_action_update WHERE action_id = $1`,
    [actionId],
  );
  await client.query(
    `INSERT INTO project_action_update (
       id, action_id, sequence, occurred_at, actor_user_id,
       actor_display_name, kind, text, changes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      randomUUID(),
      actionId,
      Number(sequenceResult.rows[0]?.sequence),
      occurredAt,
      updateActor.userId,
      updateActor.displayName,
      kind,
      updateText,
      JSON.stringify(changes),
    ],
  );
}

async function replaceActionPackages(
  client: PoolClient,
  actionId: string,
  projectId: string,
  packageIds: string[],
) {
  await client.query("DELETE FROM project_action_package WHERE action_id = $1", [actionId]);
  for (const [index, packageId] of packageIds.entries()) {
    await client.query(
      `INSERT INTO project_action_package (
         action_id, package_id, project_id, sequence
       ) VALUES ($1, $2, $3, $4)`,
      [actionId, packageId, projectId, index + 1],
    );
  }
}

async function createAction(
  client: PoolClient,
  projectId: string,
  input: {
    description: string;
    assignee: string;
    dueDate: string | null;
    status: ProjectActionStatus;
    priority: ProjectAction["priority"];
    packageIds: string[];
    governanceTierId: string | null;
    gateId: string | null;
    initialUpdate: string | null;
  },
  loggedBy: ActionActor,
  source: ProjectAction["source"],
  packageAssociationLocked: boolean,
  loggedMessage: string,
) {
  const project = await client.query(
    "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
    [projectId],
  );
  if (project.rowCount === 0) throw new Error("Project not found.");
  if (source === "gate" && input.gateId) {
    const gateRow = await client.query(
      `SELECT gate.id, gate.package_id, gate.stage_id, gate.status,
              project.current_stage AS project_stage,
              package.current_stage AS package_stage
       FROM gate
       JOIN project ON project.id = gate.project_id
       LEFT JOIN project_package AS package ON package.id = gate.package_id
       WHERE gate.project_id = $1 AND gate.id = $2
       FOR UPDATE OF gate`,
      [projectId, input.gateId],
    );
    const gate = gateRow.rows[0];
    const currentStage = gate?.package_id ? gate.package_stage : gate?.project_stage;
    if (
      !gate ||
      gate.stage_id !== currentStage ||
      (gate.status !== "not_submitted" && gate.status !== "returned_for_rework")
    ) {
      throw new Error("Gate Actions can only be created while the current Gate is in preparation.");
    }
    const activeCycle = await client.query(
      `SELECT 1 FROM gate_review_cycle
       WHERE gate_id = $1 AND status = 'awaiting_approval'`,
      [input.gateId],
    );
    if (activeCycle.rowCount !== 0) {
      throw new Error("Gate Actions can only be created while the current Gate is in preparation.");
    }
  }
  await validateActionLinks(
    client,
    projectId,
    input.packageIds,
    input.governanceTierId,
    input.gateId,
  );
  const id = randomUUID();
  const sequence = await allocateProjectActionSequence(client, projectId);
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO project_action (
       id, project_id, sequence, description, assignee, due_date, status,
       priority, governance_tier_id, gate_id, source,
       package_association_locked, logged_by_user_id, logged_by_display_name,
       date_logged, closing_date, last_updated
     ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, NULL, $15)`,
    [
      id,
      projectId,
      sequence,
      input.description,
      input.assignee,
      input.dueDate,
      input.status,
      input.priority,
      input.governanceTierId,
      input.gateId,
      source,
      packageAssociationLocked,
      loggedBy.userId,
      loggedBy.displayName,
      now,
    ],
  );
  await replaceActionPackages(client, id, projectId, input.packageIds);
  await appendActionUpdate(client, id, loggedBy, now, "change", loggedMessage, [
    { field: "status", from: null, to: input.status },
  ]);
  if (input.initialUpdate) {
    await appendActionUpdate(
      client,
      id,
      loggedBy,
      now,
      "comment",
      input.initialUpdate,
    );
  }
  const action = await loadProjectAction(client, projectId, id);
  if (!action) throw new Error("The Action could not be loaded after creation.");
  return action;
}

export async function createManualProjectAction(
  projectId: string,
  input: ProjectActionInput,
  loggedBy: ActionActor,
) {
  if (input.status === "closed") {
    throw new Error("Create the Action before closing it.");
  }
  return withOperationalTransaction((client) =>
    createAction(
      client,
      projectId,
      input,
      loggedBy,
      "manual",
      false,
      "Action logged.",
    ),
  );
}

export async function createGateProjectAction(
  projectId: string,
  gateId: string,
  packageIds: string[],
  packageAssociationLocked: boolean,
  input: GateProjectActionInput,
  loggedBy: ActionActor,
) {
  return withOperationalTransaction((client) =>
    createAction(
      client,
      projectId,
      {
        ...input,
        status: "new",
        packageIds,
        governanceTierId: null,
        gateId,
      },
      loggedBy,
      "gate",
      packageAssociationLocked,
      "Gate Action logged.",
    ),
  );
}

async function lockAction(
  client: PoolClient,
  projectId: string,
  actionId: string,
) {
  const project = await client.query(
    "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
    [projectId],
  );
  if (project.rowCount === 0) throw new Error("Action not found.");
  const result = await client.query(
    `SELECT id FROM project_action
     WHERE project_id = $1 AND id = $2
     FOR UPDATE`,
    [projectId, actionId],
  );
  if (result.rowCount === 0) throw new Error("Action not found.");
  const action = await loadProjectAction(client, projectId, actionId);
  if (!action) throw new Error("Action not found.");
  return action;
}

type GateFollowUpReconciliationActor = {
  userId: string | null;
  displayName: string;
  providerTenantId?: string | null;
  providerObjectId?: string | null;
  accessClass?: CurrentUser["accessClass"] | null;
  authenticationMethod?: string | null;
};

async function lockReliableActionGates(
  client: PoolClient,
  projectId: string,
  actionId: string,
) {
  const project = await client.query(
    "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
    [projectId],
  );
  if (project.rowCount === 0) throw new Error("Action not found.");
  const references = await client.query(
    `SELECT DISTINCT reference.gate_id
     FROM action_gate_decision_reference AS reference
     JOIN gate_review_cycle AS cycle
       ON cycle.id = reference.review_cycle_id
      AND cycle.gate_id = reference.gate_id
     WHERE reference.project_id = $1
       AND reference.action_id = $2
       AND reference.review_cycle_id IS NOT NULL
     ORDER BY reference.gate_id`,
    [projectId, actionId],
  );
  const gateIds = references.rows.map((row) => String(row.gate_id));
  if (gateIds.length > 0) {
    await client.query(
      `SELECT id FROM gate
       WHERE project_id = $1 AND id = ANY($2::text[])
       ORDER BY id FOR UPDATE`,
      [projectId, gateIds],
    );
  }
}

async function appendGateFollowUpReconciliationAudit(
  client: PoolClient,
  projectId: string,
  gateId: string,
  reviewCycleId: string,
  triggeringActionId: string,
  fromStatus: Gate["status"],
  toStatus: Gate["status"],
  resolvedActionCount: number,
  unresolvedActionCount: number,
  actor: GateFollowUpReconciliationActor,
) {
  const hasProviderIdentity = Boolean(
    actor.providerTenantId && actor.providerObjectId,
  );
  await client.query(
    `INSERT INTO audit_event (
       request_id, actor_user_id, actor_provider_tenant_id,
       actor_provider_object_id, actor_access_class, project_id, event_type,
       resource_type, resource_id, change_summary, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, 'gate.follow_up_status_reconciled',
       'gate', $7, $8::jsonb, $9::jsonb)`,
    [
      randomUUID(),
      actor.userId,
      hasProviderIdentity ? actor.providerTenantId : null,
      hasProviderIdentity ? actor.providerObjectId : null,
      actor.accessClass ?? null,
      projectId,
      gateId,
      JSON.stringify({
        gateStatusFrom: fromStatus,
        gateStatusTo: toStatus,
      }),
      JSON.stringify({
        reviewCycleId,
        triggeringActionId,
        resolvedActionCount,
        unresolvedActionCount,
        triggeredByDisplayName: actor.displayName,
        authenticationMethod: actor.authenticationMethod ?? null,
      }),
    ],
  );
}

async function reconcileGateFollowUpStatus(
  client: PoolClient,
  projectId: string,
  gateId: string,
  triggeringActionId: string,
  actor: GateFollowUpReconciliationActor,
) {
  const controllingCycleResult = await client.query(
    `SELECT cycle.id, cycle.decision,
            jsonb_array_length(
              coalesce(cycle.frozen_evidence -> 'acceptedActions', '[]'::jsonb)
            )::integer AS frozen_action_count
     FROM gate_review_cycle AS cycle
     WHERE cycle.gate_id = $1
       AND cycle.decision IS NOT NULL
       AND cycle.status IN ('approved', 'approved_with_actions')
     ORDER BY cycle.cycle_number DESC, cycle.id DESC
     LIMIT 1`,
    [gateId],
  );
  const controllingCycle = controllingCycleResult.rows[0];
  if (!controllingCycle || controllingCycle.decision !== "approved_with_actions") {
    return;
  }

  const linkedActions = await client.query(
    `SELECT action.id, action.status
     FROM action_gate_decision_reference AS reference
     JOIN project_action AS action
       ON action.id = reference.action_id
      AND action.project_id = reference.project_id
     WHERE reference.project_id = $1
       AND reference.gate_id = $2
       AND reference.review_cycle_id = $3
       AND reference.decision = 'approved_with_actions'
     ORDER BY action.sequence, action.id`,
    [projectId, gateId, String(controllingCycle.id)],
  );
  const frozenActionCount = Number(controllingCycle.frozen_action_count);
  if (linkedActions.rowCount === 0 || linkedActions.rowCount !== frozenActionCount) {
    return;
  }

  const unresolvedActionCount = linkedActions.rows.filter(
    (row) => row.status !== "closed",
  ).length;
  const resolvedActionCount = linkedActions.rows.length - unresolvedActionCount;
  const targetStatus: Gate["status"] = unresolvedActionCount === 0
    ? "approved"
    : "approved_with_actions";
  const updated = await client.query(
    `UPDATE gate SET status = $3
     WHERE project_id = $1 AND id = $2
       AND status IN ('approved', 'approved_with_actions')
       AND status IS DISTINCT FROM $3
     RETURNING status`,
    [projectId, gateId, targetStatus],
  );
  if (updated.rowCount !== 1) return;
  const fromStatus: Gate["status"] = targetStatus === "approved"
    ? "approved_with_actions"
    : "approved";
  await appendGateFollowUpReconciliationAudit(
    client,
    projectId,
    gateId,
    String(controllingCycle.id),
    triggeringActionId,
    fromStatus,
    targetStatus,
    resolvedActionCount,
    unresolvedActionCount,
    actor,
  );
}

async function reconcileActionGateFollowUpStatus(
  client: PoolClient,
  projectId: string,
  actionId: string,
  actor: GateFollowUpReconciliationActor,
) {
  const gateResult = await client.query(
    `SELECT DISTINCT reference.gate_id
     FROM action_gate_decision_reference AS reference
     JOIN gate_review_cycle AS cycle
       ON cycle.id = reference.review_cycle_id
      AND cycle.gate_id = reference.gate_id
     WHERE reference.project_id = $1
       AND reference.action_id = $2
       AND reference.review_cycle_id IS NOT NULL
     ORDER BY reference.gate_id`,
    [projectId, actionId],
  );
  for (const row of gateResult.rows) {
    await reconcileGateFollowUpStatus(
      client,
      projectId,
      String(row.gate_id),
      actionId,
      actor,
    );
  }
}

function sameValues(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export async function updateProjectAction(
  projectId: string,
  actionId: string,
  input: ProjectActionInput,
  updatedBy: ActionActor,
) {
  return withOperationalTransaction(async (client) => {
    const action = await lockAction(client, projectId, actionId);
    if (action.status === "closed" && input.status !== "closed") {
      throw new Error("Use Reopen to reopen a Closed Action.");
    }
    if (action.status !== "closed" && input.status === "closed") {
      throw new Error("Use Close to close an Action.");
    }
    const nextPackageIds = action.packageAssociationLocked
      ? action.packageIds
      : input.packageIds;
    const nextGateId = action.source === "gate" ? action.gateId : input.gateId;
    await validateActionLinks(
      client,
      projectId,
      nextPackageIds,
      input.governanceTierId,
      nextGateId,
    );
    const changes: ProjectActionChange[] = [];
    const addChange = (
      field: string,
      from: string | string[] | null,
      to: string | string[] | null,
    ) => {
      if (Array.isArray(from) && Array.isArray(to)) {
        if (!sameValues(from, to)) changes.push({ field, from, to });
      } else if (from !== to) {
        changes.push({ field, from, to });
      }
    };
    addChange("description", action.description, input.description);
    addChange("assignee", action.assignee, input.assignee);
    addChange("dueDate", action.dueDate, input.dueDate);
    addChange("status", action.status, input.status);
    addChange("priority", action.priority, input.priority);
    addChange("packageIds", action.packageIds, nextPackageIds);
    addChange("governanceTierId", action.governanceTierId, input.governanceTierId);
    addChange("gateId", action.gateId, nextGateId);
    if (changes.length === 0 && !input.initialUpdate) return action;
    const now = new Date().toISOString();
    await client.query(
      `UPDATE project_action SET description = $3, assignee = $4,
         due_date = $5::date, status = $6, priority = $7,
         governance_tier_id = $8, gate_id = $9, last_updated = $10,
         lock_version = lock_version + 1
       WHERE project_id = $1 AND id = $2`,
      [
        projectId,
        actionId,
        input.description,
        input.assignee,
        input.dueDate,
        input.status,
        input.priority,
        input.governanceTierId,
        nextGateId,
        now,
      ],
    );
    if (!sameValues(action.packageIds, nextPackageIds)) {
      await replaceActionPackages(client, actionId, projectId, nextPackageIds);
    }
    if (changes.length > 0) {
      await appendActionUpdate(
        client,
        actionId,
        updatedBy,
        now,
        "change",
        "Action fields updated.",
        changes,
      );
    }
    if (input.initialUpdate) {
      await appendActionUpdate(
        client,
        actionId,
        updatedBy,
        now,
        "comment",
        input.initialUpdate,
      );
    }
    return loadProjectAction(client, projectId, actionId);
  });
}

export async function addProjectActionUpdate(
  projectId: string,
  actionId: string,
  updateText: string,
  updatedBy: ActionActor,
) {
  return withOperationalTransaction(async (client) => {
    await lockAction(client, projectId, actionId);
    const now = new Date().toISOString();
    await appendActionUpdate(
      client,
      actionId,
      updatedBy,
      now,
      "comment",
      updateText,
    );
    await client.query(
      `UPDATE project_action SET last_updated = $3,
         lock_version = lock_version + 1
       WHERE project_id = $1 AND id = $2`,
      [projectId, actionId, now],
    );
    return loadProjectAction(client, projectId, actionId);
  });
}

export async function closeProjectAction(
  projectId: string,
  actionId: string,
  closedBy: ActionActor,
  comment: string | null,
  reconciliationActor?: CurrentUser,
) {
  return withOperationalTransaction(async (client) => {
    await lockReliableActionGates(client, projectId, actionId);
    const action = await lockAction(client, projectId, actionId);
    if (action.status === "closed") return action;
    const now = new Date().toISOString();
    await client.query(
      `UPDATE project_action SET status = 'closed', closing_date = $3,
         last_updated = $3, lock_version = lock_version + 1
       WHERE project_id = $1 AND id = $2`,
      [projectId, actionId, now],
    );
    await appendActionUpdate(client, actionId, closedBy, now, "change", "Action closed.", [
      { field: "status", from: action.status, to: "closed" },
      { field: "closingDate", from: action.closingDate, to: now },
    ]);
    if (comment) {
      await appendActionUpdate(client, actionId, closedBy, now, "comment", comment);
    }
    await reconcileActionGateFollowUpStatus(client, projectId, actionId, {
      userId: reconciliationActor?.id ?? closedBy.userId,
      displayName: reconciliationActor?.displayName ?? closedBy.displayName,
      providerTenantId: reconciliationActor?.providerTenantId,
      providerObjectId: reconciliationActor?.providerObjectId,
      accessClass: reconciliationActor?.accessClass,
      authenticationMethod: reconciliationActor ? "microsoft_entra" : null,
    });
    return loadProjectAction(client, projectId, actionId);
  });
}

export async function reopenProjectAction(
  projectId: string,
  actionId: string,
  status: ReopenedProjectActionStatus,
  reopenedBy: ActionActor,
  comment: string | null,
  reconciliationActor?: CurrentUser,
) {
  return withOperationalTransaction(async (client) => {
    await lockReliableActionGates(client, projectId, actionId);
    const action = await lockAction(client, projectId, actionId);
    if (action.status !== "closed") {
      throw new Error("Only a Closed Action can be reopened.");
    }
    const now = new Date().toISOString();
    await client.query(
      `UPDATE project_action SET status = $3, closing_date = NULL,
         last_updated = $4, lock_version = lock_version + 1
       WHERE project_id = $1 AND id = $2`,
      [projectId, actionId, status, now],
    );
    await appendActionUpdate(
      client,
      actionId,
      reopenedBy,
      now,
      "change",
      "Action reopened.",
      [
        { field: "status", from: "closed", to: status },
        { field: "closingDate", from: action.closingDate, to: null },
      ],
    );
    if (comment) {
      await appendActionUpdate(client, actionId, reopenedBy, now, "comment", comment);
    }
    await reconcileActionGateFollowUpStatus(client, projectId, actionId, {
      userId: reconciliationActor?.id ?? reopenedBy.userId,
      displayName: reconciliationActor?.displayName ?? reopenedBy.displayName,
      providerTenantId: reconciliationActor?.providerTenantId,
      providerObjectId: reconciliationActor?.providerObjectId,
      accessClass: reconciliationActor?.accessClass,
      authenticationMethod: reconciliationActor ? "microsoft_entra" : null,
    });
    return loadProjectAction(client, projectId, actionId);
  });
}

async function protectGateActions(
  client: PoolClient,
  projectId: string,
  gateId: string,
  acceptedActionIds: string[],
  reviewCycleId: string,
): Promise<GateActionProtectionResult> {
  const uniqueIds = [...new Set(acceptedActionIds)];
  const result = uniqueIds.length > 0
    ? await client.query(
        `SELECT id, sequence, description, assignee, due_date::text AS due_date,
                status
         FROM project_action
         WHERE project_id = $1 AND source = 'gate' AND gate_id = $2
           AND id = ANY($3::text[])
         ORDER BY sequence, id FOR UPDATE`,
        [projectId, gateId, uniqueIds],
      )
    : { rows: [], rowCount: 0 };
  if (result.rowCount !== uniqueIds.length) {
    return { outcome: "accepted_actions_missing" };
  }
  const now = new Date().toISOString();
  const referenceIds: string[] = [];
  for (const row of result.rows) {
    const actionId = String(row.id);
    const sequenceResult = await client.query(
      `SELECT coalesce(max(sequence), 0) + 1 AS sequence
       FROM action_gate_decision_reference WHERE action_id = $1`,
      [actionId],
    );
    const referenceId = randomUUID();
    referenceIds.push(referenceId);
    await client.query(
      `INSERT INTO action_gate_decision_reference (
         id, action_id, gate_id, project_id, sequence, decision, recorded_at,
          review_cycle_id, action_sequence_at_approval,
          description_at_approval, assignee_at_approval,
          due_date_at_approval, status_at_approval
        ) VALUES ($1, $2, $3, $4, $5, 'approved_with_actions', $6, $7,
          $8, $9, $10, $11::date, $12)`,
      [
        referenceId,
        actionId,
        gateId,
        projectId,
        Number(sequenceResult.rows[0]?.sequence),
        now,
        reviewCycleId,
        Number(row.sequence),
        String(row.description),
        String(row.assignee),
        row.due_date == null ? null : String(row.due_date),
        String(row.status),
      ],
    );
  }
  const actions = await loadProjectActions(client, projectId);
  return {
    outcome: "protected",
    actions: actions.filter((action) => uniqueIds.includes(action.id)),
    referenceIds,
  };
}

export async function protectGateActionsForDecision(
  projectId: string,
  gateId: string,
  decision: "approved_with_actions",
  acceptedActionIds: string[],
  reviewCycleId: string,
) {
  void decision;
  return withOperationalTransaction((client) =>
    protectGateActions(
      client,
      projectId,
      gateId,
      acceptedActionIds,
      reviewCycleId,
    ),
  );
}

export async function deleteProjectAction(
  projectId: string,
  actionId: string,
): Promise<ProjectActionDeletionResult> {
  return withOperationalTransaction(async (client) => {
    await lockAction(client, projectId, actionId);
    const references = await client.query(
      "SELECT 1 FROM action_gate_decision_reference WHERE action_id = $1 LIMIT 1",
      [actionId],
    );
    if (references.rowCount && references.rowCount > 0) {
      return {
        deleted: false,
        reason:
          "This Gate Action formed part of a finalized Gate decision and must remain in the governance history.",
      };
    }
    const activeEvidence = await client.query(
      `SELECT 1
       FROM gate_review_cycle AS cycle
       JOIN gate ON gate.id = cycle.gate_id
       CROSS JOIN LATERAL jsonb_array_elements(
         cycle.frozen_evidence -> 'acceptedActions'
       ) AS accepted_action
       WHERE gate.project_id = $1
         AND cycle.status = 'awaiting_approval'
         AND accepted_action ->> 'actionId' = $2
       LIMIT 1`,
      [projectId, actionId],
    );
    if (activeEvidence.rowCount && activeEvidence.rowCount > 0) {
      return {
        deleted: false,
        reason:
          "This Gate Action is accepted in an active Review Cycle and must remain available until the review is complete.",
      };
    }
    await client.query(
      "DELETE FROM project_action WHERE project_id = $1 AND id = $2",
      [projectId, actionId],
    );
    return { deleted: true };
  });
}

export async function deleteActionsForProject(projectId: string) {
  return withOperationalTransaction(async (client) => {
    const actions = await client.query(
      `SELECT id FROM project_action
       WHERE project_id = $1 ORDER BY sequence, id FOR UPDATE`,
      [projectId],
    );
    const references = await client.query(
      `SELECT 1 FROM action_gate_decision_reference AS reference
       JOIN project_action AS action ON action.id = reference.action_id
       WHERE action.project_id = $1 LIMIT 1`,
      [projectId],
    );
    if (references.rowCount && references.rowCount > 0) {
      throw new Error(
        "This Project contains Gate Actions retained as finalized governance history.",
      );
    }
    await client.query("DELETE FROM project_action WHERE project_id = $1", [projectId]);
    return actions.rowCount ?? 0;
  });
}

async function submitSpecificGateForApproval(
  client: PoolClient,
  scope: Scope,
  gateId: string,
  submittedBy?: GateReviewActorSnapshot,
): Promise<GateSubmissionResult<Project | ProjectPackage> | null> {
  let gate = await lockScopeGate(client, scope, gateId);
  if (!gate) return null;
  const project = await loadProject(client, scope.projectId);
  const entity = scope.packageId
    ? await loadPackage(client, scope.projectId, scope.packageId)
    : project;
  if (!project || !entity) return null;
  const currentStage = scope.packageId
    ? (entity as ProjectPackage).currentStage
    : (entity as Project).currentStage;
  if (gate.stageId !== currentStage) return { outcome: "not_current" };
  if (!isGateInPreparation(gate)) return { outcome: "not_in_preparation" };

  const templates = scope.packageId
    ? packageGateTemplates
    : getProjectGateTemplates(project.validationRequired);
  const gateStageId = gate.stageId;
  const template = templates.find((candidate) => candidate.stageId === gateStageId);
  if (template) {
    await synchronizeGateDefaultDeliverables(client, scope, gate, template);
    gate = await loadGate(client, scope.projectId, scope.packageId, gateId);
    if (!gate) return null;
  }
  await lockScopeMatrixGates(client, scope);
  const matrixReview = await loadGateMatrixReviewContext(client, scope, gateId);
  if (!matrixReview) return null;
  const deliverables = await loadGateDeliverables(
    client,
    scope.projectId,
    scope.packageId,
    gateId,
  );
  const gateActions = (await loadProjectActions(client, scope.projectId)).filter(
    (action) => action.source === "gate" && action.gateId === gateId,
  );
  const isMethodologyGate = gate.stageId === (scope.packageId ? "definition" : "initiation");
  let scopeApplicability: Parameters<typeof getGateSubmissionIssues>[3];
  if (isMethodologyGate) {
    const review = await getApplicabilityReview(scope.projectId, scope.packageId);
    if (!review) return null;
    const allItems = review.gates.flatMap((entry) => [
      ...entry.deliverables,
    ]);
    scopeApplicability = {
      scopeLabel: scope.packageId ? "Package" : "Project",
      items: allItems,
    };
  }
  const issues = [
    ...getGateSubmissionIssues(
      gate,
      deliverables,
      gateActions,
      scopeApplicability,
    ),
    ...getMatrixReviewSubmissionIssues(matrixReview.state),
  ];
  if (issues.length > 0) return { outcome: "blocked", issues };
  if (!matrixReview.state.confirmation) {
    throw new Error("A valid Applicability Matrix confirmation could not be loaded.");
  }

  const now = new Date().toISOString();
  const reviewCycle = createGateReviewCycle({
    id: randomUUID(),
    submittedAt: now,
    submittedBy: submittedBy ?? {
      userId: null,
      displayName: project.projectManager,
      email: null,
    },
    project: {
      id: project.id,
      projectNumber: project.projectNumber,
      name: project.name,
    },
    package: scope.packageId
      ? {
          id: (entity as ProjectPackage).id,
          packageCode: (entity as ProjectPackage).packageCode,
          name: (entity as ProjectPackage).packageName,
        }
      : null,
    gate,
    stageLabel: scope.packageId
      ? packageStageLabel(gate.stageId)
      : projectStageLabel(gate.stageId),
    deliverables,
    gateActions,
    applicabilityMatrix: matrixReview.matrix,
    matrixReviewConfirmation: matrixReview.state.confirmation,
  });
  await insertReviewCycle(client, gateId, reviewCycle);
  await client.query(
    "UPDATE gate SET status = 'submitted_for_approval' WHERE id = $1",
    [gateId],
  );
  await touchScope(client, scope, now);
  const updatedEntity = scope.packageId
    ? await loadPackage(client, scope.projectId, scope.packageId)
    : await loadProject(client, scope.projectId);
  const updatedGate = await loadGate(client, scope.projectId, scope.packageId, gateId);
  const storedCycle = updatedGate?.reviewCycles.find(
    (candidate) => candidate.id === reviewCycle.id,
  );
  if (!updatedEntity || !storedCycle) {
    throw new Error("The submitted Gate Review could not be loaded.");
  }
  return { outcome: "submitted", entity: updatedEntity, reviewCycle: storedCycle };
}

async function insertReviewCycle(
  client: PoolClient,
  gateId: string,
  cycle: Gate["reviewCycles"][number],
) {
  await client.query(
    `INSERT INTO gate_review_cycle (
       id, gate_id, schema_version, cycle_number, previous_cycle_id,
       project_snapshot, package_snapshot, gate_snapshot, status, submitted_at,
       submitted_by, submitted_by_user_id, decision, decision_comments,
       completed_at, withdrawn_at, withdrawn_by, withdrawn_by_user_id,
       withdrawal_reason, frozen_evidence
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9,
       $10, $11::jsonb, $12, $13, $14, $15, $16, $17::jsonb, $18, $19,
       $20::jsonb)`,
    [
      cycle.id,
      gateId,
      cycle.schemaVersion,
      cycle.cycleNumber,
      cycle.previousCycleId,
      JSON.stringify(cycle.project),
      cycle.package ? JSON.stringify(cycle.package) : null,
      JSON.stringify(cycle.gate),
      cycle.status,
      cycle.submittedAt,
      JSON.stringify(cycle.submittedBy),
      cycle.submittedBy.userId,
      cycle.decision,
      cycle.decisionComments,
      cycle.completedAt,
      cycle.withdrawnAt,
      cycle.withdrawnBy ? JSON.stringify(cycle.withdrawnBy) : null,
      cycle.withdrawnBy?.userId ?? null,
      cycle.withdrawalReason,
      JSON.stringify(cycle.frozenEvidence),
    ],
  );
  for (const [index, approver] of cycle.approvers.entries()) {
    approver.authenticationMethod = "email_otp";
    approver.reviewAccessId = randomUUID();
    approver.assignedUserId = null;
    approver.expectedProviderTenantId = null;
    approver.expectedProviderObjectId = null;
    await client.query(
       `INSERT INTO gate_review_cycle_approver (
          review_cycle_id, gate_approver_id, sequence, name, email,
          role_function, approval_role, approval_level, assigned_user_id,
          invitation_activated_at, expected_provider_tenant_id,
          expected_provider_object_id, authentication_method, review_access_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        cycle.id,
        approver.gateApproverId,
        index + 1,
        approver.name,
        approver.email,
        approver.roleFunction,
        approver.approvalRole,
        approver.approvalLevel,
        approver.assignedUserId,
        approver.invitation?.activatedAt ?? null,
        approver.expectedProviderTenantId,
        approver.expectedProviderObjectId,
        approver.authenticationMethod,
        approver.reviewAccessId,
      ],
    );
  }
}

export async function submitProjectGateForApproval(
  projectId: string,
  gateId: string,
  submittedBy?: GateReviewActorSnapshot,
): Promise<GateSubmissionResult<Project> | null> {
  return withOperationalTransaction(async (client) => {
    const result = await submitSpecificGateForApproval(
      client,
      { projectId, packageId: null },
      gateId,
      submittedBy,
    );
    return result as GateSubmissionResult<Project> | null;
  });
}

export async function submitPackageGateForApproval(
  projectId: string,
  packageId: string,
  gateId: string,
  submittedBy?: GateReviewActorSnapshot,
): Promise<GateSubmissionResult<ProjectPackage> | null> {
  return withOperationalTransaction(async (client) => {
    const result = await submitSpecificGateForApproval(
      client,
      { projectId, packageId },
      gateId,
      submittedBy,
    );
    return result as GateSubmissionResult<ProjectPackage> | null;
  });
}

async function withdrawGateSubmission(
  client: PoolClient,
  scope: Scope,
  gateId: string,
  withdrawalReason: string,
  withdrawnBy: GateReviewActorSnapshot,
) {
  const gate = await lockScopeGate(client, scope, gateId);
  if (!gate) return null;
  if (!withdrawnBy.userId || !withdrawnBy.providerTenantId || !withdrawnBy.providerObjectId) {
    throw new Error("An authenticated Project Owner is required to withdraw a Gate Review Cycle.");
  }
  const ownerResult = await client.query(
    `SELECT app_user.id, app_user.display_name, app_user.email,
            user_identity.provider_tenant_id, user_identity.provider_object_id
     FROM project_membership
     JOIN app_user ON app_user.id = project_membership.user_id
     JOIN user_identity
       ON user_identity.user_id = app_user.id
      AND user_identity.provider = 'microsoft'
     WHERE project_membership.project_id = $1
       AND project_membership.user_id = $2
       AND project_membership.role = 'owner'
       AND app_user.status = 'active'
       AND app_user.access_class = 'internal'
       AND user_identity.provider_tenant_id = $3
       AND user_identity.provider_object_id = $4`,
    [
      scope.projectId,
      withdrawnBy.userId,
      withdrawnBy.providerTenantId,
      withdrawnBy.providerObjectId,
    ],
  );
  if (ownerResult.rowCount !== 1) {
    throw new Error("Only an authenticated Project Owner may withdraw a Gate Review Cycle.");
  }
  const owner = ownerResult.rows[0];
  const authenticatedOwner: GateReviewActorSnapshot = {
    userId: String(owner.id),
    displayName: String(owner.display_name),
    email: String(owner.email),
    providerTenantId: String(owner.provider_tenant_id),
    providerObjectId: String(owner.provider_object_id),
  };
  const project = await loadProject(client, scope.projectId);
  const entity = scope.packageId
    ? await loadPackage(client, scope.projectId, scope.packageId)
    : project;
  if (!project || !entity) return null;
  const currentStage = scope.packageId
    ? (entity as ProjectPackage).currentStage
    : (entity as Project).currentStage;
  if (gate.stageId !== currentStage) return { outcome: "not_current" as const };
  const now = new Date().toISOString();
  const result = withdrawGateReviewCycle(gate, {
    withdrawnAt: now,
    withdrawnBy: authenticatedOwner,
    withdrawalReason,
  });
  if (result.outcome !== "withdrawn") return result;
  const cycleUpdate = await client.query(
    `UPDATE gate_review_cycle SET status = 'withdrawn', completed_at = $2,
       withdrawn_at = $2, withdrawn_by = $3::jsonb,
       withdrawn_by_user_id = $4, withdrawal_reason = $5
     WHERE id = $1 AND status = 'awaiting_approval' AND decision IS NULL
     RETURNING id`,
    [
      result.reviewCycle.id,
      now,
      JSON.stringify(result.reviewCycle.withdrawnBy),
      result.reviewCycle.withdrawnBy?.userId,
      result.reviewCycle.withdrawalReason,
    ],
  );
  if (cycleUpdate.rowCount !== 1) return { outcome: "not_submitted" as const };
  const gateUpdate = await client.query(
    `UPDATE gate SET status = 'not_submitted'
     WHERE id = $1 AND status = 'submitted_for_approval'
     RETURNING id`,
    [gateId],
  );
  if (gateUpdate.rowCount !== 1) {
    throw new Error("The active Gate could not be returned to preparation.");
  }
  await touchScope(client, scope, now);
  const updated = scope.packageId
    ? await loadPackage(client, scope.projectId, scope.packageId)
    : await loadProject(client, scope.projectId);
  const updatedGate = await loadGate(client, scope.projectId, scope.packageId, gateId);
  const reviewCycle = updatedGate?.reviewCycles.find(
    (candidate) => candidate.id === result.reviewCycle.id,
  );
  if (!updated || !reviewCycle) throw new Error("The withdrawn Review Cycle could not be loaded.");
  return { outcome: "withdrawn" as const, entity: updated, reviewCycle };
}

export async function withdrawProjectGateSubmission(
  projectId: string,
  gateId: string,
  withdrawalReason: string,
  withdrawnBy: GateReviewActorSnapshot,
): Promise<GateWithdrawalResult<Project> | null> {
  return withOperationalTransaction(async (client) =>
    withdrawGateSubmission(
      client,
      { projectId, packageId: null },
      gateId,
      withdrawalReason,
      withdrawnBy,
    ) as Promise<
      GateWithdrawalResult<Project> | null
    >,
  );
}

export async function withdrawPackageGateSubmission(
  projectId: string,
  packageId: string,
  gateId: string,
  withdrawalReason: string,
  withdrawnBy: GateReviewActorSnapshot,
): Promise<GateWithdrawalResult<ProjectPackage> | null> {
  return withOperationalTransaction(async (client) =>
    withdrawGateSubmission(
      client,
      { projectId, packageId },
      gateId,
      withdrawalReason,
      withdrawnBy,
    ) as Promise<
      GateWithdrawalResult<ProjectPackage> | null
    >,
  );
}

async function reopenGate(client: PoolClient, scope: Scope, gateId: string) {
  const gate = await lockScopeGate(client, scope, gateId);
  if (!gate) return null;
  if (gate.status === "approved" || gate.status === "approved_with_actions") {
    const now = new Date().toISOString();
    await client.query("UPDATE gate SET status = 'not_submitted' WHERE id = $1", [gateId]);
    await touchScope(client, scope, now);
  }
  return scope.packageId
    ? loadPackage(client, scope.projectId, scope.packageId)
    : loadProject(client, scope.projectId);
}

export function reopenProjectGate(projectId: string, gateId: string) {
  return withOperationalTransaction((client) =>
    reopenGate(client, { projectId, packageId: null }, gateId),
  ) as Promise<Project | null>;
}

export function reopenPackageGate(
  projectId: string,
  packageId: string,
  gateId: string,
) {
  return withOperationalTransaction((client) =>
    reopenGate(client, { projectId, packageId }, gateId),
  ) as Promise<ProjectPackage | null>;
}

export async function returnProjectToPreviousStage(projectId: string) {
  return withOperationalTransaction(async (client) => {
    const lock = await client.query(
      `SELECT current_stage, validation_required FROM project
       WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
      [projectId],
    );
    if (lock.rowCount === 0) return null;
    const project = await loadProject(client, projectId);
    if (!project) return null;
    if (project.gates.some((gate) => gate.status === "submitted_for_approval")) {
      return project;
    }
    const previous = lifecyclePrevious(
      projectLifecycle(project.validationRequired),
      project.currentStage,
    );
    if (!previous) return project;
    await client.query(
      "UPDATE project SET current_stage = $2, updated_at = $3 WHERE id = $1",
      [projectId, previous, new Date().toISOString()],
    );
    return loadProject(client, projectId);
  });
}

export async function returnPackageToPreviousStage(
  projectId: string,
  packageId: string,
) {
  return withOperationalTransaction(async (client) => {
    const lock = await client.query(
      `SELECT package.current_stage FROM project_package AS package
       JOIN project ON project.id = package.project_id
       WHERE package.project_id = $1 AND package.id = $2
         AND package.archived_at IS NULL AND project.archived_at IS NULL
       FOR UPDATE OF package`,
      [projectId, packageId],
    );
    if (lock.rowCount === 0) return null;
    const projectPackage = await loadPackage(client, projectId, packageId);
    if (!projectPackage) return null;
    if (projectPackage.gates.some((gate) => gate.status === "submitted_for_approval")) {
      return projectPackage;
    }
    const previous = lifecyclePrevious(packageStageOrder, projectPackage.currentStage);
    if (!previous) return projectPackage;
    await client.query(
      `UPDATE project_package SET current_stage = $3, updated_at = $4
       WHERE project_id = $1 AND id = $2`,
      [projectId, packageId, previous, new Date().toISOString()],
    );
    return loadPackage(client, projectId, packageId);
  });
}

async function claimGateReviewInvitation(
  client: PoolClient,
  scope: Scope,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  allowFailedRetry: boolean,
): Promise<InvitationClaim | null> {
  const gate = await lockScopeGate(client, scope, gateId);
  if (!gate) return null;
  const cycleLock = await client.query(
    `SELECT id FROM gate_review_cycle
     WHERE id = $1 AND gate_id = $2 FOR UPDATE`,
    [reviewCycleId, gateId],
  );
  if (cycleLock.rowCount === 0) return null;
  const snapshotLock = await client.query(
    `SELECT * FROM gate_review_cycle_approver
     WHERE review_cycle_id = $1 AND gate_approver_id = $2
     FOR UPDATE`,
    [reviewCycleId, gateApproverId],
  );
  if (snapshotLock.rowCount === 0) return null;
  const currentGate = await loadGate(client, scope.projectId, scope.packageId, gateId);
  const cycle = currentGate?.reviewCycles.find(
    (candidate) => candidate.id === reviewCycleId,
  );
  const approver = cycle?.approvers.find(
    (candidate) => candidate.gateApproverId === gateApproverId,
  );
  if (
    !cycle ||
    !approver ||
    cycle.status !== "awaiting_approval" ||
    !approver.invitation ||
    approver.response ||
    !getGateReviewApprovalState(cycle).eligibleApprovers.some(
      (candidate) => candidate.gateApproverId === gateApproverId,
    )
  ) {
    return null;
  }
  const attemptResult = await client.query(
    `SELECT * FROM gate_review_invitation_attempt
     WHERE review_cycle_id = $1 AND gate_approver_id = $2
     ORDER BY sequence DESC, id DESC FOR UPDATE`,
    [reviewCycleId, gateApproverId],
  );
  const attempts = attemptResult.rows;
  if (attempts.some((attempt) => attempt.status === "sent" || attempt.status === "indeterminate")) {
    return null;
  }
  const dispatching = attempts.find((attempt) => attempt.status === "dispatching");
  if (dispatching) {
    const claimToken = randomUUID();
    const expiresAt = new Date(Date.now() + invitationLeaseMs).toISOString();
    const recovered = await client.query(
      `UPDATE gate_review_invitation_attempt
       SET claim_token = $2, claim_expires_at = $3
       WHERE id = $1 AND status = 'dispatching'
         AND claim_expires_at <= clock_timestamp()
       RETURNING id, idempotency_key`,
      [dispatching.id, claimToken, expiresAt],
    );
    if (recovered.rowCount === 0) return null;
    return {
      claimToken,
      attemptId: String(recovered.rows[0].id),
      idempotencyKey: String(recovered.rows[0].idempotency_key),
    };
  }
  if (attempts.length > 0 && (!allowFailedRetry || attempts[0].status !== "failed")) {
    return null;
  }
  const attemptId = randomUUID();
  const claimToken = randomUUID();
  const attemptedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + invitationLeaseMs).toISOString();
  const idempotencyKey = `gate-review-invitation/${attemptId}`;
  await client.query(
    `INSERT INTO gate_review_invitation_attempt (
       id, review_cycle_id, gate_approver_id, sequence, idempotency_key,
       provider, status, attempted_at, claim_token, claim_expires_at
     ) VALUES ($1, $2, $3, $4, $5, 'resend', 'dispatching', $6, $7, $8)`,
    [
      attemptId,
      reviewCycleId,
      gateApproverId,
      attempts.length + 1,
      idempotencyKey,
      attemptedAt,
      claimToken,
      expiresAt,
    ],
  );
  return { claimToken, attemptId, idempotencyKey };
}

async function loadInvitationClaimResult(
  client: PoolClient,
  scope: Scope,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  claim: InvitationClaim,
) {
  const gate = await loadGate(client, scope.projectId, scope.packageId, gateId);
  const reviewCycle = gate?.reviewCycles.find(
    (candidate) => candidate.id === reviewCycleId,
  );
  const approver = reviewCycle?.approvers.find(
    (candidate) => candidate.gateApproverId === gateApproverId,
  );
  const attempt = approver?.invitation?.attempts.find(
    (candidate) => candidate.id === claim.attemptId,
  );
  if (!gate || !reviewCycle || !approver || !attempt) return null;
  if (scope.packageId) {
    const projectPackage = await loadPackage(client, scope.projectId, scope.packageId);
    if (!projectPackage) return null;
    return {
      projectPackage,
      gate,
      reviewCycle,
      approver,
      attempt,
      claimToken: claim.claimToken,
    };
  }
  const project = await loadProject(client, scope.projectId);
  if (!project) return null;
  return {
    project,
    gate,
    reviewCycle,
    approver,
    attempt,
    claimToken: claim.claimToken,
  };
}

export async function claimProjectGateReviewInvitation(
  projectId: string,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  allowFailedRetry = false,
) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId, packageId: null };
    const claim = await claimGateReviewInvitation(
      client,
      scope,
      gateId,
      reviewCycleId,
      gateApproverId,
      allowFailedRetry,
    );
    return claim
      ? loadInvitationClaimResult(
          client,
          scope,
          gateId,
          reviewCycleId,
          gateApproverId,
          claim,
        )
      : null;
  });
}

export async function claimPackageGateReviewInvitation(
  projectId: string,
  packageId: string,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  allowFailedRetry = false,
) {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId, packageId };
    const claim = await claimGateReviewInvitation(
      client,
      scope,
      gateId,
      reviewCycleId,
      gateApproverId,
      allowFailedRetry,
    );
    return claim
      ? loadInvitationClaimResult(
          client,
          scope,
          gateId,
          reviewCycleId,
          gateApproverId,
          claim,
        )
      : null;
  });
}

export const recoverProjectGateReviewInvitation = claimProjectGateReviewInvitation;
export const recoverPackageGateReviewInvitation = claimPackageGateReviewInvitation;

async function completeGateReviewInvitation(
  client: PoolClient,
  scope: Scope,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  attemptId: string,
  claimToken: string,
  result: GateReviewInvitationAttemptResult,
) {
  const gate = await lockScopeGate(client, scope, gateId);
  if (!gate) return false;
  const cycle = await client.query(
    `SELECT id FROM gate_review_cycle
     WHERE id = $1 AND gate_id = $2 FOR UPDATE`,
    [reviewCycleId, gateId],
  );
  if (cycle.rowCount === 0) return false;
  const approver = await client.query(
    `SELECT review_cycle_id FROM gate_review_cycle_approver
     WHERE review_cycle_id = $1 AND gate_approver_id = $2 FOR UPDATE`,
    [reviewCycleId, gateApproverId],
  );
  if (approver.rowCount === 0) return false;
  const completedAt = new Date().toISOString();
  const completed = result.status === "sent"
    ? await client.query(
        `UPDATE gate_review_invitation_attempt
         SET status = 'sent', completed_at = $6, provider_message_id = $7,
           error_code = NULL, error_message = NULL, claim_token = NULL,
           claim_expires_at = NULL
         WHERE id = $1 AND review_cycle_id = $2 AND gate_approver_id = $3
           AND status = 'dispatching' AND claim_token = $4
           AND claim_expires_at > clock_timestamp() AND $5::text = 'sent'`,
        [
          attemptId,
          reviewCycleId,
          gateApproverId,
          claimToken,
          result.status,
          completedAt,
          result.providerMessageId,
        ],
      )
    : await client.query(
        `UPDATE gate_review_invitation_attempt
         SET status = $5, completed_at = $6, provider_message_id = NULL,
           error_code = $7, error_message = $8, claim_token = NULL,
           claim_expires_at = NULL
         WHERE id = $1 AND review_cycle_id = $2 AND gate_approver_id = $3
           AND status = 'dispatching' AND claim_token = $4
           AND claim_expires_at > clock_timestamp()`,
        [
          attemptId,
          reviewCycleId,
          gateApproverId,
          claimToken,
          result.status,
          completedAt,
          result.error.code,
          result.error.message,
        ],
      );
  return completed.rowCount === 1;
}

export async function completeProjectGateReviewInvitation(
  projectId: string,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  attemptId: string,
  claimToken: string,
  result: GateReviewInvitationAttemptResult,
) {
  return withOperationalTransaction((client) =>
    completeGateReviewInvitation(
      client,
      { projectId, packageId: null },
      gateId,
      reviewCycleId,
      gateApproverId,
      attemptId,
      claimToken,
      result,
    ),
  );
}

export async function completePackageGateReviewInvitation(
  projectId: string,
  packageId: string,
  gateId: string,
  reviewCycleId: string,
  gateApproverId: string,
  attemptId: string,
  claimToken: string,
  result: GateReviewInvitationAttemptResult,
) {
  return withOperationalTransaction((client) =>
    completeGateReviewInvitation(
      client,
      { projectId, packageId },
      gateId,
      reviewCycleId,
      gateApproverId,
      attemptId,
      claimToken,
      result,
    ),
  );
}

type OtpAssignmentRow = {
  review_cycle_id: string;
  gate_approver_id: string;
  name: string;
  email: string;
  approval_level: number;
  invitation_activated_at: Date | string | null;
  cycle_status: string;
  project_id: string;
  package_id: string | null;
  gate_id: string;
  project_snapshot: unknown;
  gate_snapshot: unknown;
};

export async function getGateReviewOtpAccess(reviewAccessId: string) {
  if (!isUuid(reviewAccessId)) return null;
  return withOperationalClient(async (client) => {
    const assignment = await loadOtpAssignment(client, reviewAccessId, false);
    if (!assignment) return null;
    return {
      maskedEmail: maskGateReviewEmail(assignment.email),
      cycleStatus: assignment.cycle_status,
      canRequestCode: await otpAssignmentIsEligible(client, assignment),
    };
  });
}

export type GateReviewOtpChallengeClaim =
  | {
      outcome: "created";
      challengeId: string;
      code: string;
      email: string;
      approverName: string;
      projectLabel: string;
      gateName: string;
    }
  | { outcome: "rate_limited" | "unavailable" };

export async function claimGateReviewOtpChallenge(
  reviewAccessId: string,
): Promise<GateReviewOtpChallengeClaim> {
  if (!isUuid(reviewAccessId)) return { outcome: "unavailable" };
  return withOperationalTransaction(async (client) => {
    const assignment = await loadOtpAssignment(client, reviewAccessId, true);
    if (!assignment || !await otpAssignmentIsEligible(client, assignment)) {
      return { outcome: "unavailable" };
    }
    const challengeHistory = await client.query(
      `SELECT coalesce(max(sequence), 0)::integer AS maximum_sequence,
              max(requested_at) AS most_recent_requested_at,
              count(*) FILTER (
                WHERE requested_at > clock_timestamp() - interval '1 hour'
              )::integer AS recent_count
       FROM gate_review_otp_challenge
       WHERE review_cycle_id = $1 AND gate_approver_id = $2`,
      [assignment.review_cycle_id, assignment.gate_approver_id],
    );
    const history = challengeHistory.rows[0];
    const mostRecent = history?.most_recent_requested_at == null
      ? null
      : new Date(history.most_recent_requested_at);
    if (
      Number(history?.recent_count ?? 0) >= gateReviewOtpHourlyLimit
      || (mostRecent && Date.now() - mostRecent.getTime() < gateReviewOtpResendSeconds * 1000)
    ) {
      await insertPublicGateReviewAudit(client, assignment.project_id, {
        eventType: "gate_review.otp_rate_limited",
        resourceType: "gate_review_cycle",
        resourceId: assignment.review_cycle_id,
        metadata: { gateApproverId: assignment.gate_approver_id },
      });
      return { outcome: "rate_limited" };
    }

    const sequence = Number(history?.maximum_sequence ?? 0) + 1;
    const challengeId = randomUUID();
    const code = generateGateReviewOtp();
    const requestedAt = new Date();
    const expiresAt = new Date(
      requestedAt.getTime() + gateReviewOtpLifetimeMinutes * 60_000,
    );
    await client.query(
      `INSERT INTO gate_review_otp_challenge (
         id, review_cycle_id, gate_approver_id, sequence, code_digest,
         requested_at, expires_at, delivery_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'dispatching')`,
      [
        challengeId,
        assignment.review_cycle_id,
        assignment.gate_approver_id,
        sequence,
        digestGateReviewOtp(reviewAccessId, code),
        requestedAt.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    await insertPublicGateReviewAudit(client, assignment.project_id, {
      eventType: "gate_review.otp_requested",
      resourceType: "gate_review_otp_challenge",
      resourceId: challengeId,
      metadata: {
        reviewCycleId: assignment.review_cycle_id,
        gateApproverId: assignment.gate_approver_id,
      },
    });
    const project = assignment.project_snapshot as { projectNumber: string; name: string };
    const gate = assignment.gate_snapshot as { name: string };
    return {
      outcome: "created",
      challengeId,
      code,
      email: assignment.email,
      approverName: assignment.name,
      projectLabel: `${project.projectNumber} - ${project.name}`,
      gateName: gate.name,
    };
  });
}

export async function completeGateReviewOtpDelivery(
  challengeId: string,
  result: GateReviewInvitationAttemptResult,
) {
  return withOperationalTransaction(async (client) => {
    const challenge = await client.query(
      `SELECT challenge.review_cycle_id, challenge.gate_approver_id, gate.project_id
       FROM gate_review_otp_challenge AS challenge
       JOIN gate_review_cycle AS cycle ON cycle.id = challenge.review_cycle_id
       JOIN gate ON gate.id = cycle.gate_id
       WHERE challenge.id = $1 AND challenge.delivery_status = 'dispatching'
       FOR UPDATE OF challenge`,
      [challengeId],
    );
    if (challenge.rowCount !== 1) return false;
    const row = challenge.rows[0];
    const completedAt = new Date().toISOString();
    await client.query(
      `UPDATE gate_review_otp_challenge
       SET delivery_status = $2, delivery_completed_at = $3,
           provider_message_id = $4, error_code = $5, error_message = $6
       WHERE id = $1 AND delivery_status = 'dispatching'`,
      [
        challengeId,
        result.status,
        completedAt,
        result.status === "sent" ? result.providerMessageId : null,
        result.status === "sent" ? null : result.error.code,
        result.status === "sent" ? null : result.error.message,
      ],
    );
    await insertPublicGateReviewAudit(client, String(row.project_id), {
      eventType: result.status === "sent"
        ? "gate_review.otp_delivery_succeeded"
        : "gate_review.otp_delivery_failed",
      resourceType: "gate_review_otp_challenge",
      resourceId: challengeId,
      metadata: {
        reviewCycleId: String(row.review_cycle_id),
        gateApproverId: String(row.gate_approver_id),
        deliveryStatus: result.status,
      },
    });
    return true;
  });
}

export type GateReviewOtpVerificationResult =
  | { outcome: "verified"; sessionToken: string; expiresAt: string }
  | { outcome: "invalid_code" | "locked" | "unavailable" };

export async function verifyGateReviewOtp(
  reviewAccessId: string,
  code: string,
): Promise<GateReviewOtpVerificationResult> {
  if (!isUuid(reviewAccessId)) return { outcome: "invalid_code" };
  return withOperationalTransaction(async (client) => {
    const assignment = await loadOtpAssignment(client, reviewAccessId, true);
    if (!assignment || !await otpAssignmentIsEligible(client, assignment)) {
      return { outcome: "unavailable" };
    }
    const challengeResult = await client.query(
      `SELECT * FROM gate_review_otp_challenge
       WHERE review_cycle_id = $1 AND gate_approver_id = $2
         AND delivery_status = 'sent' AND consumed_at IS NULL
       ORDER BY requested_at DESC, sequence DESC
       LIMIT 1 FOR UPDATE`,
      [assignment.review_cycle_id, assignment.gate_approver_id],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
      return { outcome: "unavailable" };
    }
    if (challenge.locked_at != null || Number(challenge.failed_attempt_count) >= gateReviewOtpMaximumAttempts) {
      return { outcome: "locked" };
    }
    if (!/^\d{6}$/.test(code) || !verifyGateReviewOtpDigest(reviewAccessId, code, String(challenge.code_digest))) {
      const failedAttempts = Number(challenge.failed_attempt_count) + 1;
      const lockedAt = failedAttempts >= gateReviewOtpMaximumAttempts
        ? new Date().toISOString()
        : null;
      await client.query(
        `UPDATE gate_review_otp_challenge
         SET failed_attempt_count = $2, locked_at = $3
         WHERE id = $1`,
        [challenge.id, failedAttempts, lockedAt],
      );
      await insertPublicGateReviewAudit(client, assignment.project_id, {
        eventType: "gate_review.otp_verification_failed",
        resourceType: "gate_review_otp_challenge",
        resourceId: String(challenge.id),
        metadata: {
          reviewCycleId: assignment.review_cycle_id,
          gateApproverId: assignment.gate_approver_id,
          locked: lockedAt !== null,
        },
      });
      return { outcome: lockedAt ? "locked" : "invalid_code" };
    }

    const consumedAt = new Date();
    await client.query(
      "UPDATE gate_review_otp_challenge SET consumed_at = $2 WHERE id = $1",
      [challenge.id, consumedAt.toISOString()],
    );
    const sessionId = randomUUID();
    const sessionToken = generateGateReviewSessionToken();
    const expiresAt = new Date(
      consumedAt.getTime() + gateReviewSessionLifetimeMinutes * 60_000,
    );
    await client.query(
      `INSERT INTO gate_review_session (
         id, review_cycle_id, gate_approver_id, otp_challenge_id,
         token_hash, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        assignment.review_cycle_id,
        assignment.gate_approver_id,
        challenge.id,
        hashGateReviewSessionToken(sessionToken),
        consumedAt.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    await insertPublicGateReviewAudit(client, assignment.project_id, {
      eventType: "gate_review.otp_verification_succeeded",
      resourceType: "gate_review_session",
      resourceId: sessionId,
      metadata: {
        reviewCycleId: assignment.review_cycle_id,
        gateApproverId: assignment.gate_approver_id,
      },
    });
    return {
      outcome: "verified",
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function getOtpAssignedGateReview(
  reviewAccessId: string,
  sessionToken: string,
): Promise<(AssignedGateReview & { sessionId: string }) | null> {
  if (!isUuid(reviewAccessId) || !sessionToken) return null;
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT session.id, session.review_cycle_id, session.gate_approver_id,
              gate.project_id, gate.package_id, gate.id AS gate_id
       FROM gate_review_session AS session
       JOIN gate_review_cycle_approver AS approver
         ON approver.review_cycle_id = session.review_cycle_id
        AND approver.gate_approver_id = session.gate_approver_id
       JOIN gate_review_cycle AS cycle ON cycle.id = session.review_cycle_id
       JOIN gate ON gate.id = cycle.gate_id
       WHERE approver.review_access_id = $1
         AND session.token_hash = $2
         AND session.expires_at > clock_timestamp()`,
      [reviewAccessId, hashGateReviewSessionToken(sessionToken)],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    const projectId = String(row.project_id);
    const packageId = row.package_id == null ? null : String(row.package_id);
    const gateId = String(row.gate_id);
    const reviewCycleId = String(row.review_cycle_id);
    const gate = await loadGate(client, projectId, packageId, gateId);
    const reviewCycle = gate?.reviewCycles.find((cycle) => cycle.id === reviewCycleId);
    const assignedApprover = reviewCycle?.approvers.find(
      (approver) => approver.gateApproverId === String(row.gate_approver_id),
    );
    if (!reviewCycle || !assignedApprover) return null;
    return {
      projectId,
      packageId,
      gateId,
      reviewCycle,
      assignedApprover,
      sessionId: String(row.id),
    };
  });
}

async function loadOtpAssignment(
  client: PoolClient,
  reviewAccessId: string,
  lock: boolean,
): Promise<OtpAssignmentRow | null> {
  const result = await client.query<OtpAssignmentRow>(
    `SELECT approver.review_cycle_id, approver.gate_approver_id,
            approver.name, approver.email, approver.approval_level,
            approver.invitation_activated_at, cycle.status AS cycle_status,
            cycle.project_snapshot, cycle.gate_snapshot,
            gate.project_id, gate.package_id, gate.id AS gate_id
     FROM gate_review_cycle_approver AS approver
     JOIN gate_review_cycle AS cycle ON cycle.id = approver.review_cycle_id
     JOIN gate ON gate.id = cycle.gate_id
     WHERE approver.review_access_id = $1
       AND approver.authentication_method = 'email_otp'
     ${lock ? "FOR UPDATE OF approver, cycle" : ""}`,
    [reviewAccessId],
  );
  return result.rows[0] ?? null;
}

async function otpAssignmentIsEligible(client: PoolClient, assignment: OtpAssignmentRow) {
  if (
    assignment.cycle_status !== "awaiting_approval"
    || assignment.invitation_activated_at == null
  ) return false;
  const result = await client.query(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM gate_review_cycle_approver AS earlier
       WHERE earlier.review_cycle_id = $1
         AND earlier.approval_level < $3
         AND NOT EXISTS (
           SELECT 1 FROM gate_review_response AS response
           WHERE response.review_cycle_id = earlier.review_cycle_id
             AND response.gate_approver_id = earlier.gate_approver_id
         )
     ) AS eligible,
     NOT EXISTS (
       SELECT 1 FROM gate_review_response AS response
       WHERE response.review_cycle_id = $1
         AND response.gate_approver_id = $2
     ) AS unanswered`,
    [assignment.review_cycle_id, assignment.gate_approver_id, assignment.approval_level],
  );
  return result.rows[0]?.eligible === true && result.rows[0]?.unanswered === true;
}

async function insertPublicGateReviewAudit(
  client: PoolClient,
  projectId: string,
  event: {
    eventType: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO audit_event (
       request_id, project_id, event_type, resource_type, resource_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      randomUUID(),
      projectId,
      event.eventType,
      event.resourceType,
      event.resourceId,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type ActiveGateReviewIdentityLinkCandidate = VerifiedApproverUser & {
  gateApproverId: string;
};

export async function getActiveGateReviewIdentityLinkCandidates(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  reviewCycleId: string;
}): Promise<ActiveGateReviewIdentityLinkCandidate[]> {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT snapshot.gate_approver_id, app_user.id, app_user.display_name,
              app_user.email, app_user.access_class,
              organization.name AS organization_name
       FROM gate_review_cycle_approver AS snapshot
       JOIN gate_review_cycle AS cycle ON cycle.id = snapshot.review_cycle_id
       JOIN gate ON gate.id = cycle.gate_id
       JOIN user_identity
         ON user_identity.provider = 'microsoft'
        AND user_identity.provider_tenant_id = snapshot.expected_provider_tenant_id
        AND user_identity.provider_object_id = snapshot.expected_provider_object_id
       JOIN app_user
         ON app_user.id = user_identity.user_id
        AND app_user.status = 'active'
       LEFT JOIN organization ON organization.id = app_user.organization_id
       WHERE snapshot.review_cycle_id = $1
         AND snapshot.assigned_user_id IS NULL
         AND cycle.status = 'awaiting_approval'
         AND gate.id = $2
         AND gate.project_id = $3
         AND gate.package_id IS NOT DISTINCT FROM $4::text
         AND NOT EXISTS (
           SELECT 1 FROM gate_review_response
           WHERE gate_review_response.review_cycle_id = snapshot.review_cycle_id
             AND gate_review_response.gate_approver_id = snapshot.gate_approver_id
         )
       ORDER BY snapshot.sequence, snapshot.gate_approver_id`,
      [input.reviewCycleId, input.gateId, input.projectId, input.packageId],
    );
    return result.rows.map((row) => ({
      gateApproverId: String(row.gate_approver_id),
      id: String(row.id),
      displayName: String(row.display_name),
      email: String(row.email),
      organizationName: row.organization_name == null ? null : String(row.organization_name),
      accessClass: String(row.access_class) as VerifiedApproverUser["accessClass"],
    }));
  });
}

export async function linkActiveGateReviewApproverUser(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  reviewCycleId: string;
  gateApproverId: string;
  userId: string;
}) {
  return withOperationalTransaction(async (client) => {
    const gate = await lockScopeGate(
      client,
      { projectId: input.projectId, packageId: input.packageId },
      input.gateId,
    );
    if (!gate) return false;
    const cycle = await client.query(
      `SELECT id FROM gate_review_cycle
       WHERE id = $1 AND gate_id = $2 AND status = 'awaiting_approval'
       FOR UPDATE`,
      [input.reviewCycleId, input.gateId],
    );
    if (cycle.rowCount === 0) return false;
    const snapshot = await client.query<{
      assigned_user_id: string | null;
      expected_provider_tenant_id: string | null;
      expected_provider_object_id: string | null;
    }>(
      `SELECT assigned_user_id, expected_provider_tenant_id,
              expected_provider_object_id
       FROM gate_review_cycle_approver
       WHERE review_cycle_id = $1 AND gate_approver_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM gate_review_response
           WHERE gate_review_response.review_cycle_id = $1
             AND gate_review_response.gate_approver_id = $2
         )
       FOR UPDATE`,
      [input.reviewCycleId, input.gateApproverId],
    );
    if (snapshot.rowCount === 0) return false;
    const assignedUserId = snapshot.rows[0].assigned_user_id;
    if (assignedUserId != null) return String(assignedUserId) === input.userId;
    const expectedTenantId = snapshot.rows[0].expected_provider_tenant_id;
    const expectedObjectId = snapshot.rows[0].expected_provider_object_id;
    if (!expectedTenantId || !expectedObjectId) return false;
    const user = await client.query(
      `SELECT app_user.id FROM app_user
       JOIN user_identity ON user_identity.user_id = app_user.id
       WHERE app_user.id = $1
         AND app_user.status = 'active'
         AND user_identity.provider = 'microsoft'
         AND user_identity.provider_tenant_id = $2
         AND user_identity.provider_object_id = $3`,
      [input.userId, expectedTenantId, expectedObjectId],
    );
    if (user.rowCount !== 1) return false;
    const updated = await client.query(
      `UPDATE gate_review_cycle_approver SET assigned_user_id = $3
       WHERE review_cycle_id = $1 AND gate_approver_id = $2
         AND assigned_user_id IS NULL`,
      [input.reviewCycleId, input.gateApproverId, input.userId],
    );
    return updated.rowCount === 1;
  });
}

type AuthorizedGateReviewResponseInput = {
  projectId: string;
  packageId: string | null;
  gateId: string;
  reviewCycleId: string;
  outcome: GateReviewResponseInput["outcome"];
  comment: string;
} & (
  | {
      authenticationMethod?: "microsoft_entra";
      actorUserId: string;
      actorProviderTenantId: string;
      actorProviderObjectId: string;
    }
  | {
      authenticationMethod: "email_otp";
      gateApproverId: string;
      reviewSessionId: string;
    }
);

export async function internalRecordIdentityBoundGateReviewResponse(
  input: AuthorizedGateReviewResponseInput,
): Promise<GateReviewResponseResult<Project | ProjectPackage> | null> {
  return withOperationalTransaction(async (client) => {
    const scope = { projectId: input.projectId, packageId: input.packageId };
    const gate = await lockScopeGate(client, scope, input.gateId);
    if (!gate) return null;
    const project = await loadProject(client, input.projectId);
    const entity = input.packageId
      ? await loadPackage(client, input.projectId, input.packageId)
      : project;
    if (!project || !entity) return null;
    const currentStage = input.packageId
      ? (entity as ProjectPackage).currentStage
      : (entity as Project).currentStage;
    if (gate.stageId !== currentStage) return { outcome: "not_current" };
    const cycleLock = await client.query(
      `SELECT id FROM gate_review_cycle
       WHERE id = $1 AND gate_id = $2 FOR UPDATE`,
      [input.reviewCycleId, input.gateId],
    );
    if (cycleLock.rowCount === 0) return { outcome: "review_cycle_mismatch" };
    const currentGate = await loadGate(
      client,
      input.projectId,
      input.packageId,
      input.gateId,
    );
    const cycle = currentGate?.reviewCycles.find(
      (candidate) => candidate.id === input.reviewCycleId,
    );
    if (!currentGate || !cycle) return { outcome: "review_cycle_mismatch" };
    const approvalState = getGateReviewApprovalState(cycle);
    let assignedApprovers: typeof cycle.approvers;
    let actor: GateReviewActorSnapshot;
    let responderUserId: string | null;
    let responderProviderTenantId: string | null;
    let responderProviderObjectId: string | null;
    let reviewSessionId: string | null;
    if (input.authenticationMethod === "email_otp") {
      const session = await client.query(
        `SELECT 1
         FROM gate_review_session AS session
         JOIN gate_review_cycle_approver AS approver
           ON approver.review_cycle_id = session.review_cycle_id
          AND approver.gate_approver_id = session.gate_approver_id
         WHERE session.id = $1
           AND session.review_cycle_id = $2
           AND session.gate_approver_id = $3
           AND session.expires_at > clock_timestamp()
           AND approver.authentication_method = 'email_otp'
         FOR UPDATE OF session, approver`,
        [input.reviewSessionId, input.reviewCycleId, input.gateApproverId],
      );
      if (session.rowCount !== 1) return { outcome: "approver_not_found" };
      assignedApprovers = cycle.approvers.filter(
        (approver) => approver.gateApproverId === input.gateApproverId,
      );
      const assigned = assignedApprovers[0];
      actor = {
        userId: null,
        displayName: assigned?.name ?? "Gate Approver",
        email: assigned?.email ?? null,
        authenticationMethod: "email_otp",
        reviewSessionId: input.reviewSessionId,
      };
      responderUserId = null;
      responderProviderTenantId = null;
      responderProviderObjectId = null;
      reviewSessionId = input.reviewSessionId;
    } else {
      const assignments = await client.query(
        `SELECT gate_approver_id FROM gate_review_cycle_approver
         WHERE review_cycle_id = $1 AND assigned_user_id = $2
           AND expected_provider_tenant_id = $3
           AND expected_provider_object_id = $4
         ORDER BY sequence, gate_approver_id FOR UPDATE`,
        [
          input.reviewCycleId,
          input.actorUserId,
          input.actorProviderTenantId,
          input.actorProviderObjectId,
        ],
      );
      assignedApprovers = assignments.rows.flatMap((row) => {
        const id = String(row.gate_approver_id);
        const approver = cycle.approvers.find(
          (candidate) => candidate.gateApproverId === id,
        );
        return approver ? [approver] : [];
      });
      const actorResult = await client.query(
        `SELECT app_user.id, app_user.display_name, app_user.email
         FROM app_user
         JOIN user_identity ON user_identity.user_id = app_user.id
         WHERE app_user.id = $1 AND app_user.status = 'active'
           AND user_identity.provider = 'microsoft'
           AND user_identity.provider_tenant_id = $2
           AND user_identity.provider_object_id = $3`,
        [
          input.actorUserId,
          input.actorProviderTenantId,
          input.actorProviderObjectId,
        ],
      );
      if (actorResult.rowCount === 0) return { outcome: "approver_not_found" };
      actor = {
        userId: input.actorUserId,
        displayName: String(actorResult.rows[0].display_name),
        email: String(actorResult.rows[0].email),
        providerTenantId: input.actorProviderTenantId,
        providerObjectId: input.actorProviderObjectId,
        authenticationMethod: "microsoft_entra",
      };
      responderUserId = input.actorUserId;
      responderProviderTenantId = input.actorProviderTenantId;
      responderProviderObjectId = input.actorProviderObjectId;
      reviewSessionId = null;
    }
    if (assignedApprovers.length === 0) return { outcome: "approver_not_found" };
    const eligibleAssignedApprover = assignedApprovers.find((approver) =>
        approvalState.eligibleApprovers.some(
          (candidate) => candidate.gateApproverId === approver.gateApproverId,
        ),
    );
    if (!eligibleAssignedApprover) {
      return assignedApprovers.some((approver) => approver.response)
        ? { outcome: "already_responded" }
        : { outcome: "not_eligible" };
    }
    const gateApproverId = eligibleAssignedApprover.gateApproverId;
    const now = new Date().toISOString();
    const transition = recordGateReviewResponse(
      currentGate,
      {
        reviewCycleId: input.reviewCycleId,
        gateApproverId,
        outcome: input.outcome,
        comment: input.comment,
      },
      now,
    );
    if (transition.outcome !== "recorded") return transition;
    const respondingApprover = transition.reviewCycle.approvers.find(
      (candidate) => candidate.gateApproverId === gateApproverId,
    );
    if (!respondingApprover?.response) throw new Error("The Gate response was not recorded.");
    respondingApprover.response.respondedBy = actor;

    if (transition.completion === "approved_with_actions") {
      const protection = await protectGateActions(
        client,
        input.projectId,
        input.gateId,
        transition.acceptedActionIds,
        input.reviewCycleId,
      );
      if (protection.outcome !== "protected") return protection;
    }
    await client.query(
       `INSERT INTO gate_review_response (
          review_cycle_id, gate_approver_id, outcome, responded_at,
          responded_by, responded_by_user_id, comment,
          responder_provider_tenant_id, responder_provider_object_id,
          authentication_method, review_session_id
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
      [
        input.reviewCycleId,
        gateApproverId,
        input.outcome,
        now,
        JSON.stringify(actor),
        responderUserId,
        respondingApprover.response.comment,
        responderProviderTenantId,
        responderProviderObjectId,
        input.authenticationMethod === "email_otp" ? "email_otp" : null,
        reviewSessionId,
      ],
    );
    await client.query(
      `UPDATE gate_review_cycle SET status = $2, decision = $3,
         decision_comments = $4, completed_at = $5
       WHERE id = $1`,
      [
        input.reviewCycleId,
        transition.reviewCycle.status,
        transition.reviewCycle.decision,
        transition.reviewCycle.decisionComments,
        transition.reviewCycle.completedAt,
      ],
    );
    for (const approverId of transition.activatedApproverIds) {
      await client.query(
        `UPDATE gate_review_cycle_approver SET invitation_activated_at = $3
         WHERE review_cycle_id = $1 AND gate_approver_id = $2
           AND invitation_activated_at IS NULL`,
        [input.reviewCycleId, approverId, now],
      );
    }
    await client.query("UPDATE gate SET status = $2 WHERE id = $1", [
      input.gateId,
      currentGate.status,
    ]);
    if (transition.completion === "approved_with_actions") {
      await reconcileGateFollowUpStatus(
        client,
        input.projectId,
        input.gateId,
        transition.acceptedActionIds[0],
        {
          userId: actor.userId,
          displayName: actor.displayName,
          providerTenantId: actor.providerTenantId,
          providerObjectId: actor.providerObjectId,
          accessClass: actor.authenticationMethod === "email_otp"
            ? "external_reviewer"
            : null,
          authenticationMethod: actor.authenticationMethod ?? null,
        },
      );
    }
    if (
      transition.completion === "approved" ||
      transition.completion === "approved_with_actions"
    ) {
      if (input.packageId) {
        const next = lifecycleNext(packageStageOrder, (entity as ProjectPackage).currentStage);
        if (next) {
          await client.query(
            `UPDATE project_package SET current_stage = $3
             WHERE project_id = $1 AND id = $2`,
            [input.projectId, input.packageId, next],
          );
        }
      } else {
        const projectEntity = entity as Project;
        const next = lifecycleNext(
          projectLifecycle(projectEntity.validationRequired),
          projectEntity.currentStage,
        );
        if (next) {
          await client.query(
            "UPDATE project SET current_stage = $2 WHERE id = $1",
            [input.projectId, next],
          );
        }
      }
    }
    await touchScope(client, scope, now);
    const updatedEntity = input.packageId
      ? await loadPackage(client, input.projectId, input.packageId)
      : await loadProject(client, input.projectId);
    const updatedGate = await loadGate(
      client,
      input.projectId,
      input.packageId,
      input.gateId,
    );
    const updatedCycle = updatedGate?.reviewCycles.find(
      (candidate) => candidate.id === input.reviewCycleId,
    );
    if (!updatedEntity || !updatedCycle) {
      throw new Error("The completed Gate response could not be loaded.");
    }
    return {
      outcome: "recorded",
      entity: updatedEntity,
      reviewCycle: updatedCycle,
      completion: transition.completion,
      activatedApproverIds: transition.activatedApproverIds,
    };
  });
}

export type AssignedGateReview = {
  projectId: string;
  packageId: string | null;
  gateId: string;
  reviewCycle: Gate["reviewCycles"][number];
  assignedApprover: Gate["reviewCycles"][number]["approvers"][number];
};

export async function getAssignedGateReview(
  reviewCycleId: string,
  actor: CurrentUser,
): Promise<AssignedGateReview | null> {
  return withOperationalTransaction(async (client) => {
    const assignment = await client.query(
      `SELECT gate.project_id, gate.package_id, cycle.gate_id, cycle.status,
              approver.gate_approver_id, approver.assigned_user_id
       FROM gate_review_cycle_approver AS approver
       JOIN gate_review_cycle AS cycle ON cycle.id = approver.review_cycle_id
       JOIN gate ON gate.id = cycle.gate_id
        WHERE approver.review_cycle_id = $1
          AND approver.assigned_user_id = $4
          AND approver.expected_provider_tenant_id = $2
          AND approver.expected_provider_object_id = $3
        FOR UPDATE OF approver`,
      [reviewCycleId, actor.providerTenantId, actor.providerObjectId, actor.id],
    );
    if (assignment.rowCount !== 1) return null;
    const row = assignment.rows[0];

    const projectId = String(row.project_id);
    const packageId = row.package_id == null ? null : String(row.package_id);
    const gateId = String(row.gate_id);
    const gate = await loadGate(client, projectId, packageId, gateId);
    const reviewCycle = gate?.reviewCycles.find((cycle) => cycle.id === reviewCycleId);
    const assignedApprover = reviewCycle?.approvers.find(
      (approver) => approver.gateApproverId === String(row.gate_approver_id),
    );
    if (!reviewCycle || !assignedApprover) return null;
    return { projectId, packageId, gateId, reviewCycle, assignedApprover };
  });
}

export async function recordAssignedGateReviewResponse(input: {
  reviewCycleId: string;
  actor: CurrentUser;
  outcome: GateReviewResponseInput["outcome"];
  comment: string;
}) {
  return withOperationalTransaction(async (client) => {
    const assigned = await getAssignedGateReview(input.reviewCycleId, input.actor);
    if (!assigned) return null;
    const result = await internalRecordIdentityBoundGateReviewResponse({
      projectId: assigned.projectId,
      packageId: assigned.packageId,
      gateId: assigned.gateId,
      reviewCycleId: input.reviewCycleId,
      actorUserId: input.actor.id,
      actorProviderTenantId: input.actor.providerTenantId,
      actorProviderObjectId: input.actor.providerObjectId,
      outcome: input.outcome,
      comment: input.comment,
    });
    if (result?.outcome === "recorded") {
      await insertAuditEvent(client, input.actor, assigned.projectId, {
        eventType: "gate_review.responded",
        resourceType: "gate_review_cycle",
        resourceId: input.reviewCycleId,
        changeSummary: { outcome: input.outcome },
        metadata: {
          gateId: assigned.gateId,
          packageId: assigned.packageId,
          gateApproverId: assigned.assignedApprover.gateApproverId,
        },
      });
    }
    return result == null ? null : { ...result, assigned };
  });
}

export async function recordOtpGateReviewResponse(input: {
  reviewAccessId: string;
  sessionToken: string;
  outcome: GateReviewResponseInput["outcome"];
  comment: string;
}) {
  return withOperationalTransaction(async (client) => {
    const assigned = await getOtpAssignedGateReview(
      input.reviewAccessId,
      input.sessionToken,
    );
    if (!assigned) return null;
    const result = await internalRecordIdentityBoundGateReviewResponse({
      projectId: assigned.projectId,
      packageId: assigned.packageId,
      gateId: assigned.gateId,
      reviewCycleId: assigned.reviewCycle.id,
      gateApproverId: assigned.assignedApprover.gateApproverId,
      reviewSessionId: assigned.sessionId,
      authenticationMethod: "email_otp",
      outcome: input.outcome,
      comment: input.comment,
    });
    if (result?.outcome === "recorded") {
      await insertPublicGateReviewAudit(client, assigned.projectId, {
        eventType: "gate_review.responded",
        resourceType: "gate_review_cycle",
        resourceId: assigned.reviewCycle.id,
        metadata: {
          gateId: assigned.gateId,
          packageId: assigned.packageId,
          gateApproverId: assigned.assignedApprover.gateApproverId,
          authenticationMethod: "email_otp",
          reviewSessionId: assigned.sessionId,
          outcome: input.outcome,
        },
      });
    }
    return result == null ? null : { ...result, assigned };
  });
}

export async function deletePackage(projectId: string, packageId: string) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return false;
    const packageLock = await client.query(
      `SELECT id FROM project_package
       WHERE project_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE`,
      [projectId, packageId],
    );
    if (packageLock.rowCount === 0) return false;
    const history = await client.query(
      `SELECT 1 FROM gate_review_cycle AS cycle
       JOIN gate ON gate.id = cycle.gate_id
       WHERE gate.project_id = $1 AND gate.package_id = $2 LIMIT 1`,
      [projectId, packageId],
    );
    if (history.rowCount && history.rowCount > 0) {
      const now = new Date().toISOString();
      await client.query(
        `UPDATE project_package SET archived_at = $3, updated_at = $3
         WHERE project_id = $1 AND id = $2`,
        [projectId, packageId, now],
      );
      return true;
    }
    const references = await getReferenceHistory(
      client,
      projectId,
      packageId,
      "package",
    );
    if (references.hasReferences) return false;
    await client.query("SAVEPOINT package_deletion");
    try {
      const deleted = await client.query(
        "DELETE FROM project_package WHERE project_id = $1 AND id = $2",
        [projectId, packageId],
      );
      return deleted.rowCount === 1;
    } catch (error) {
      if (databaseErrorCode(error) === "23503") {
        await client.query("ROLLBACK TO SAVEPOINT package_deletion");
        return false;
      }
      throw error;
    }
  });
}

export async function deletePackagesForProject(projectId: string) {
  const packages = await withOperationalClient((client) =>
    loadPackages(client, projectId, true),
  );
  for (const projectPackage of packages) {
    await deletePackage(projectId, projectPackage.id);
  }
}

export async function deleteProject(projectId: string) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return false;
    await client.query(
      `SELECT id FROM project_package
       WHERE project_id = $1 ORDER BY id FOR UPDATE`,
      [projectId],
    );
    const history = await client.query(
      `SELECT 1
       WHERE EXISTS (
         SELECT 1 FROM gate_review_cycle AS cycle
         JOIN gate ON gate.id = cycle.gate_id
         WHERE gate.project_id = $1
       ) OR EXISTS (
         SELECT 1 FROM project_action WHERE project_id = $1
       )`,
      [projectId],
    );
    if (history.rowCount && history.rowCount > 0) {
      const now = new Date().toISOString();
      await client.query(
        "UPDATE project SET archived_at = $2, updated_at = $2 WHERE id = $1",
        [projectId, now],
      );
      await client.query(
        `UPDATE project_package SET archived_at = coalesce(archived_at, $2),
           updated_at = $2 WHERE project_id = $1`,
        [projectId, now],
      );
      return true;
    }
    await client.query("SAVEPOINT project_deletion");
    try {
      const deleted = await client.query("DELETE FROM project WHERE id = $1", [projectId]);
      return deleted.rowCount === 1;
    } catch (error) {
      if (databaseErrorCode(error) === "23503") {
        await client.query("ROLLBACK TO SAVEPOINT project_deletion");
        return false;
      }
      throw error;
    }
  });
}

function mapMembership(row: Record<string, unknown>): ProjectMembership {
  return {
    projectId: String(row.project_id),
    userId: String(row.user_id),
    role: String(row.role) as ProjectMembershipRole,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function getProjectMemberships(
  projectId: string,
  includeArchivedProject = false,
) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT membership.* FROM project_membership AS membership
       JOIN project ON project.id = membership.project_id
       WHERE membership.project_id = $1
         AND ($2::boolean OR project.archived_at IS NULL)
       ORDER BY membership.created_at, membership.user_id`,
      [projectId, includeArchivedProject],
    );
    return result.rows.map(mapMembership);
  });
}

export async function getProjectMembershipDetails(projectId: string) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT membership.*, app_user.display_name, app_user.email,
              app_user.status, app_user.access_class
       FROM project_membership AS membership
       JOIN project ON project.id = membership.project_id
       JOIN app_user ON app_user.id = membership.user_id
       WHERE membership.project_id = $1
         AND project.archived_at IS NULL
       ORDER BY CASE membership.role
         WHEN 'owner' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
         app_user.display_name, membership.user_id`,
      [projectId],
    );
    return result.rows.map((row): ProjectMembershipDetail => ({
      ...mapMembership(row),
      displayName: String(row.display_name),
      email: String(row.email),
      status: String(row.status),
      accessClass: String(row.access_class),
    }));
  });
}

export async function getAssignableProjectUsers(projectId: string) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT app_user.id, app_user.display_name, app_user.email
       FROM app_user
       WHERE app_user.status = 'active'
         AND app_user.access_class = 'internal'
         AND NOT EXISTS (
           SELECT 1 FROM project_membership
           WHERE project_membership.project_id = $1
             AND project_membership.user_id = app_user.id
         )
       ORDER BY app_user.display_name, app_user.id`,
      [projectId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      email: String(row.email),
    }));
  });
}

export async function getProjectAuditEvents(projectId: string, limit = 100) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT audit_event.*, app_user.display_name AS actor_display_name
       FROM audit_event
       LEFT JOIN app_user ON app_user.id = audit_event.actor_user_id
       WHERE audit_event.project_id = $1
       ORDER BY audit_event.occurred_at DESC, audit_event.id DESC
       LIMIT $2`,
      [projectId, limit],
    );
    return result.rows.map((row): AuditEvent => ({
      id: String(row.id),
      occurredAt: timestamp(row.occurred_at),
      actorUserId: row.actor_user_id == null ? null : String(row.actor_user_id),
      actorDisplayName: row.actor_display_name == null
        ? null
        : String(row.actor_display_name),
      eventType: String(row.event_type),
      resourceType: String(row.resource_type),
      resourceId: String(row.resource_id),
      changeSummary: row.change_summary as Record<string, unknown>,
      metadata: row.metadata as Record<string, unknown>,
    }));
  });
}

export async function getUserProjectMemberships(
  userId: string,
  includeArchivedProjects = false,
) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT membership.* FROM project_membership AS membership
       JOIN project ON project.id = membership.project_id
       WHERE membership.user_id = $1
         AND ($2::boolean OR project.archived_at IS NULL)
       ORDER BY membership.created_at, membership.project_id`,
      [userId, includeArchivedProjects],
    );
    return result.rows.map(mapMembership);
  });
}

export async function getProjectMembership(projectId: string, userId: string) {
  return withOperationalClient(async (client) => {
    const result = await client.query(
      `SELECT membership.* FROM project_membership AS membership
       JOIN project ON project.id = membership.project_id
       WHERE membership.project_id = $1 AND membership.user_id = $2
         AND project.archived_at IS NULL`,
      [projectId, userId],
    );
    return result.rows[0] ? mapMembership(result.rows[0]) : null;
  });
}

export async function upsertProjectMembership(
  projectId: string,
  userId: string,
  role: ProjectMembershipRole,
) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return null;
    const user = await client.query(
      `SELECT id FROM app_user
       WHERE id = $1 AND status = 'active' AND access_class = 'internal'`,
      [userId],
    );
    if (user.rowCount === 0) return null;
    const result = await client.query(
      `INSERT INTO project_membership (
         project_id, user_id, role, created_at, updated_at
       ) VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (project_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, updated_at = now()
       RETURNING *`,
      [projectId, userId, role],
    );
    return mapMembership(result.rows[0]);
  });
}

export async function deleteProjectMembership(projectId: string, userId: string) {
  return withOperationalTransaction(async (client) => {
    const project = await client.query(
      "SELECT id FROM project WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [projectId],
    );
    if (project.rowCount === 0) return false;
    const deleted = await client.query(
      "DELETE FROM project_membership WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    return deleted.rowCount === 1;
  });
}
