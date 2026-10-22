import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { canonicalJson, logicalFingerprint } from "./operational-data.mjs";

const TABLE_COLUMNS = {
  project: [
    "id", "project_number", "name", "description", "project_manager", "customer", "reports_to",
    "site_location", "planned_start_date", "planned_completion_date", "validation_required", "current_stage",
    "created_at", "updated_at", "archived_at",
  ],
  project_membership: ["project_id", "user_id", "role"],
  governance_tier: ["id", "project_id", "sequence", "name", "description"],
  project_package: [
    "id", "project_id", "package_code", "package_name", "description", "package_owner", "execution_model",
    "current_stage", "status", "target_delivery_date", "created_at", "updated_at", "archived_at",
  ],
  gate: [
    "id", "project_id", "package_id", "scope_level", "sequence", "template_version", "name", "stage_id", "status",
  ],
  gate_criterion: ["id", "gate_id", "sequence", "template_id", "description", "status"],
  gate_approver: [
    "id", "gate_id", "sequence", "name", "email", "role_function", "approval_role", "approval_level",
  ],
  deliverable: [
    "id", "template_id", "template_version", "project_id", "package_id", "gate_id", "sequence", "title",
    "description", "status", "stage_id", "scope_level", "created_at", "updated_at",
  ],
  deliverable_criterion: ["deliverable_id", "criterion_id", "gate_id", "sequence"],
  project_action_sequence: ["project_id", "next_sequence"],
  project_action: [
    "id", "project_id", "sequence", "description", "assignee", "due_date", "status", "priority",
    "governance_tier_id", "gate_id", "source", "package_association_locked", "logged_by_user_id",
    "logged_by_display_name", "date_logged", "closing_date", "last_updated",
  ],
  project_action_package: ["action_id", "package_id", "project_id", "sequence"],
  project_action_update: [
    "id", "action_id", "sequence", "occurred_at", "actor_user_id", "actor_display_name", "kind", "text", "changes",
  ],
  action_gate_decision_reference: [
    "id", "action_id", "gate_id", "project_id", "sequence", "decision", "recorded_at",
  ],
  gate_review_cycle: [
    "id", "gate_id", "schema_version", "cycle_number", "previous_cycle_id", "project_snapshot", "package_snapshot",
    "gate_snapshot", "status", "submitted_at", "submitted_by", "submitted_by_user_id", "decision",
    "decision_comments", "completed_at", "withdrawn_at", "withdrawn_by", "withdrawn_by_user_id",
    "withdrawal_reason", "frozen_evidence",
  ],
  gate_review_cycle_approver: [
    "review_cycle_id", "gate_approver_id", "sequence", "name", "email", "role_function", "approval_role",
    "approval_level", "assigned_user_id", "invitation_activated_at",
  ],
  gate_review_response: [
    "review_cycle_id", "gate_approver_id", "outcome", "responded_at", "responded_by",
    "responded_by_user_id", "comment",
  ],
  gate_review_invitation_attempt: [
    "id", "review_cycle_id", "gate_approver_id", "sequence", "idempotency_key", "provider", "status",
    "attempted_at", "completed_at", "provider_message_id", "error_code", "error_message",
  ],
  gate_review_rework_action: ["review_cycle_id", "action_id", "sequence"],
};

const INSERT_ORDER = Object.keys(TABLE_COLUMNS);
export const OPERATIONAL_TABLES = [...INSERT_ORDER, "operational_import"];
const JSON_COLUMNS = new Set([
  "project_action_update.changes",
  "gate_review_cycle.project_snapshot",
  "gate_review_cycle.package_snapshot",
  "gate_review_cycle.gate_snapshot",
  "gate_review_cycle.submitted_by",
  "gate_review_cycle.withdrawn_by",
  "gate_review_cycle.frozen_evidence",
  "gate_review_response.responded_by",
]);
const DATE_COLUMNS = new Set([
  "project.planned_start_date",
  "project.planned_completion_date",
  "project_package.target_delivery_date",
  "project_action.due_date",
]);

