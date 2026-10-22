import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const OPERATIONAL_SOURCE_FILES = [
  "projects.json",
  "packages.json",
  "deliverables.json",
  "actions.json",
  "actions.schema-v1.backup.json",
];

const PROJECT_STAGES = ["initiation", "definition_design", "delivery", "validation", "closure"];
const PACKAGE_STAGES = ["definition", "tendering", "procurement", "execution", "closure"];
const GATE_STATUSES = [
  "not_submitted",
  "submitted_for_approval",
  "approved",
  "approved_with_actions",
  "returned_for_rework",
];
const CRITERION_STATUSES = ["pending", "completed", "not_applicable"];
const DELIVERABLE_STATUSES = ["not_started", "in_progress", "completed", "not_applicable"];
const ACTION_STATUSES = ["new", "in_progress", "finished", "closed"];
const ACTION_PRIORITIES = ["low", "medium", "high", "critical"];
const ACTION_SOURCES = ["manual", "gate", "meeting", "risk", "issue", "change_moc", "decision"];
const REVIEW_STATUSES = [
  "awaiting_approval",
  "withdrawn",
  "returned_for_rework",
  "approved",
  "approved_with_actions",
];
const RESPONSE_OUTCOMES = ["approved", "returned_for_rework"];
const INVITATION_STATUSES = ["dispatching", "sent", "failed", "indeterminate"];
const DECISIONS = ["approved", "approved_with_actions"];
const PROTECTED_DECISIONS = ["approved", "approved_with_actions", "rejected_rework"];

export async function loadOperationalSource({
  sourceDirectory,
  projectionManifestPath,
  allowRuntimeProjection,
}) {
  const sourceFiles = {};
  const inventory = [];

  for (const name of OPERATIONAL_SOURCE_FILES) {
    const filePath = path.join(sourceDirectory, name);
    const contents = await readFile(filePath, "utf8");
    const fileStat = await stat(filePath);
    let value;
    try {
      value = JSON.parse(contents);
    } catch (error) {
      throw new Error(`${name} is not valid JSON: ${safeErrorMessage(error)}`);
    }
    sourceFiles[name] = value;
    inventory.push({
      name,
      bytes: fileStat.size,
      sha256: sha256(contents),
    });
  }

  const raw = {
    projects: sourceFiles["projects.json"],
    packages: sourceFiles["packages.json"],
    deliverables: sourceFiles["deliverables.json"],
    actionStore: sourceFiles["actions.json"],
    legacyActionBackup: sourceFiles["actions.schema-v1.backup.json"],
  };
  validateSourceStructure(raw);

  const projectionManifestContents = await readFile(projectionManifestPath, "utf8");
  const projectionManifest = JSON.parse(projectionManifestContents);
  validateProjectionManifest(projectionManifest);
  await verifyProjectionSourceFiles(projectionManifest);

  const projection = await projectRuntimeState(raw);
  if (projection.changes.scalarChanges.length || projection.changes.addedCriteria.length) {
    if (!allowRuntimeProjection) {
      throw new Error(
        "The source requires the approved runtime projection. Re-run with --allow-runtime-projection after reviewing the projection manifest.",
      );
    }
    assertCanonicalEqual(
      projection.changes,
      {
        scalarChanges: [...projectionManifest.scalarChanges].sort(compareProjectionChanges),
        addedCriteria: [...projectionManifest.addedCriteria].sort((left, right) =>
          left.criterion.id.localeCompare(right.criterion.id)),
      },
      "Runtime projection differs from the approved projection manifest",
    );
  }

  const allowedMissingCriteria = new Set(
    projectionManifest.addedCriteria.map((item) => item.criterion.id),
  );
  const rawValidation = validateRelationships(raw, { allowedMissingCriteria });
  const projectedValidation = validateRelationships(projection.data);

  return {
    raw,
    data: projection.data,
    inventory,
    rawCounts: countEntities(raw),
    projectedCounts: countEntities(projection.data),
    projection: {
      manifestVersion: projectionManifest.version,
      manifestSha256: sha256(projectionManifestContents),
      normalizer: projectionManifest.normalizer,
      templates: projectionManifest.templates,
      changes: projection.changes,
      summary: {
        addedCriteria: projection.changes.addedCriteria.length,
        templateVersionUpdates: projection.changes.scalarChanges.filter(
          (change) => change.field === "templateVersion",
        ).length,
        legacyNameUpdates: projection.changes.scalarChanges.filter(
          (change) => change.field === "name",
        ).length,
      },
    },
    validations: [
      ...rawValidation,
      ...projectedValidation,
      {
        name: "unique-identifiers",
        status: "pass",
        details: "No duplicate operational, history, invitation, update or protected-reference IDs were found.",
      },
      {
        name: "gate-review-sequences",
        status: "pass",
        details: "Review cycle numbers, previous-cycle links and Approver ordering are valid.",
      },
      {
        name: "action-sequences",
        status: "pass",
        details: "Action sequences are unique per Project and each next-sequence counter is safe.",
      },
      {
        name: "deliverable-references",
        status: "pass",
        details: "All projected Deliverable Gate and Criterion relationships resolve.",
      },
    ],
  };
}

export function validateSourceStructure(source) {
  assertArray(source.projects, "projects.json");
  assertArray(source.packages, "packages.json");
  assertArray(source.deliverables, "deliverables.json");
  assertRecord(source.actionStore, "actions.json");
  assertArray(source.legacyActionBackup, "actions.schema-v1.backup.json");
  assertExactKeys(source.actionStore, ["schemaVersion", "nextSequenceByProject", "actions"], "actions.json");
  assertValue(source.actionStore.schemaVersion === 2, "actions.json.schemaVersion must be 2.");
  assertRecord(source.actionStore.nextSequenceByProject, "actions.json.nextSequenceByProject");
  assertArray(source.actionStore.actions, "actions.json.actions");

  source.projects.forEach((project, index) => validateProject(project, `projects[${index}]`));
  source.packages.forEach((projectPackage, index) =>
    validatePackage(projectPackage, `packages[${index}]`));
  source.deliverables.forEach((deliverable, index) =>
    validateDeliverable(deliverable, `deliverables[${index}]`));
  source.actionStore.actions.forEach((action, index) => validateAction(action, `actions[${index}]`));
  source.legacyActionBackup.forEach((action, index) =>
    validateLegacyAction(action, `legacyActions[${index}]`));

  for (const [projectId, nextSequence] of Object.entries(source.actionStore.nextSequenceByProject)) {
    requiredString(projectId, "Action sequence project ID");
    positiveInteger(nextSequence, `nextSequenceByProject.${projectId}`);
  }
}

