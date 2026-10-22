import "server-only";

import type { PoolClient } from "pg";
import type { Deliverable } from "../deliverables";
import type {
  Gate,
  GateReviewActorSnapshot,
  GateReviewApproverResponse,
  GateReviewCycle,
  GateReviewFrozenEvidence,
  GateReviewGateSnapshot,
  GateReviewInvitationAttemptStatus,
  GateReviewPackageSnapshot,
  GateReviewProjectSnapshot,
} from "../gates";
import type { ProjectPackage } from "../packages";
import type {
  GateDecisionReference,
  ProjectAction,
  ProjectActionChange,
  ProjectActionUpdate,
} from "../project-actions";
import type { GovernanceTier, Project } from "../projects";

type Row = Record<string, unknown>;

function rows(result: { rows: unknown[] }) {
  return result.rows as Row[];
}

function text(value: unknown) {
  return String(value);
}

function nullableText(value: unknown) {
  return value == null ? null : String(value);
}

function integer(value: unknown) {
  return Number(value);
}

function timestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableTimestamp(value: unknown) {
  return value == null ? null : timestamp(value);
}

function date(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function nullableDate(value: unknown) {
  return value == null ? null : date(value);
}

function json<T>(value: unknown): T {
  return value as T;
}

export async function loadProjects(
  client: PoolClient,
  includeArchived = false,
): Promise<Project[]> {
  const result = await client.query(
    `SELECT project.*,
            project.planned_start_date::text AS planned_start_date,
            project.planned_completion_date::text AS planned_completion_date
     FROM project
     WHERE ($1::boolean OR archived_at IS NULL)
     ORDER BY updated_at DESC, id`,
    [includeArchived],
  );

  const projects: Project[] = [];
  for (const row of rows(result)) {
    projects.push(await mapProject(client, row));
  }
  return projects;
}

export async function loadProject(
  client: PoolClient,
  projectId: string,
  includeArchived = false,
): Promise<Project | null> {
  const result = await client.query(
    `SELECT project.*,
            project.planned_start_date::text AS planned_start_date,
            project.planned_completion_date::text AS planned_completion_date
     FROM project
     WHERE id = $1 AND ($2::boolean OR archived_at IS NULL)`,
    [projectId, includeArchived],
  );
  const row = rows(result)[0];
  return row ? mapProject(client, row) : null;
}

async function mapProject(client: PoolClient, row: Row): Promise<Project> {
  const projectId = text(row.id);
  const tierResult = await client.query(
    `SELECT * FROM governance_tier
     WHERE project_id = $1
     ORDER BY sequence, id`,
    [projectId],
  );
  const gates = await loadGates(client, projectId, null);
  const governanceTiers: GovernanceTier[] = rows(tierResult).map((tier) => ({
    id: text(tier.id),
    sequence: integer(tier.sequence),
    name: text(tier.name),
    description: text(tier.description),
  }));

  return {
    id: projectId,
    projectNumber: text(row.project_number),
    name: text(row.name),
    description: text(row.description),
    projectManager: text(row.project_manager),
    customer: text(row.customer),
    reportsTo: text(row.reports_to),
    siteLocation: text(row.site_location),
    plannedStartDate: date(row.planned_start_date),
    plannedCompletionDate: date(row.planned_completion_date),
    validationRequired: Boolean(row.validation_required),
    currentStage: text(row.current_stage) as Project["currentStage"],
    governanceTiers,
    gates: gates as Project["gates"],
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function loadPackages(
  client: PoolClient,
  projectId: string,
  includeArchived = false,
): Promise<ProjectPackage[]> {
  const result = await client.query(
    `SELECT package.*,
            package.target_delivery_date::text AS target_delivery_date
     FROM project_package AS package
     JOIN project ON project.id = package.project_id
     WHERE package.project_id = $1
       AND ($2::boolean OR (package.archived_at IS NULL AND project.archived_at IS NULL))
     ORDER BY package.package_code, package.id`,
    [projectId, includeArchived],
  );
  const packages: ProjectPackage[] = [];
  for (const row of rows(result)) {
    packages.push(await mapPackage(client, row));
  }
  return packages;
}

export async function loadPackage(
  client: PoolClient,
  projectId: string,
  packageId: string,
  includeArchived = false,
): Promise<ProjectPackage | null> {
  const result = await client.query(
    `SELECT package.*,
            package.target_delivery_date::text AS target_delivery_date
     FROM project_package AS package
     JOIN project ON project.id = package.project_id
     WHERE package.project_id = $1 AND package.id = $2
       AND ($3::boolean OR (package.archived_at IS NULL AND project.archived_at IS NULL))`,
    [projectId, packageId, includeArchived],
  );
  const row = rows(result)[0];
  return row ? mapPackage(client, row) : null;
}

async function mapPackage(client: PoolClient, row: Row): Promise<ProjectPackage> {
  const projectId = text(row.project_id);
  const packageId = text(row.id);
  return {
    id: packageId,
    projectId,
    packageCode: text(row.package_code),
    packageName: text(row.package_name),
    description: text(row.description),
    packageOwner: text(row.package_owner),
    executionModel: nullableText(row.execution_model) as ProjectPackage["executionModel"],
    currentStage: text(row.current_stage) as ProjectPackage["currentStage"],
    gates: await loadGates(client, projectId, packageId) as ProjectPackage["gates"],
    status: text(row.status) as ProjectPackage["status"],
    targetDeliveryDate: date(row.target_delivery_date),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function loadGate(
  client: PoolClient,
  projectId: string,
  packageId: string | null,
  gateId: string,
): Promise<Gate | null> {
  const gates = await loadGates(client, projectId, packageId, gateId);
  return gates[0] ?? null;
}

async function loadGates(
  client: PoolClient,
  projectId: string,
  packageId: string | null,
  gateId?: string,
): Promise<Gate[]> {
  const gateResult = await client.query(
    `SELECT * FROM gate
     WHERE project_id = $1
       AND package_id IS NOT DISTINCT FROM $2::text
       AND ($3::text IS NULL OR id = $3)
     ORDER BY sequence, id`,
    [projectId, packageId, gateId ?? null],
  );
  const gateRows = rows(gateResult);
  const gateIds = gateRows.map((row) => text(row.id));
  if (gateIds.length === 0) return [];

  const criterionResult = await client.query(
    `SELECT * FROM gate_criterion
     WHERE gate_id = ANY($1::text[])
     ORDER BY gate_id, sequence, id`,
    [gateIds],
  );
  const approverResult = await client.query(
    `SELECT * FROM gate_approver
     WHERE gate_id = ANY($1::text[])
     ORDER BY gate_id, sequence, id`,
    [gateIds],
  );
  const cycleResult = await client.query(
    `SELECT * FROM gate_review_cycle
     WHERE gate_id = ANY($1::text[])
     ORDER BY gate_id, cycle_number, id`,
    [gateIds],
  );
  const cycleRows = rows(cycleResult);
  const cycleIds = cycleRows.map((row) => text(row.id));
  const snapshotResult = cycleIds.length > 0
    ? await client.query(
        `SELECT * FROM gate_review_cycle_approver
         WHERE review_cycle_id = ANY($1::text[])
         ORDER BY review_cycle_id, sequence, gate_approver_id`,
        [cycleIds],
      )
    : { rows: [] };
  const responseResult = cycleIds.length > 0
    ? await client.query(
        `SELECT * FROM gate_review_response
         WHERE review_cycle_id = ANY($1::text[])
         ORDER BY review_cycle_id, gate_approver_id`,
        [cycleIds],
      )
    : { rows: [] };
  const attemptResult = cycleIds.length > 0
    ? await client.query(
        `SELECT * FROM gate_review_invitation_attempt
         WHERE review_cycle_id = ANY($1::text[])
         ORDER BY review_cycle_id, gate_approver_id, sequence, id`,
        [cycleIds],
      )
    : { rows: [] };
  const reworkResult = cycleIds.length > 0
    ? await client.query(
        `SELECT * FROM gate_review_rework_action
         WHERE review_cycle_id = ANY($1::text[])
         ORDER BY review_cycle_id, sequence, action_id`,
        [cycleIds],
      )
    : { rows: [] };

  const criteria = rows(criterionResult);
  const approvers = rows(approverResult);
  const snapshots = rows(snapshotResult);
  const responses = rows(responseResult);
  const attempts = rows(attemptResult);
  const reworkActions = rows(reworkResult);

  return gateRows.map((gateRow) => {
    const id = text(gateRow.id);
    return {
      id,
      templateVersion: integer(gateRow.template_version),
      name: text(gateRow.name),
      stageId: text(gateRow.stage_id),
      status: text(gateRow.status) as Gate["status"],
      approvers: approvers
        .filter((row) => row.gate_id === id)
        .map((row) => ({
          id: text(row.id),
          name: text(row.name),
          email: text(row.email),
          roleFunction: text(row.role_function),
          approvalRole: text(row.approval_role),
          approvalLevel: integer(row.approval_level),
        })),
      reviewCycles: cycleRows
        .filter((row) => row.gate_id === id)
        .map((row) => mapReviewCycle(row, snapshots, responses, attempts, reworkActions)),
      criteria: criteria
        .filter((row) => row.gate_id === id)
        .map((row) => ({
          id: text(row.id),
          templateId: nullableText(row.template_id),
          description: text(row.description),
          status: text(row.status) as Gate["criteria"][number]["status"],
        })),
    };
  });
}

function mapReviewCycle(
  row: Row,
  allSnapshots: Row[],
  allResponses: Row[],
  allAttempts: Row[],
  allReworkActions: Row[],
): GateReviewCycle {
  const cycleId = text(row.id);
  const snapshots = allSnapshots.filter((candidate) => candidate.review_cycle_id === cycleId);
  return {
    schemaVersion: integer(row.schema_version) as GateReviewCycle["schemaVersion"],
    id: cycleId,
    cycleNumber: integer(row.cycle_number),
    previousCycleId: nullableText(row.previous_cycle_id),
    project: json<GateReviewProjectSnapshot>(row.project_snapshot),
    package: json<GateReviewPackageSnapshot | null>(row.package_snapshot),
    gate: json<GateReviewGateSnapshot>(row.gate_snapshot),
    status: text(row.status) as GateReviewCycle["status"],
    submittedAt: timestamp(row.submitted_at),
    submittedBy: json<GateReviewActorSnapshot>(row.submitted_by),
    decision: nullableText(row.decision) as GateReviewCycle["decision"],
    decisionComments: text(row.decision_comments),
    completedAt: nullableTimestamp(row.completed_at),
    withdrawnAt: nullableTimestamp(row.withdrawn_at),
    withdrawnBy: json<GateReviewActorSnapshot | null>(row.withdrawn_by),
    withdrawalReason: nullableText(row.withdrawal_reason),
    frozenEvidence: json<GateReviewFrozenEvidence>(row.frozen_evidence),
    approvers: snapshots.map((snapshot) => {
      const gateApproverId = text(snapshot.gate_approver_id);
      const response = allResponses.find(
        (candidate) =>
          candidate.review_cycle_id === cycleId &&
          candidate.gate_approver_id === gateApproverId,
      );
      const activatedAt = nullableTimestamp(snapshot.invitation_activated_at);
      return {
        gateApproverId,
        name: text(snapshot.name),
        email: text(snapshot.email),
        roleFunction: text(snapshot.role_function),
        approvalRole: text(snapshot.approval_role),
        approvalLevel: integer(snapshot.approval_level),
        response: response
          ? {
              outcome: text(response.outcome),
              respondedAt: timestamp(response.responded_at),
              respondedBy: json<GateReviewActorSnapshot>(response.responded_by),
              comment: text(response.comment),
            } as GateReviewApproverResponse
          : null,
        invitation: activatedAt
          ? {
              activatedAt,
              attempts: allAttempts
                .filter(
                  (candidate) =>
                    candidate.review_cycle_id === cycleId &&
                    candidate.gate_approver_id === gateApproverId,
                )
                .map((attempt) => ({
                  id: text(attempt.id),
                  idempotencyKey: text(attempt.idempotency_key),
                  provider: text(attempt.provider),
                  status: text(attempt.status) as GateReviewInvitationAttemptStatus,
                  attemptedAt: timestamp(attempt.attempted_at),
                  completedAt: nullableTimestamp(attempt.completed_at),
                  providerMessageId: nullableText(attempt.provider_message_id),
                  error: attempt.error_code == null
                    ? null
                    : {
                        code: text(attempt.error_code),
                        message: text(attempt.error_message),
                      },
                })),
            }
          : null,
      };
    }),
    relatedReworkActionIds: allReworkActions
      .filter((candidate) => candidate.review_cycle_id === cycleId)
      .map((candidate) => text(candidate.action_id)),
  };
}

export async function loadGateDeliverables(
  client: PoolClient,
  projectId: string,
  packageId: string | null,
  gateId: string,
): Promise<Deliverable[]> {
  const result = await client.query(
    `SELECT * FROM deliverable
     WHERE project_id = $1
       AND package_id IS NOT DISTINCT FROM $2::text
       AND gate_id = $3
     ORDER BY sequence, id`,
    [projectId, packageId, gateId],
  );
  const deliverableRows = rows(result);
  const ids = deliverableRows.map((row) => text(row.id));
  const linkResult = ids.length > 0
    ? await client.query(
        `SELECT * FROM deliverable_criterion
         WHERE deliverable_id = ANY($1::text[])
         ORDER BY deliverable_id, sequence, criterion_id`,
        [ids],
      )
    : { rows: [] };
  const links = rows(linkResult);
  return deliverableRows.map((row) => mapDeliverable(row, links));
}

export async function loadDeliverable(
  client: PoolClient,
  deliverableId: string,
): Promise<Deliverable | null> {
  const result = await client.query("SELECT * FROM deliverable WHERE id = $1", [deliverableId]);
  const row = rows(result)[0];
  if (!row) return null;
  const linkResult = await client.query(
    `SELECT * FROM deliverable_criterion
     WHERE deliverable_id = $1
     ORDER BY sequence, criterion_id`,
    [deliverableId],
  );
  return mapDeliverable(row, rows(linkResult));
}

function mapDeliverable(row: Row, links: Row[]): Deliverable {
  const id = text(row.id);
  return {
    id,
    templateId: nullableText(row.template_id),
    templateVersion: row.template_version == null ? null : integer(row.template_version),
    projectId: text(row.project_id),
    packageId: nullableText(row.package_id),
    gateId: text(row.gate_id),
    criterionIds: links
      .filter((link) => link.deliverable_id === id)
      .map((link) => text(link.criterion_id)),
    title: text(row.title),
    description: text(row.description),
    status: text(row.status) as Deliverable["status"],
    stageId: text(row.stage_id),
    scopeLevel: text(row.scope_level) as Deliverable["scopeLevel"],
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function loadProjectActions(
  client: PoolClient,
  projectId: string,
  includeArchivedProject = false,
): Promise<ProjectAction[]> {
  const result = await client.query(
    `SELECT action.*, action.due_date::text AS due_date
     FROM project_action AS action
     JOIN project ON project.id = action.project_id
     WHERE action.project_id = $1
       AND ($2::boolean OR project.archived_at IS NULL)
     ORDER BY action.sequence, action.id`,
    [projectId, includeArchivedProject],
  );
  return mapActions(client, rows(result));
}

export async function loadProjectAction(
  client: PoolClient,
  projectId: string,
  actionId: string,
  includeArchivedProject = false,
): Promise<ProjectAction | null> {
  const result = await client.query(
    `SELECT action.*, action.due_date::text AS due_date
     FROM project_action AS action
     JOIN project ON project.id = action.project_id
     WHERE action.project_id = $1 AND action.id = $2
       AND ($3::boolean OR project.archived_at IS NULL)`,
    [projectId, actionId, includeArchivedProject],
  );
  const mapped = await mapActions(client, rows(result));
  return mapped[0] ?? null;
}

async function mapActions(client: PoolClient, actionRows: Row[]): Promise<ProjectAction[]> {
  const ids = actionRows.map((row) => text(row.id));
  if (ids.length === 0) return [];
  const packageResult = await client.query(
    `SELECT * FROM project_action_package
     WHERE action_id = ANY($1::text[])
     ORDER BY action_id, sequence, package_id`,
    [ids],
  );
  const updateResult = await client.query(
    `SELECT * FROM project_action_update
     WHERE action_id = ANY($1::text[])
     ORDER BY action_id, sequence, id`,
    [ids],
  );
  const referenceResult = await client.query(
    `SELECT * FROM action_gate_decision_reference
     WHERE action_id = ANY($1::text[])
     ORDER BY action_id, sequence, id`,
    [ids],
  );
  const packageRows = rows(packageResult);
  const updateRows = rows(updateResult);
  const referenceRows = rows(referenceResult);

  return actionRows.map((row) => {
    const id = text(row.id);
    const updates: ProjectActionUpdate[] = updateRows
      .filter((candidate) => candidate.action_id === id)
      .map((update) => ({
        id: text(update.id),
        occurredAt: timestamp(update.occurred_at),
        actor: {
          userId: nullableText(update.actor_user_id),
          displayName: text(update.actor_display_name),
        },
        kind: text(update.kind) as ProjectActionUpdate["kind"],
        text: text(update.text),
        changes: json<ProjectActionChange[]>(update.changes),
      }));
    const gateDecisionReferences: GateDecisionReference[] = referenceRows
      .filter((candidate) => candidate.action_id === id)
      .map((reference) => ({
        id: text(reference.id),
        gateId: text(reference.gate_id),
        decision: text(reference.decision) as GateDecisionReference["decision"],
        recordedAt: timestamp(reference.recorded_at),
      }));
    return {
      id,
      projectId: text(row.project_id),
      sequence: integer(row.sequence),
      description: text(row.description),
      assignee: text(row.assignee),
      dueDate: nullableDate(row.due_date),
      status: text(row.status) as ProjectAction["status"],
      priority: nullableText(row.priority) as ProjectAction["priority"],
      packageIds: packageRows
        .filter((candidate) => candidate.action_id === id)
        .map((candidate) => text(candidate.package_id)),
      governanceTierId: nullableText(row.governance_tier_id),
      gateId: nullableText(row.gate_id),
      source: text(row.source) as ProjectAction["source"],
      packageAssociationLocked: Boolean(row.package_association_locked),
      loggedBy: {
        userId: nullableText(row.logged_by_user_id),
        displayName: text(row.logged_by_display_name),
      },
      dateLogged: timestamp(row.date_logged),
      closingDate: nullableTimestamp(row.closing_date),
      lastUpdated: timestamp(row.last_updated),
      updates,
      gateDecisionReferences,
    };
  });
}