export async function loadOwnerMapping(filePath, projects) {
  if (!filePath) return { rows: [], source: null };

  const contents = await readFile(filePath, "utf8");
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("The owner-map file is not valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.owners)
  ) {
    throw new Error('The owner-map must have the form { "owners": [{ "projectId": "...", "userId": "..." }] }.');
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const seen = new Set();
  const rows = value.owners.map((owner, index) => {
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      Object.keys(owner).sort().join(",") !== "projectId,userId" ||
      typeof owner.projectId !== "string" ||
      !owner.projectId ||
      typeof owner.userId !== "string" ||
      !owner.userId
    ) {
      throw new Error(`Owner mapping entry ${index + 1} is invalid.`);
    }
    if (!projectIds.has(owner.projectId)) {
      throw new Error(`Owner mapping references unknown Project ${owner.projectId}.`);
    }
    if (seen.has(owner.projectId)) {
      throw new Error(`Owner mapping contains duplicate Project ${owner.projectId}.`);
    }
    seen.add(owner.projectId);
    return { project_id: owner.projectId, user_id: owner.userId, role: "owner" };
  });

  if (seen.size !== projectIds.size) {
    const missing = [...projectIds].filter((projectId) => !seen.has(projectId));
    throw new Error(`Owner mapping is missing Project ownership for: ${missing.join(", ")}.`);
  }

  return {
    rows,
    source: {
      projectIds: rows.map((row) => row.project_id).sort(),
      userIds: rows.map((row) => row.user_id).sort(),
    },
  };
}

export function buildRelationalRows(source, ownerRows = []) {
  const rows = Object.fromEntries(INSERT_ORDER.map((table) => [table, []]));
  rows.project_membership.push(...ownerRows);

  for (const project of source.projects) {
    rows.project.push({
      id: project.id,
      project_number: project.projectNumber,
      name: project.name,
      description: project.description,
      project_manager: project.projectManager,
      customer: project.customer,
      reports_to: project.reportsTo,
      site_location: project.siteLocation,
      planned_start_date: emptyDateToNull(project.plannedStartDate),
      planned_completion_date: emptyDateToNull(project.plannedCompletionDate),
      validation_required: project.validationRequired,
      current_stage: project.currentStage,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      archived_at: null,
    });
    project.governanceTiers.forEach((tier) => rows.governance_tier.push({
      id: tier.id,
      project_id: project.id,
      sequence: tier.sequence,
      name: tier.name,
      description: tier.description,
    }));
    addGates(rows, project.gates, project.id, null, "project");
  }

  for (const projectPackage of source.packages) {
    rows.project_package.push({
      id: projectPackage.id,
      project_id: projectPackage.projectId,
      package_code: projectPackage.packageCode,
      package_name: projectPackage.packageName,
      description: projectPackage.description,
      package_owner: projectPackage.packageOwner,
      execution_model: projectPackage.executionModel,
      current_stage: projectPackage.currentStage,
      status: projectPackage.status,
      target_delivery_date: emptyDateToNull(projectPackage.targetDeliveryDate),
      created_at: projectPackage.createdAt,
      updated_at: projectPackage.updatedAt,
      archived_at: null,
    });
    addGates(rows, projectPackage.gates, projectPackage.projectId, projectPackage.id, "package");
  }

  const deliverableSequence = new Map();
  for (const deliverable of source.deliverables) {
    const sequence = nextSequence(deliverableSequence, deliverable.gateId);
    rows.deliverable.push({
      id: deliverable.id,
      template_id: deliverable.templateId,
      template_version: deliverable.templateVersion,
      project_id: deliverable.projectId,
      package_id: deliverable.packageId,
      gate_id: deliverable.gateId,
      sequence,
      title: deliverable.title,
      description: deliverable.description,
      status: deliverable.status,
      stage_id: deliverable.stageId,
      scope_level: deliverable.scopeLevel,
      created_at: deliverable.createdAt,
      updated_at: deliverable.updatedAt,
    });
    deliverable.criterionIds.forEach((criterionId, index) =>
      rows.deliverable_criterion.push({
        deliverable_id: deliverable.id,
        criterion_id: criterionId,
        gate_id: deliverable.gateId,
        sequence: index + 1,
      }));
  }

  for (const [projectId, nextSequenceValue] of Object.entries(source.actionStore.nextSequenceByProject)) {
    rows.project_action_sequence.push({ project_id: projectId, next_sequence: nextSequenceValue });
  }
  for (const action of source.actionStore.actions) {
    rows.project_action.push({
      id: action.id,
      project_id: action.projectId,
      sequence: action.sequence,
      description: action.description,
      assignee: action.assignee,
      due_date: action.dueDate,
      status: action.status,
      priority: action.priority,
      governance_tier_id: action.governanceTierId,
      gate_id: action.gateId,
      source: action.source,
      package_association_locked: action.packageAssociationLocked,
      logged_by_user_id: action.loggedBy.userId,
      logged_by_display_name: action.loggedBy.displayName,
      date_logged: action.dateLogged,
      closing_date: action.closingDate,
      last_updated: action.lastUpdated,
    });
    action.packageIds.forEach((packageId, index) => rows.project_action_package.push({
      action_id: action.id,
      package_id: packageId,
      project_id: action.projectId,
      sequence: index + 1,
    }));
    action.updates.forEach((update, index) => rows.project_action_update.push({
      id: update.id,
      action_id: action.id,
      sequence: index + 1,
      occurred_at: update.occurredAt,
      actor_user_id: update.actor.userId,
      actor_display_name: update.actor.displayName,
      kind: update.kind,
      text: update.text,
      changes: update.changes,
    }));
    action.gateDecisionReferences.forEach((reference, index) =>
      rows.action_gate_decision_reference.push({
        id: reference.id,
        action_id: action.id,
        gate_id: reference.gateId,
        project_id: action.projectId,
        sequence: index + 1,
        decision: reference.decision,
        recorded_at: reference.recordedAt,
      }));
  }

  return sortRelationalRows(rows);
}