export function validateRelationships(source, { allowedMissingCriteria = new Set() } = {}) {
  const errors = [];
  const projects = source.projects;
  const packages = source.packages;
  const deliverables = source.deliverables;
  const actions = source.actionStore.actions;
  const projectIds = uniqueIndex(projects, "id", "project", errors);
  const packageIds = uniqueIndex(packages, "id", "package", errors);
  const tiers = uniqueIndex(
    projects.flatMap((project) => project.governanceTiers.map((tier) => ({ ...tier, projectId: project.id }))),
    "id",
    "governance tier",
    errors,
  );
  const gates = [
    ...projects.flatMap((project) =>
      project.gates.map((gate) => ({ ...gate, projectId: project.id, packageId: null }))),
    ...packages.flatMap((projectPackage) =>
      projectPackage.gates.map((gate) => ({
        ...gate,
        projectId: projectPackage.projectId,
        packageId: projectPackage.id,
      }))),
  ];
  const gateIds = uniqueIndex(gates, "id", "gate", errors);
  const criteria = uniqueIndex(
    gates.flatMap((gate) => gate.criteria.map((criterion) => ({ ...criterion, gateId: gate.id }))),
    "id",
    "criterion",
    errors,
  );
  const actionIds = uniqueIndex(actions, "id", "action", errors);

  uniqueIndex(deliverables, "id", "deliverable", errors);
  uniqueIndex(actions.flatMap((action) => action.updates), "id", "action update", errors);
  uniqueIndex(
    actions.flatMap((action) => action.gateDecisionReferences),
    "id",
    "gate decision reference",
    errors,
  );
  const cycles = gates.flatMap((gate) =>
    gate.reviewCycles.map((cycle) => ({ ...cycle, parentGate: gate })),
  );
  uniqueIndex(cycles, "id", "review cycle", errors);
  const attempts = cycles.flatMap((cycle) =>
    cycle.approvers.flatMap((approver) => approver.invitation?.attempts ?? []),
  );
  uniqueIndex(attempts, "id", "invitation attempt", errors);
  uniqueScalar(attempts.map((attempt) => attempt.idempotencyKey), "invitation idempotency key", errors);

  for (const project of projects) {
    uniqueScalar(project.governanceTiers.map((tier) => tier.sequence), `tier sequence in ${project.id}`, errors);
    uniqueScalar(
      project.governanceTiers.map((tier) => tier.name.toLocaleLowerCase()),
      `tier name in ${project.id}`,
      errors,
    );
  }
  for (const projectPackage of packages) {
    if (!projectIds.has(projectPackage.projectId)) {
      errors.push(`Package ${projectPackage.id} references missing Project ${projectPackage.projectId}.`);
    }
  }
  for (const project of projects) {
    const codes = packages
      .filter((projectPackage) => projectPackage.projectId === project.id)
      .map((projectPackage) => projectPackage.packageCode.toLocaleLowerCase());
    uniqueScalar(codes, `Package code in Project ${project.id}`, errors);
  }

  for (const gate of gates) {
    uniqueScalar(gate.criteria.map((criterion) => criterion.id), `criterion in Gate ${gate.id}`, errors);
    uniqueScalar(gate.approvers.map((approver) => approver.id), `approver in Gate ${gate.id}`, errors);
    uniqueScalar(gate.reviewCycles.map((cycle) => cycle.cycleNumber), `cycle number in Gate ${gate.id}`, errors);
    const cycleIds = new Set(gate.reviewCycles.map((cycle) => cycle.id));
    const orderedCycles = [...gate.reviewCycles].sort((left, right) => left.cycleNumber - right.cycleNumber);
    for (let index = 0; index < orderedCycles.length; index += 1) {
      const cycle = orderedCycles[index];
      if (cycle.previousCycleId !== (orderedCycles[index - 1]?.id ?? null)) {
        errors.push(`Review Cycle ${cycle.id} has an invalid previousCycleId.`);
      }
      if (cycle.previousCycleId && !cycleIds.has(cycle.previousCycleId)) {
        errors.push(`Review Cycle ${cycle.id} references a missing previous cycle.`);
      }
      if (cycle.project.id !== gate.projectId) {
        errors.push(`Review Cycle ${cycle.id} has a mismatched Project snapshot.`);
      }
      if ((cycle.package?.id ?? null) !== gate.packageId) {
        errors.push(`Review Cycle ${cycle.id} has a mismatched Package snapshot.`);
      }
      if (cycle.gate.id !== gate.id) {
        errors.push(`Review Cycle ${cycle.id} has a mismatched Gate snapshot.`);
      }
      uniqueScalar(
        cycle.approvers.map((approver) => approver.gateApproverId),
        `Approver snapshot in Review Cycle ${cycle.id}`,
        errors,
      );
      for (const actionId of cycle.relatedReworkActionIds) {
        if (!actionIds.has(actionId)) {
          errors.push(`Review Cycle ${cycle.id} references missing rework Action ${actionId}.`);
        }
      }
    }
  }

  for (const deliverable of deliverables) {
    const gate = gateIds.get(deliverable.gateId);
    if (!projectIds.has(deliverable.projectId)) {
      errors.push(`Deliverable ${deliverable.id} references a missing Project.`);
    }
    if (deliverable.packageId && !packageIds.has(deliverable.packageId)) {
      errors.push(`Deliverable ${deliverable.id} references a missing Package.`);
    }
    if (!gate) {
      errors.push(`Deliverable ${deliverable.id} references missing Gate ${deliverable.gateId}.`);
      continue;
    }
    if (gate.projectId !== deliverable.projectId || gate.packageId !== deliverable.packageId) {
      errors.push(`Deliverable ${deliverable.id} does not match its Gate scope.`);
    }
    if (gate.stageId !== deliverable.stageId) {
      errors.push(`Deliverable ${deliverable.id} does not match its Gate stage.`);
    }
    for (const criterionId of deliverable.criterionIds) {
      const criterion = criteria.get(criterionId);
      if (!criterion) {
        if (!allowedMissingCriteria.has(criterionId)) {
          errors.push(`Deliverable ${deliverable.id} references missing Criterion ${criterionId}.`);
        }
      } else if (criterion.gateId !== deliverable.gateId) {
        errors.push(`Deliverable ${deliverable.id} references a Criterion from another Gate.`);
      }
    }
  }

  for (const action of actions) {
    if (!projectIds.has(action.projectId)) {
      errors.push(`Action ${action.id} references missing Project ${action.projectId}.`);
    }
    for (const packageId of action.packageIds) {
      const projectPackage = packageIds.get(packageId);
      if (!projectPackage || projectPackage.projectId !== action.projectId) {
        errors.push(`Action ${action.id} references invalid Package ${packageId}.`);
      }
    }
    if (action.governanceTierId) {
      const tier = tiers.get(action.governanceTierId);
      if (!tier || tier.projectId !== action.projectId) {
        errors.push(`Action ${action.id} references invalid Governance Tier ${action.governanceTierId}.`);
      }
    }
    if (action.gateId) {
      const gate = gateIds.get(action.gateId);
      if (!gate || gate.projectId !== action.projectId) {
        errors.push(`Action ${action.id} references invalid Gate ${action.gateId}.`);
      }
    }
    for (const reference of action.gateDecisionReferences) {
      if (!gateIds.has(reference.gateId)) {
        errors.push(`Action ${action.id} has an invalid protected Gate reference ${reference.gateId}.`);
      }
    }
  }

  for (const project of projects) {
    const projectActions = actions.filter((action) => action.projectId === project.id);
    uniqueScalar(projectActions.map((action) => action.sequence), `Action sequence in ${project.id}`, errors);
    const maximum = Math.max(0, ...projectActions.map((action) => action.sequence));
    const next = source.actionStore.nextSequenceByProject[project.id];
    if (!Number.isInteger(next) || next <= maximum) {
      errors.push(`Project ${project.id} Action counter must be greater than ${maximum}.`);
    }
  }
  for (const projectId of Object.keys(source.actionStore.nextSequenceByProject)) {
    if (!projectIds.has(projectId)) {
      errors.push(`Action counter references missing Project ${projectId}.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Operational source relationship validation failed:\n- ${errors.join("\n- ")}`);
  }

  return [
    {
      name: allowedMissingCriteria.size ? "raw-source-relationships" : "projected-source-relationships",
      status: "pass",
      details: allowedMissingCriteria.size
        ? `${allowedMissingCriteria.size} approved runtime-derived Criterion references were recognized.`
        : "All mutable operational references resolve.",
    },
  ];
}

export function countEntities(source) {
  const gates = [
    ...source.projects.flatMap((project) => project.gates),
    ...source.packages.flatMap((projectPackage) => projectPackage.gates),
  ];
  const cycles = gates.flatMap((gate) => gate.reviewCycles);
  const cycleApprovers = cycles.flatMap((cycle) => cycle.approvers);
  const frozenEvidence = cycles.map((cycle) => cycle.frozenEvidence);
  return {
    projects: source.projects.length,
    projectMemberships: 0,
    governanceTiers: source.projects.flatMap((project) => project.governanceTiers).length,
    packages: source.packages.length,
    projectGates: source.projects.flatMap((project) => project.gates).length,
    packageGates: source.packages.flatMap((projectPackage) => projectPackage.gates).length,
    gateCriteria: gates.flatMap((gate) => gate.criteria).length,
    configuredGateApprovers: gates.flatMap((gate) => gate.approvers).length,
    reviewCycles: cycles.length,
    reviewCycleApprovers: cycleApprovers.length,
    reviewResponses: cycleApprovers.filter((approver) => approver.response !== null).length,
    invitationAttempts: cycleApprovers.flatMap((approver) => approver.invitation?.attempts ?? []).length,
    deliverables: source.deliverables.length,
    deliverableCriteria: source.deliverables.flatMap((deliverable) => deliverable.criterionIds).length,
    actions: source.actionStore.actions.length,
    actionUpdates: source.actionStore.actions.flatMap((action) => action.updates).length,
    actionPackageLinks: source.actionStore.actions.flatMap((action) => action.packageIds).length,
    gateDecisionReferences: source.actionStore.actions.flatMap((action) => action.gateDecisionReferences).length,
    reviewReworkActions: cycles.flatMap((cycle) => cycle.relatedReworkActionIds).length,
    frozenCriteria: frozenEvidence.flatMap((evidence) => evidence.criteria).length,
    frozenDeliverables: frozenEvidence.flatMap((evidence) => evidence.deliverables).length,
    frozenAcceptedActions: frozenEvidence.flatMap((evidence) => evidence.acceptedActions).length,
    frozenDocuments: frozenEvidence.flatMap((evidence) => evidence.documents).length,
    frozenBaselines: frozenEvidence.flatMap((evidence) => evidence.baselines).length,
    legacyBackupActions: source.legacyActionBackup.length,
  };
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function logicalFingerprint(value) {
  return sha256(canonicalJson(value));
}

export function historicalEvidenceFingerprint(source) {
  const evidence = [
    ...source.projects.flatMap((project) => project.gates),
    ...source.packages.flatMap((projectPackage) => projectPackage.gates),
  ]
    .flatMap((gate) => gate.reviewCycles)
    .map((cycle) => ({
      id: cycle.id,
      schemaVersion: cycle.schemaVersion,
      project: cycle.project,
      package: cycle.package,
      gate: cycle.gate,
      submittedBy: cycle.submittedBy,
      frozenEvidence: cycle.frozenEvidence,
      approvers: cycle.approvers,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return logicalFingerprint(evidence);
}

export async function getSourceControlState() {
  const { stdout: commitOutput } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  const { stdout: statusOutput } = await execFileAsync("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ]);
  const entries = statusOutput
    .split("\0")
    .filter(Boolean)
    .map((entry) => ({ status: entry.slice(0, 2), file: entry.slice(3) }));
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(process.cwd(), entry.file);
    files.push({
      ...entry,
      sha256: existsSync(filePath) ? sha256(await readFile(filePath)) : null,
    });
  }
  return {
    commit: commitOutput.trim(),
    worktreeDirty: entries.length > 0,
    worktreeFingerprint: logicalFingerprint(files),
    changedPaths: files.map(({ status, file, sha256: fileSha256 }) => ({
      status,
      file,
      sha256: fileSha256,
    })),
  };
}

export async function writeMigrationReport(report, reportDirectory) {
  await mkdir(reportDirectory, { recursive: true });
  const timestamp = report.startedAt.replaceAll(":", "-").replaceAll(".", "-");
  const baseName = `${timestamp}-${report.mode}-${report.result}`;
  const jsonPath = path.join(reportDirectory, `${baseName}.json`);
  const markdownPath = path.join(reportDirectory, `${baseName}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdownReport(report), "utf8");
  return { jsonPath, markdownPath };
}

export function sanitizeError(error) {
  return safeErrorMessage(error)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/re_[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]");
}

async function projectRuntimeState(raw) {
  const [{ normalizeGates }, templates] = await Promise.all([
    import(pathToFileURL(path.join(process.cwd(), "src", "lib", "gates.ts")).href),
    import(pathToFileURL(path.join(process.cwd(), "src", "lib", "governance-templates.ts")).href),
  ]);
  const scalarChanges = [];
  const addedCriteria = [];

  const projects = raw.projects.map((project) => ({
    ...project,
    gates: projectGates(
      "project",
      project.id,
      project.gates,
      normalizeGates(project.id, project.gates, templates.getProjectGateTemplates(project.validationRequired)),
    ),
  }));
  const packages = raw.packages.map((projectPackage) => ({
    ...projectPackage,
    gates: projectGates(
      "package",
      projectPackage.id,
      projectPackage.gates,
      normalizeGates(projectPackage.id, projectPackage.gates, templates.packageGateTemplates),
    ),
  }));

  function projectGates(scope, scopeId, persistedGates, normalizedGates) {
    return normalizedGates.map((normalized) => {
      const persisted = persistedGates.find(
        (gate) => gate.id === normalized.id || gate.stageId === normalized.stageId,
      );
      if (!persisted) {
        throw new Error(`Runtime projection attempted to add unexpected Gate ${normalized.id}.`);
      }

      for (const field of ["id", "templateVersion", "name", "stageId", "status"]) {
        if (persisted[field] !== normalized[field]) {
          scalarChanges.push({
            gateId: normalized.id,
            field,
            from: persisted[field],
            to: normalized[field],
          });
        }
      }
      assertCanonicalEqual(
        normalized.approvers,
        persisted.approvers,
        `Runtime projection changed configured Approvers for Gate ${normalized.id}`,
      );
      assertCanonicalEqual(
        normalized.reviewCycles,
        persisted.reviewCycles,
        `Runtime projection changed historical Review Cycles for Gate ${normalized.id}`,
      );

      const persistedCriteria = new Map(persisted.criteria.map((criterion) => [criterion.id, criterion]));
      const normalizedCriteria = new Map(normalized.criteria.map((criterion) => [criterion.id, criterion]));
      for (const criterion of normalized.criteria) {
        const existing = persistedCriteria.get(criterion.id);
        if (!existing) {
          addedCriteria.push({ gateId: normalized.id, criterion });
        } else {
          assertCanonicalEqual(
            criterion,
            existing,
            `Runtime projection changed existing Criterion ${criterion.id}`,
          );
        }
      }
      for (const criterion of persisted.criteria) {
        if (!normalizedCriteria.has(criterion.id)) {
          throw new Error(`Runtime projection removed existing Criterion ${criterion.id}.`);
        }
      }

      return {
        ...normalized,
        reviewCycles: persisted.reviewCycles,
      };
    });
  }

  return {
    data: {
      projects,
      packages,
      deliverables: structuredClone(raw.deliverables),
      actionStore: structuredClone(raw.actionStore),
      legacyActionBackup: structuredClone(raw.legacyActionBackup),
    },
    changes: {
      scalarChanges: scalarChanges.sort(compareProjectionChanges),
      addedCriteria: addedCriteria.sort((left, right) =>
        left.criterion.id.localeCompare(right.criterion.id)),
    },
  };
}

async function verifyProjectionSourceFiles(manifest) {
  for (const source of [manifest.normalizer, manifest.templates]) {
    const contents = await readFile(path.join(process.cwd(), source.path));
    const actual = sha256(contents);
    if (actual !== source.sha256) {
      throw new Error(
        `Projection source checksum mismatch for ${source.path}. Expected ${source.sha256}; found ${actual}. Review and version any normalization change before importing.`,
      );
    }
  }
}

function validateProjectionManifest(manifest) {
  assertRecord(manifest, "projection manifest");
  positiveInteger(manifest.version, "projection manifest version");
  assertRecord(manifest.normalizer, "projection normalizer");
  assertRecord(manifest.templates, "projection templates");
  requiredString(manifest.normalizer.path, "projection normalizer path");
  requiredString(manifest.normalizer.sha256, "projection normalizer checksum");
  requiredString(manifest.templates.path, "projection templates path");
  requiredString(manifest.templates.sha256, "projection templates checksum");
  assertArray(manifest.scalarChanges, "projection scalarChanges");
  assertArray(manifest.addedCriteria, "projection addedCriteria");
}

function validateProject(project, location) {
  assertExactKeys(project, [
    "id", "projectNumber", "name", "description", "projectManager", "customer", "reportsTo",
    "siteLocation", "plannedStartDate", "plannedCompletionDate", "validationRequired", "currentStage",
    "governanceTiers", "gates", "createdAt", "updatedAt",
  ], location);
  for (const field of ["id", "projectNumber", "name", "projectManager", "customer", "reportsTo", "siteLocation"])
    requiredString(project[field], `${location}.${field}`);
  for (const field of ["description"]) stringValue(project[field], `${location}.${field}`);
  dateValue(project.plannedStartDate, `${location}.plannedStartDate`, true);
  dateValue(project.plannedCompletionDate, `${location}.plannedCompletionDate`, true);
  booleanValue(project.validationRequired, `${location}.validationRequired`);
  enumValue(project.currentStage, PROJECT_STAGES, `${location}.currentStage`);
  timestampValue(project.createdAt, `${location}.createdAt`);
  timestampValue(project.updatedAt, `${location}.updatedAt`);
  assertArray(project.governanceTiers, `${location}.governanceTiers`);
  project.governanceTiers.forEach((tier, index) => {
    assertExactKeys(tier, ["id", "sequence", "name", "description"], `${location}.governanceTiers[${index}]`);
    requiredString(tier.id, "Governance Tier ID");
    positiveInteger(tier.sequence, "Governance Tier sequence");
    requiredString(tier.name, "Governance Tier name");
    stringValue(tier.description, "Governance Tier description");
  });
  assertArray(project.gates, `${location}.gates`);
  project.gates.forEach((gate, index) => validateGate(gate, `${location}.gates[${index}]`, PROJECT_STAGES));
}

function validatePackage(projectPackage, location) {
  assertExactKeys(projectPackage, [
    "id", "projectId", "packageCode", "packageName", "description", "packageOwner", "executionModel",
    "currentStage", "gates", "status", "targetDeliveryDate", "createdAt", "updatedAt",
  ], location);
  for (const field of ["id", "projectId", "packageCode", "packageName", "packageOwner"])
    requiredString(projectPackage[field], `${location}.${field}`);
  stringValue(projectPackage.description, `${location}.description`);
  nullableEnum(projectPackage.executionModel, ["internal", "external"], `${location}.executionModel`);
  enumValue(projectPackage.currentStage, PACKAGE_STAGES, `${location}.currentStage`);
  enumValue(projectPackage.status, ["not_assessed", "green", "amber", "red"], `${location}.status`);
  dateValue(projectPackage.targetDeliveryDate, `${location}.targetDeliveryDate`, true);
  timestampValue(projectPackage.createdAt, `${location}.createdAt`);
  timestampValue(projectPackage.updatedAt, `${location}.updatedAt`);
  assertArray(projectPackage.gates, `${location}.gates`);
  projectPackage.gates.forEach((gate, index) =>
    validateGate(gate, `${location}.gates[${index}]`, PACKAGE_STAGES));
}

function validateGate(gate, location, stages) {
  assertExactKeys(gate, ["id", "templateVersion", "name", "stageId", "status", "approvers", "reviewCycles", "criteria"], location);
  requiredString(gate.id, `${location}.id`);
  positiveInteger(gate.templateVersion, `${location}.templateVersion`);
  requiredString(gate.name, `${location}.name`);
  enumValue(gate.stageId, stages, `${location}.stageId`);
  enumValue(gate.status, GATE_STATUSES, `${location}.status`);
  assertArray(gate.criteria, `${location}.criteria`);
  gate.criteria.forEach((criterion, index) => {
    const item = `${location}.criteria[${index}]`;
    assertExactKeys(criterion, ["id", "templateId", "description", "status"], item);
    requiredString(criterion.id, `${item}.id`);
    nullableString(criterion.templateId, `${item}.templateId`);
    requiredString(criterion.description, `${item}.description`);
    enumValue(criterion.status, CRITERION_STATUSES, `${item}.status`);
  });
  assertArray(gate.approvers, `${location}.approvers`);
  gate.approvers.forEach((approver, index) => validateApprover(approver, `${location}.approvers[${index}]`, false));
  assertArray(gate.reviewCycles, `${location}.reviewCycles`);
  gate.reviewCycles.forEach((cycle, index) => validateReviewCycle(cycle, `${location}.reviewCycles[${index}]`));
}

function validateApprover(approver, location, snapshot) {
  assertExactKeys(
    approver,
    snapshot
      ? ["gateApproverId", "name", "email", "roleFunction", "approvalRole", "approvalLevel", "response", "invitation"]
      : ["id", "name", "email", "roleFunction", "approvalRole", "approvalLevel"],
    location,
  );
  requiredString(approver[snapshot ? "gateApproverId" : "id"], `${location}.id`);
  for (const field of ["name", "email", "roleFunction", "approvalRole"])
    requiredString(approver[field], `${location}.${field}`);
  positiveInteger(approver.approvalLevel, `${location}.approvalLevel`);
  if (!snapshot) return;
  if (approver.response !== null) validateResponse(approver.response, `${location}.response`);
  if (approver.invitation !== null) validateInvitation(approver.invitation, `${location}.invitation`);
}

function validateReviewCycle(cycle, location) {
  assertExactKeys(cycle, [
    "schemaVersion", "id", "cycleNumber", "previousCycleId", "project", "package", "gate", "status",
    "submittedAt", "submittedBy", "decision", "decisionComments", "completedAt", "withdrawnAt", "withdrawnBy",
    "withdrawalReason", "frozenEvidence", "approvers", "relatedReworkActionIds",
  ], location);
  positiveInteger(cycle.schemaVersion, `${location}.schemaVersion`);
  requiredString(cycle.id, `${location}.id`);
  positiveInteger(cycle.cycleNumber, `${location}.cycleNumber`);
  nullableString(cycle.previousCycleId, `${location}.previousCycleId`);
  validateSnapshot(cycle.project, ["id", "projectNumber", "name"], `${location}.project`);
  if (cycle.package !== null) validateSnapshot(cycle.package, ["id", "packageCode", "name"], `${location}.package`);
  validateSnapshot(cycle.gate, ["id", "name", "stageId", "stageLabel"], `${location}.gate`);
  enumValue(cycle.status, REVIEW_STATUSES, `${location}.status`);
  timestampValue(cycle.submittedAt, `${location}.submittedAt`);
  validateActor(cycle.submittedBy, `${location}.submittedBy`, true);
  nullableEnum(cycle.decision, DECISIONS, `${location}.decision`);
  stringValue(cycle.decisionComments, `${location}.decisionComments`);
  nullableTimestamp(cycle.completedAt, `${location}.completedAt`);
  nullableTimestamp(cycle.withdrawnAt, `${location}.withdrawnAt`);
  if (cycle.withdrawnBy !== null) validateActor(cycle.withdrawnBy, `${location}.withdrawnBy`, true);
  nullableString(cycle.withdrawalReason, `${location}.withdrawalReason`);
  validateFrozenEvidence(cycle.frozenEvidence, `${location}.frozenEvidence`);
  assertArray(cycle.approvers, `${location}.approvers`);
  cycle.approvers.forEach((approver, index) =>
    validateApprover(approver, `${location}.approvers[${index}]`, true));
  stringArray(cycle.relatedReworkActionIds, `${location}.relatedReworkActionIds`);
}

function validateFrozenEvidence(evidence, location) {
  assertExactKeys(evidence, ["frozenAt", "criteria", "deliverables", "acceptedActions", "documents", "baselines"], location);
  timestampValue(evidence.frozenAt, `${location}.frozenAt`);
  for (const field of ["criteria", "deliverables", "acceptedActions", "documents", "baselines"])
    assertArray(evidence[field], `${location}.${field}`);
  evidence.criteria.forEach((item, index) => {
    const itemLocation = `${location}.criteria[${index}]`;
    assertExactKeys(item, ["criterionId", "templateId", "description", "status"], itemLocation);
    requiredString(item.criterionId, `${itemLocation}.criterionId`);
    nullableString(item.templateId, `${itemLocation}.templateId`);
    requiredString(item.description, `${itemLocation}.description`);
    enumValue(item.status, [...CRITERION_STATUSES, "satisfied"], `${itemLocation}.status`);
  });
  evidence.deliverables.forEach((item, index) => {
    const itemLocation = `${location}.deliverables[${index}]`;
    assertExactKeys(item, ["deliverableId", "templateId", "templateVersion", "title", "description", "status", "criterionIds"], itemLocation);
    requiredString(item.deliverableId, `${itemLocation}.deliverableId`);
    nullableString(item.templateId, `${itemLocation}.templateId`);
    nullablePositiveInteger(item.templateVersion, `${itemLocation}.templateVersion`);
    requiredString(item.title, `${itemLocation}.title`);
    stringValue(item.description, `${itemLocation}.description`);
    enumValue(item.status, DELIVERABLE_STATUSES, `${itemLocation}.status`);
    stringArray(item.criterionIds, `${itemLocation}.criterionIds`);
  });
  evidence.acceptedActions.forEach((item, index) => {
    const itemLocation = `${location}.acceptedActions[${index}]`;
    assertExactKeys(item, ["actionId", "sequence", "description", "assignee", "dueDate", "status", "priority", "packageIds"], itemLocation);
    requiredString(item.actionId, `${itemLocation}.actionId`);
    positiveInteger(item.sequence, `${itemLocation}.sequence`);
    requiredString(item.description, `${itemLocation}.description`);
    requiredString(item.assignee, `${itemLocation}.assignee`);
    nullableDate(item.dueDate, `${itemLocation}.dueDate`);
    enumValue(item.status, ACTION_STATUSES, `${itemLocation}.status`);
    nullableEnum(item.priority, ACTION_PRIORITIES, `${itemLocation}.priority`);
    stringArray(item.packageIds, `${itemLocation}.packageIds`);
  });
  evidence.documents.forEach((item, index) => {
    const itemLocation = `${location}.documents[${index}]`;
    assertExactKeys(item, ["documentId", "title", "engineeringRevision", "repositoryItemId", "repositoryVersion", "repositoryUrl"], itemLocation);
    requiredString(item.documentId, `${itemLocation}.documentId`);
    requiredString(item.title, `${itemLocation}.title`);
    for (const field of ["engineeringRevision", "repositoryItemId", "repositoryVersion", "repositoryUrl"])
      nullableString(item[field], `${itemLocation}.${field}`);
  });
  evidence.baselines.forEach((item, index) => {
    const itemLocation = `${location}.baselines[${index}]`;
    assertExactKeys(item, ["baselineId", "type", "name", "revision"], itemLocation);
    requiredString(item.baselineId, `${itemLocation}.baselineId`);
    enumValue(item.type, ["scope", "cost", "schedule", "other"], `${itemLocation}.type`);
    requiredString(item.name, `${itemLocation}.name`);
    nullableString(item.revision, `${itemLocation}.revision`);
  });
}

function validateResponse(response, location) {
  assertExactKeys(response, ["outcome", "respondedAt", "respondedBy", "comment"], location);
  enumValue(response.outcome, RESPONSE_OUTCOMES, `${location}.outcome`);
  timestampValue(response.respondedAt, `${location}.respondedAt`);
  validateActor(response.respondedBy, `${location}.respondedBy`, true);
  stringValue(response.comment, `${location}.comment`);
}

function validateInvitation(invitation, location) {
  assertExactKeys(invitation, ["activatedAt", "attempts"], location);
  timestampValue(invitation.activatedAt, `${location}.activatedAt`);
  assertArray(invitation.attempts, `${location}.attempts`);
  invitation.attempts.forEach((attempt, index) => {
    const item = `${location}.attempts[${index}]`;
    assertExactKeys(attempt, ["id", "idempotencyKey", "provider", "status", "attemptedAt", "completedAt", "providerMessageId", "error"], item);
    for (const field of ["id", "idempotencyKey", "provider"])
      requiredString(attempt[field], `${item}.${field}`);
    enumValue(attempt.status, INVITATION_STATUSES, `${item}.status`);
    timestampValue(attempt.attemptedAt, `${item}.attemptedAt`);
    nullableTimestamp(attempt.completedAt, `${item}.completedAt`);
    nullableString(attempt.providerMessageId, `${item}.providerMessageId`);
    if (attempt.error !== null) {
      assertExactKeys(attempt.error, ["code", "message"], `${item}.error`);
      requiredString(attempt.error.code, `${item}.error.code`);
      requiredString(attempt.error.message, `${item}.error.message`);
    }
  });
}

function validateDeliverable(deliverable, location) {
  assertExactKeys(deliverable, [
    "id", "templateId", "templateVersion", "projectId", "packageId", "gateId", "criterionIds", "title",
    "description", "status", "stageId", "scopeLevel", "createdAt", "updatedAt",
  ], location);
  for (const field of ["id", "projectId", "gateId", "title", "stageId"])
    requiredString(deliverable[field], `${location}.${field}`);
  nullableString(deliverable.templateId, `${location}.templateId`);
  nullablePositiveInteger(deliverable.templateVersion, `${location}.templateVersion`);
  nullableString(deliverable.packageId, `${location}.packageId`);
  stringArray(deliverable.criterionIds, `${location}.criterionIds`);
  stringValue(deliverable.description, `${location}.description`);
  enumValue(deliverable.status, DELIVERABLE_STATUSES, `${location}.status`);
  enumValue(deliverable.scopeLevel, ["project", "package"], `${location}.scopeLevel`);
  timestampValue(deliverable.createdAt, `${location}.createdAt`);
  timestampValue(deliverable.updatedAt, `${location}.updatedAt`);
}

function validateAction(action, location) {
  assertExactKeys(action, [
    "id", "projectId", "sequence", "description", "assignee", "dueDate", "status", "priority", "packageIds",
    "governanceTierId", "gateId", "source", "packageAssociationLocked", "loggedBy", "dateLogged", "closingDate",
    "lastUpdated", "updates", "gateDecisionReferences",
  ], location);
  for (const field of ["id", "projectId", "description", "assignee"])
    requiredString(action[field], `${location}.${field}`);
  positiveInteger(action.sequence, `${location}.sequence`);
  nullableDate(action.dueDate, `${location}.dueDate`);
  enumValue(action.status, ACTION_STATUSES, `${location}.status`);
  nullableEnum(action.priority, ACTION_PRIORITIES, `${location}.priority`);
  stringArray(action.packageIds, `${location}.packageIds`);
  nullableString(action.governanceTierId, `${location}.governanceTierId`);
  nullableString(action.gateId, `${location}.gateId`);
  enumValue(action.source, ACTION_SOURCES, `${location}.source`);
  booleanValue(action.packageAssociationLocked, `${location}.packageAssociationLocked`);
  validateActor(action.loggedBy, `${location}.loggedBy`, false);
  timestampValue(action.dateLogged, `${location}.dateLogged`);
  nullableTimestamp(action.closingDate, `${location}.closingDate`);
  timestampValue(action.lastUpdated, `${location}.lastUpdated`);
  assertArray(action.updates, `${location}.updates`);
  action.updates.forEach((update, index) => {
    const item = `${location}.updates[${index}]`;
    assertExactKeys(update, ["id", "occurredAt", "actor", "kind", "text", "changes"], item);
    requiredString(update.id, `${item}.id`);
    timestampValue(update.occurredAt, `${item}.occurredAt`);
    validateActor(update.actor, `${item}.actor`, false);
    enumValue(update.kind, ["comment", "change"], `${item}.kind`);
    stringValue(update.text, `${item}.text`);
    assertArray(update.changes, `${item}.changes`);
    update.changes.forEach((change, changeIndex) => {
      const changeLocation = `${item}.changes[${changeIndex}]`;
      assertExactKeys(change, ["field", "from", "to"], changeLocation);
      requiredString(change.field, `${changeLocation}.field`);
      changeValue(change.from, `${changeLocation}.from`);
      changeValue(change.to, `${changeLocation}.to`);
    });
  });
  assertArray(action.gateDecisionReferences, `${location}.gateDecisionReferences`);
  action.gateDecisionReferences.forEach((reference, index) => {
    const item = `${location}.gateDecisionReferences[${index}]`;
    assertExactKeys(reference, ["id", "gateId", "decision", "recordedAt"], item);
    requiredString(reference.id, `${item}.id`);
    requiredString(reference.gateId, `${item}.gateId`);
    enumValue(reference.decision, PROTECTED_DECISIONS, `${item}.decision`);
    timestampValue(reference.recordedAt, `${item}.recordedAt`);
  });
}

function validateLegacyAction(action, location) {
  assertExactKeys(action, [
    "id", "projectId", "sequence", "description", "owner", "dueDate", "status", "packageIds",
    "gateId", "source", "comments", "createdAt", "updatedAt",
  ], location);
  for (const field of ["id", "projectId", "description", "owner", "status", "source", "createdAt", "updatedAt"])
    requiredString(action[field], `${location}.${field}`);
  positiveInteger(action.sequence, `${location}.sequence`);
  nullableDate(action.dueDate, `${location}.dueDate`);
  nullableString(action.gateId, `${location}.gateId`);
  stringArray(action.packageIds, `${location}.packageIds`);
  stringValue(action.comments, `${location}.comments`);
}

function validateActor(actor, location, withEmail) {
  assertExactKeys(actor, withEmail ? ["userId", "displayName", "email"] : ["userId", "displayName"], location);
  nullableString(actor.userId, `${location}.userId`);
  requiredString(actor.displayName, `${location}.displayName`);
  if (withEmail) nullableString(actor.email, `${location}.email`);
}

function validateSnapshot(value, keys, location) {
  assertExactKeys(value, keys, location);
  for (const key of keys) requiredString(value[key], `${location}.${key}`);
}

function renderMarkdownReport(report) {
  const lines = [
    "# Operational Data Migration Report",
    "",
    `- Result: **${report.result.toUpperCase()}**`,
    `- Mode: \`${report.mode}\``,
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    `- Source commit: \`${report.sourceControl?.commit ?? "unavailable"}\``,
    `- Dirty worktree: ${report.sourceControl?.worktreeDirty ? "yes" : "no"}`,
    `- Logical fingerprint: \`${report.logicalFingerprint ?? "not generated"}\``,
    "",
    "## Source Files",
    "",
    "| File | Bytes | SHA-256 |",
    "|---|---:|---|",
    ...(report.sourceFiles ?? []).map((file) => `| ${file.name} | ${file.bytes} | \`${file.sha256}\` |`),
    "",
    "## Counts",
    "",
    "| Entity | Raw | Projected | Imported |",
    "|---|---:|---:|---:|",
    ...Object.keys(report.projectedCounts ?? report.rawCounts ?? {}).map((key) =>
      `| ${key} | ${report.rawCounts?.[key] ?? 0} | ${report.projectedCounts?.[key] ?? 0} | ${report.importedCounts?.[key] ?? "n/a"} |`),
    "",
    "## Validation",
    "",
    ...(report.validations ?? []).map((item) =>
      `- **${item.status.toUpperCase()}** ${item.name}${item.details ? `: ${item.details}` : ""}`),
  ];
  if (report.projection) {
    lines.push(
      "",
      "## Runtime Projection",
      "",
      `- Added Criteria: ${report.projection.summary.addedCriteria}`,
      `- Template-version updates: ${report.projection.summary.templateVersionUpdates}`,
      `- Legacy-name updates: ${report.projection.summary.legacyNameUpdates}`,
      "",
      "### Derived Metadata",
      "",
      ...report.projection.changes.scalarChanges.map((change) =>
        `- \`${change.gateId}\` ${change.field}: \`${String(change.from)}\` -> \`${String(change.to)}\``),
      "",
      "### Derived Criteria",
      "",
      ...report.projection.changes.addedCriteria.map((change) =>
        `- \`${change.criterion.id}\` (${change.criterion.status})`),
    );
  }
  if (report.error) lines.push("", "## Error", "", report.error);
  return `${lines.join("\n")}\n`;
}

function compareProjectionChanges(left, right) {
  return `${left.gateId}:${left.field}`.localeCompare(`${right.gateId}:${right.field}`);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertCanonicalEqual(actual, expected, message) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(message);
  }
}

function uniqueIndex(items, key, label, errors) {
  const result = new Map();
  for (const item of items) {
    const value = item[key];
    if (result.has(value)) errors.push(`Duplicate ${label} ID ${value}.`);
    result.set(value, item);
  }
  return result;
}

function uniqueScalar(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function assertExactKeys(value, keys, location) {
  assertRecord(value, location);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${location} has unexpected fields. Expected ${expected.join(", ")}; found ${actual.join(", ")}.`);
  }
}

function assertRecord(value, location) {
  assertValue(value !== null && typeof value === "object" && !Array.isArray(value), `${location} must be an object.`);
}

function assertArray(value, location) {
  assertValue(Array.isArray(value), `${location} must be an array.`);
}

function requiredString(value, location) {
  assertValue(typeof value === "string" && value.trim() !== "", `${location} must be a non-empty string.`);
}

function stringValue(value, location) {
  assertValue(typeof value === "string", `${location} must be a string.`);
}

function nullableString(value, location) {
  assertValue(value === null || typeof value === "string", `${location} must be a string or null.`);
}

function booleanValue(value, location) {
  assertValue(typeof value === "boolean", `${location} must be a boolean.`);
}

function positiveInteger(value, location) {
  assertValue(Number.isInteger(value) && value > 0, `${location} must be a positive integer.`);
}

function nullablePositiveInteger(value, location) {
  assertValue(value === null || (Number.isInteger(value) && value > 0), `${location} must be a positive integer or null.`);
}

function enumValue(value, choices, location) {
  assertValue(choices.includes(value), `${location} must be one of: ${choices.join(", ")}.`);
}

function nullableEnum(value, choices, location) {
  assertValue(value === null || choices.includes(value), `${location} must be null or one of: ${choices.join(", ")}.`);
}

function dateValue(value, location, allowEmpty = false) {
  if (allowEmpty && value === "") return;
  assertValue(/^\d{4}-\d{2}-\d{2}$/.test(value), `${location} must be an ISO date${allowEmpty ? " or empty" : ""}.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assertValue(!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, `${location} is not a valid date.`);
}

function nullableDate(value, location) {
  if (value === null) return;
  dateValue(value, location);
}

function timestampValue(value, location) {
  assertValue(typeof value === "string" && !Number.isNaN(Date.parse(value)), `${location} must be an ISO timestamp.`);
}

function nullableTimestamp(value, location) {
  if (value === null) return;
  timestampValue(value, location);
}

function stringArray(value, location) {
  assertArray(value, location);
  assertValue(value.every((item) => typeof item === "string"), `${location} must contain only strings.`);
}

function changeValue(value, location) {
  assertValue(
    value === null || typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string")),
    `${location} must be a string, string array, or null.`,
  );
}

function assertValue(condition, message) {
  if (!condition) throw new Error(message);
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown error";
}