export async function importOperationalRows({
  connectionString,
  expectedDatabase,
  databaseRole,
  rows,
  importRecord,
}) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await setDatabaseRole(client, databaseRole);
    await assertExpectedDatabase(client, expectedDatabase);
    await assertOperationalSchema(client);
    await assertTargetEmpty(client);
    await validateOwnerUsers(client, rows.project_membership);

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      for (const table of INSERT_ORDER) {
        await insertRows(client, table, TABLE_COLUMNS[table], rows[table]);
      }
      await client.query(
        `INSERT INTO operational_import (
           migration_version,
           source_commit,
           source_worktree_dirty,
           source_manifest,
           projection_manifest,
           owner_mapping_applied,
           logical_fingerprint,
           started_at,
           completed_at,
           result
         ) VALUES (5, $1, $2, $3, $4, $5, $6, $7, $8, 'pass')`,
        [
          importRecord.sourceCommit,
          importRecord.sourceWorktreeDirty,
          importRecord.sourceManifest,
          importRecord.projectionManifest,
          rows.project_membership.length > 0,
          importRecord.logicalFingerprint,
          importRecord.startedAt,
          importRecord.completedAt,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

export async function validateImportedRows({
  connectionString,
  expectedDatabase,
  databaseRole,
  expectedRows,
}) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await setDatabaseRole(client, databaseRole);
    await assertExpectedDatabase(client, expectedDatabase);
    await assertOperationalSchema(client);
    const actualRows = {};
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const result = await client.query(
        `SELECT ${columns.map((column) =>
          DATE_COLUMNS.has(`${table}.${column}`)
            ? `${quoteIdentifier(column)}::text AS ${quoteIdentifier(column)}`
            : quoteIdentifier(column)).join(", ")} FROM ${quoteIdentifier(table)}`,
      );
      actualRows[table] = result.rows.map(normalizeDatabaseValue);
    }
    const sortedActual = sortRelationalRows(actualRows);
    if (canonicalJson(sortedActual) !== canonicalJson(expectedRows)) {
      const difference = firstDifference(expectedRows, sortedActual);
      throw new Error(
        `Imported PostgreSQL rows differ from the expected operational domain projection at ${difference.path} ` +
        `(expected ${difference.expectedType}; found ${difference.actualType}).`,
      );
    }
    const importRows = await client.query(
      "SELECT migration_version, logical_fingerprint, result FROM operational_import ORDER BY completed_at",
    );
    const expectedFingerprint = logicalFingerprint(expectedRows);
    if (
      importRows.rowCount !== 1 ||
      importRows.rows[0].migration_version !== 5 ||
      importRows.rows[0].result !== "pass" ||
      importRows.rows[0].logical_fingerprint !== expectedFingerprint
    ) {
      throw new Error("The operational import manifest does not match the imported data.");
    }
    return {
      rows: sortedActual,
      logicalFingerprint: expectedFingerprint,
      counts: importedEntityCounts(sortedActual),
    };
  } finally {
    await client.end();
  }
}

export function importedEntityCounts(rows) {
  return {
    projects: rows.project.length,
    projectMemberships: rows.project_membership.length,
    governanceTiers: rows.governance_tier.length,
    packages: rows.project_package.length,
    projectGates: rows.gate.filter((gate) => gate.scope_level === "project").length,
    packageGates: rows.gate.filter((gate) => gate.scope_level === "package").length,
    gateCriteria: rows.gate_criterion.length,
    configuredGateApprovers: rows.gate_approver.length,
    reviewCycles: rows.gate_review_cycle.length,
    reviewCycleApprovers: rows.gate_review_cycle_approver.length,
    reviewResponses: rows.gate_review_response.length,
    invitationAttempts: rows.gate_review_invitation_attempt.length,
    deliverables: rows.deliverable.length,
    deliverableCriteria: rows.deliverable_criterion.length,
    actions: rows.project_action.length,
    actionUpdates: rows.project_action_update.length,
    actionPackageLinks: rows.project_action_package.length,
    gateDecisionReferences: rows.action_gate_decision_reference.length,
    reviewReworkActions: rows.gate_review_rework_action.length,
    legacyBackupActions: 0,
  };
}

function addGates(rows, gates, projectId, packageId, scopeLevel) {
  gates.forEach((gate, gateIndex) => {
    rows.gate.push({
      id: gate.id,
      project_id: projectId,
      package_id: packageId,
      scope_level: scopeLevel,
      sequence: gateIndex + 1,
      template_version: gate.templateVersion,
      name: gate.name,
      stage_id: gate.stageId,
      status: gate.status,
    });
    gate.criteria.forEach((criterion, index) => rows.gate_criterion.push({
      id: criterion.id,
      gate_id: gate.id,
      sequence: index + 1,
      template_id: criterion.templateId,
      description: criterion.description,
      status: criterion.status,
    }));
    gate.approvers.forEach((approver, index) => rows.gate_approver.push({
      id: approver.id,
      gate_id: gate.id,
      sequence: index + 1,
      name: approver.name,
      email: approver.email,
      role_function: approver.roleFunction,
      approval_role: approver.approvalRole,
      approval_level: approver.approvalLevel,
    }));
    gate.reviewCycles.forEach((cycle) => addReviewCycle(rows, cycle, gate.id));
  });
}

function addReviewCycle(rows, cycle, gateId) {
  rows.gate_review_cycle.push({
    id: cycle.id,
    gate_id: gateId,
    schema_version: cycle.schemaVersion,
    cycle_number: cycle.cycleNumber,
    previous_cycle_id: cycle.previousCycleId,
    project_snapshot: cycle.project,
    package_snapshot: cycle.package,
    gate_snapshot: cycle.gate,
    status: cycle.status,
    submitted_at: cycle.submittedAt,
    submitted_by: cycle.submittedBy,
    submitted_by_user_id: cycle.submittedBy.userId,
    decision: cycle.decision,
    decision_comments: cycle.decisionComments,
    completed_at: cycle.completedAt,
    withdrawn_at: cycle.withdrawnAt,
    withdrawn_by: cycle.withdrawnBy,
    withdrawn_by_user_id: cycle.withdrawnBy?.userId ?? null,
    withdrawal_reason: cycle.withdrawalReason,
    frozen_evidence: cycle.frozenEvidence,
  });
  cycle.approvers.forEach((approver, index) => {
    rows.gate_review_cycle_approver.push({
      review_cycle_id: cycle.id,
      gate_approver_id: approver.gateApproverId,
      sequence: index + 1,
      name: approver.name,
      email: approver.email,
      role_function: approver.roleFunction,
      approval_role: approver.approvalRole,
      approval_level: approver.approvalLevel,
      assigned_user_id: null,
      invitation_activated_at: approver.invitation?.activatedAt ?? null,
    });
    if (approver.response) {
      rows.gate_review_response.push({
        review_cycle_id: cycle.id,
        gate_approver_id: approver.gateApproverId,
        outcome: approver.response.outcome,
        responded_at: approver.response.respondedAt,
        responded_by: approver.response.respondedBy,
        responded_by_user_id: approver.response.respondedBy.userId,
        comment: approver.response.comment,
      });
    }
    (approver.invitation?.attempts ?? []).forEach((attempt, attemptIndex) =>
      rows.gate_review_invitation_attempt.push({
        id: attempt.id,
        review_cycle_id: cycle.id,
        gate_approver_id: approver.gateApproverId,
        sequence: attemptIndex + 1,
        idempotency_key: attempt.idempotencyKey,
        provider: attempt.provider,
        status: attempt.status,
        attempted_at: attempt.attemptedAt,
        completed_at: attempt.completedAt,
        provider_message_id: attempt.providerMessageId,
        error_code: attempt.error?.code ?? null,
        error_message: attempt.error?.message ?? null,
      }));
  });
  cycle.relatedReworkActionIds.forEach((actionId, index) =>
    rows.gate_review_rework_action.push({
      review_cycle_id: cycle.id,
      action_id: actionId,
      sequence: index + 1,
    }));
}

async function assertExpectedDatabase(client, expectedDatabase) {
  if (!expectedDatabase) {
    throw new Error("OPERATIONAL_EXPECTED_DATABASE is required for import and validation.");
  }
  const result = await client.query("SELECT current_database() AS name");
  if (result.rows[0]?.name !== expectedDatabase) {
    throw new Error(
      `Database safety check failed. Expected ${expectedDatabase}; connected to ${result.rows[0]?.name ?? "unknown"}.`,
    );
  }
}

async function assertOperationalSchema(client) {
  const result = await client.query(
    `SELECT name
     FROM identity_schema_migration
      WHERE name IN (
        '004_operational_data_foundation.sql',
        '005_protect_gate_review_attempt_history.sql',
        '006_runtime_persistence_safety.sql'
      )`,
  );
  if (result.rowCount !== 3) {
    throw new Error("Operational migrations 004, 005, and 006 have not all been applied to the target database.");
  }
}

async function assertTargetEmpty(client) {
  const counts = [];
  for (const table of [...INSERT_ORDER, "operational_import"]) {
    const result = await client.query(`SELECT count(*)::integer AS count FROM ${quoteIdentifier(table)}`);
    if (result.rows[0].count > 0) counts.push(`${table}=${result.rows[0].count}`);
  }
  if (counts.length > 0) {
    throw new Error(`Operational target is not empty: ${counts.join(", ")}.`);
  }
}

async function validateOwnerUsers(client, memberships) {
  for (const membership of memberships) {
    const result = await client.query(
      `SELECT 1
       FROM app_user
       WHERE id = $1
         AND status = 'active'
         AND access_class = 'internal'`,
      [membership.user_id],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `Owner mapping for Project ${membership.project_id} does not identify an active internal application User.`,
      );
    }
  }
}

async function insertRows(client, table, columns, rows) {
  if (rows.length === 0) return;
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const parameterSql = columns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${parameterSql})`;
  for (const row of rows) {
    await client.query(sql, columns.map((column) =>
      JSON_COLUMNS.has(`${table}.${column}`) && row[column] !== null
        ? JSON.stringify(row[column])
        : row[column]));
  }
}

function sortRelationalRows(rows) {
  return Object.fromEntries(
    Object.entries(rows).sort(([left], [right]) => left.localeCompare(right)).map(([table, tableRows]) => [
      table,
      tableRows
        .map(normalizeDatabaseValue)
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    ]),
  );
}

function normalizeDatabaseValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDatabaseValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeDatabaseValue(child)]),
    );
  }
  return value;
}

function firstDifference(expected, actual, path = "rows") {
  if (Object.is(expected, actual)) return null;
  const expectedType = jsonType(expected);
  const actualType = jsonType(actual);
  if (expectedType !== actualType) return { path, expectedType, actualType };
  if (expectedType === "array") {
    if (expected.length !== actual.length) {
      return {
        path: `${path}.length`,
        expectedType: `number(${expected.length})`,
        actualType: `number(${actual.length})`,
      };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
  } else if (expectedType === "object") {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (canonicalJson(expectedKeys) !== canonicalJson(actualKeys)) {
      return { path: `${path}.keys`, expectedType: "key-set", actualType: "different-key-set" };
    }
    for (const key of expectedKeys) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference) return difference;
    }
  } else {
    return { path, expectedType: `${expectedType}(value)`, actualType: `${actualType}(different-value)` };
  }
  return null;
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function nextSequence(counters, key) {
  const sequence = (counters.get(key) ?? 0) + 1;
  counters.set(key, sequence);
  return sequence;
}

function emptyDateToNull(value) {
  return value || null;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier ${value}.`);
  return `"${value}"`;
}

async function setDatabaseRole(client, role) {
  if (!role) return;
  await client.query(`SET ROLE ${quoteIdentifier(role)}`);
}
