import {
  mkdir,
  link,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const projectActionStatuses = [
  "new",
  "in_progress",
  "finished",
  "closed",
] as const;

export type ProjectActionStatus = (typeof projectActionStatuses)[number];

export const projectActionStatusLabels: Record<ProjectActionStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  finished: "Finished",
  closed: "Closed",
};
export type ReopenedProjectActionStatus = Extract<
  ProjectActionStatus,
  "new" | "in_progress"
>;

export const projectActionPriorities = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type ProjectActionPriority = (typeof projectActionPriorities)[number];

export const projectActionPriorityLabels: Record<ProjectActionPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const projectActionSources = [
  "manual",
  "gate",
  "meeting",
  "risk",
  "issue",
  "change_moc",
  "decision",
] as const;

export type ProjectActionSource = (typeof projectActionSources)[number];

export const projectActionSourceLabels: Record<ProjectActionSource, string> = {
  manual: "Manual",
  gate: "Gate",
  meeting: "Meeting",
  risk: "Risk",
  issue: "Issue",
  change_moc: "Change / MOC",
  decision: "Decision",
};

export const gateDecisionValues = [
  "approved",
  "approved_with_actions",
  "rejected_rework",
] as const;

export type ProtectedGateDecision = (typeof gateDecisionValues)[number];

export type ActionActor = {
  userId: string | null;
  displayName: string;
};

export type ProjectActionChange = {
  field: string;
  from: string | string[] | null;
  to: string | string[] | null;
};

export type ProjectActionUpdate = {
  id: string;
  occurredAt: string;
  actor: ActionActor;
  kind: "comment" | "change";
  text: string;
  changes: ProjectActionChange[];
};

export type GateDecisionReference = {
  id: string;
  gateId: string;
  decision: ProtectedGateDecision;
  recordedAt: string;
};

export type ProjectAction = {
  id: string;
  projectId: string;
  sequence: number;
  description: string;
  assignee: string;
  dueDate: string | null;
  status: ProjectActionStatus;
  priority: ProjectActionPriority | null;
  packageIds: string[];
  governanceTierId: string | null;
  gateId: string | null;
  source: ProjectActionSource;
  packageAssociationLocked: boolean;
  loggedBy: ActionActor;
  dateLogged: string;
  closingDate: string | null;
  lastUpdated: string;
  updates: ProjectActionUpdate[];
  gateDecisionReferences: GateDecisionReference[];
};

type ActionStoreV2 = {
  schemaVersion: 2;
  nextSequenceByProject: Record<string, number>;
  actions: ProjectAction[];
};

type LegacyProjectAction = {
  projectId?: unknown;
  sequence?: unknown;
};

export type ProjectActionInput = {
  description: string;
  assignee: string;
  dueDate: string | null;
  status: ProjectActionStatus;
  priority: ProjectActionPriority | null;
  packageIds: string[];
  governanceTierId: string | null;
  gateId: string | null;
  initialUpdate: string | null;
};

export type GateProjectActionInput = {
  description: string;
  assignee: string;
  dueDate: string | null;
  priority: ProjectActionPriority | null;
  initialUpdate: string | null;
};

export type ProjectActionDeletionResult =
  | { deleted: true }
  | { deleted: false; reason: string };

export type GateActionProtectionResult =
  | {
      outcome: "protected";
      actions: ProjectAction[];
      referenceIds: string[];
    }
  | { outcome: "accepted_actions_missing" };

const dataDirectory = path.join(process.cwd(), ".data");
const actionsFile = path.join(dataDirectory, "actions.json");
const legacyBackupFile = path.join(dataDirectory, "actions.schema-v1.backup.json");
const actionStoreLockFile = path.join(dataDirectory, "actions.lock");
const gateWorkflowLockFile = path.join(dataDirectory, "gate-workflow.lock");
const governanceTierWorkflowLockFile = path.join(
  dataDirectory,
  "governance-tier-workflow.lock",
);

let mutationQueue: Promise<unknown> = Promise.resolve();
let gateWorkflowQueue: Promise<unknown> = Promise.resolve();
let governanceTierWorkflowQueue: Promise<unknown> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyStore(): ActionStoreV2 {
  return {
    schemaVersion: 2,
    nextSequenceByProject: {},
    actions: [],
  };
}

async function writeStore(store: ActionStoreV2) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${actionsFile}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryFile, actionsFile);
  } finally {
    await unlink(temporaryFile).catch(() => undefined);
  }
}

function getLegacyCounters(value: unknown[]): Record<string, number> {
  const nextSequenceByProject: Record<string, number> = {};

  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error("The legacy Action Register contains an invalid record.");
    }

    const action = item as LegacyProjectAction;
    if (
      typeof action.projectId !== "string" ||
      typeof action.sequence !== "number" ||
      !Number.isInteger(action.sequence) ||
      action.sequence < 1
    ) {
      throw new Error("The legacy Action Register contains an invalid sequence.");
    }

    nextSequenceByProject[action.projectId] = Math.max(
      nextSequenceByProject[action.projectId] ?? 1,
      action.sequence + 1,
    );
  }

  return nextSequenceByProject;
}

async function migrateLegacyStore(raw: string, value: unknown[]) {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await writeFile(legacyBackupFile, raw, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const uniqueBackupFile = path.join(
        dataDirectory,
        `actions.schema-v1.${Date.now()}.${randomUUID()}.backup.json`,
      );
      await writeFile(uniqueBackupFile, raw, { encoding: "utf8", flag: "wx" });
    } else {
      throw error;
    }
  }

  const store: ActionStoreV2 = {
    schemaVersion: 2,
    nextSequenceByProject: getLegacyCounters(value),
    actions: [],
  };
  await writeStore(store);
  return store;
}

function parseStore(value: unknown): ActionStoreV2 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !isRecord(value.nextSequenceByProject) ||
    !Array.isArray(value.actions)
  ) {
    throw new Error("The Action Register data file has an unsupported format.");
  }

  const store = value as ActionStoreV2;
  const maximumSequenceByProject: Record<string, number> = {};
  const sequences = new Set<string>();

  for (const action of store.actions) {
    if (
      !isRecord(action) ||
      typeof action.id !== "string" ||
      typeof action.projectId !== "string" ||
      typeof action.sequence !== "number" ||
      !Number.isInteger(action.sequence) ||
      action.sequence < 1 ||
      typeof action.description !== "string" ||
      typeof action.assignee !== "string" ||
      !(typeof action.dueDate === "string" || action.dueDate === null) ||
      !projectActionStatuses.includes(action.status) ||
      !(
        action.priority === null ||
        projectActionPriorities.includes(action.priority)
      ) ||
      !isStringArray(action.packageIds) ||
      !(
        typeof action.governanceTierId === "string" ||
        action.governanceTierId === null
      ) ||
      !(typeof action.gateId === "string" || action.gateId === null) ||
      !projectActionSources.includes(action.source) ||
      typeof action.packageAssociationLocked !== "boolean" ||
      !isActionActor(action.loggedBy) ||
      typeof action.dateLogged !== "string" ||
      !(typeof action.closingDate === "string" || action.closingDate === null) ||
      typeof action.lastUpdated !== "string" ||
      !Array.isArray(action.updates) ||
      !action.updates.every(isActionUpdate) ||
      !Array.isArray(action.gateDecisionReferences) ||
      !action.gateDecisionReferences.every(isGateDecisionReference)
    ) {
      throw new Error("The Action Register contains an invalid Action record.");
    }

    const sequenceKey = `${action.projectId}:${action.sequence}`;
    if (sequences.has(sequenceKey)) {
      throw new Error("The Action Register contains a duplicate Action ID.");
    }
    sequences.add(sequenceKey);
    maximumSequenceByProject[action.projectId] = Math.max(
      maximumSequenceByProject[action.projectId] ?? 0,
      action.sequence,
    );
  }

  for (const [projectId, nextSequence] of Object.entries(
    store.nextSequenceByProject,
  )) {
    if (!Number.isInteger(nextSequence) || nextSequence < 1) {
      throw new Error(`The Action sequence for Project ${projectId} is invalid.`);
    }
  }

  for (const [projectId, maximumSequence] of Object.entries(
    maximumSequenceByProject,
  )) {
    if ((store.nextSequenceByProject[projectId] ?? 0) <= maximumSequence) {
      throw new Error(`The Action sequence for Project ${projectId} would reuse an ID.`);
    }
  }

  return store;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isActionActor(value: unknown): value is ActionActor {
  return Boolean(
    isRecord(value) &&
      (value.userId === null || typeof value.userId === "string") &&
      typeof value.displayName === "string",
  );
}

function isActionChange(value: unknown): value is ProjectActionChange {
  if (!isRecord(value) || typeof value.field !== "string") return false;
  return [value.from, value.to].every(
    (item) => item === null || typeof item === "string" || isStringArray(item),
  );
}

function isActionUpdate(value: unknown): value is ProjectActionUpdate {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.occurredAt === "string" &&
      isActionActor(value.actor) &&
      (value.kind === "comment" || value.kind === "change") &&
      typeof value.text === "string" &&
      Array.isArray(value.changes) &&
      value.changes.every(isActionChange),
  );
}

function isGateDecisionReference(value: unknown): value is GateDecisionReference {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.gateId === "string" &&
      gateDecisionValues.includes(value.decision as ProtectedGateDecision) &&
      typeof value.recordedAt === "string",
  );
}

async function readStore(lockHeld = false): Promise<ActionStoreV2> {
  await mkdir(dataDirectory, { recursive: true });

  let raw: string;
  try {
    raw = await readFile(actionsFile, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      if (!lockHeld) {
        return withFileLock(actionStoreLockFile, () => readStore(true));
      }
      const store = emptyStore();
      await writeStore(store);
      return store;
    }
    throw error;
  }

  const value: unknown = JSON.parse(raw);
  if (Array.isArray(value)) {
    if (!lockHeld) {
      return withFileLock(actionStoreLockFile, () => readStore(true));
    }
    return migrateLegacyStore(raw, value);
  }

  return parseStore(value);
}

async function withStoreMutation<T>(
  mutation: (store: ActionStoreV2) => Promise<T> | T,
): Promise<T> {
  const operation = mutationQueue.then(() =>
    withFileLock(actionStoreLockFile, async () => {
      const store = await readStore(true);
      return mutation(store);
    }),
  );
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

async function withFileLock<T>(lockFile: string, operation: () => Promise<T>) {
  await mkdir(dataDirectory, { recursive: true });
  const token = randomUUID();
  const ownerContents = JSON.stringify({ pid: process.pid, token });
  const ownerFile = `${lockFile}.${process.pid}.${token}.owner`;
  await writeFile(ownerFile, ownerContents, { encoding: "utf8", flag: "wx" });
  let acquired = false;

  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        // The hard link makes complete owner metadata visible atomically.
        await link(ownerFile, lockFile);
        acquired = true;
        break;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw error;
        }

        const lockContents = await readFile(lockFile, "utf8").catch(() => "");
        let ownerPid: number | null = null;
        try {
          const lockOwner: unknown = JSON.parse(lockContents);
          if (isRecord(lockOwner) && typeof lockOwner.pid === "number") {
            ownerPid = lockOwner.pid;
          }
        } catch {
          // Invalid legacy locks are recovered below after a conservative delay.
        }

        const invalidLockStat = ownerPid === null
          ? await stat(lockFile).catch(() => null)
          : null;
        const canRecover = ownerPid !== null
          ? !isProcessRunning(ownerPid)
          : Boolean(invalidLockStat && Date.now() - invalidLockStat.mtimeMs > 30_000);

        if (canRecover) {
          const currentContents = await readFile(lockFile, "utf8").catch(() => null);
          if (currentContents === lockContents) {
            await unlink(lockFile).catch(() => undefined);
          }
        }
        await delay(10);
      }
    }

    if (!acquired) {
      throw new Error("The Action Register is busy. Try again.");
    }
    return await operation();
  } finally {
    if (acquired) {
      const currentContents = await readFile(lockFile, "utf8").catch(() => null);
      if (currentContents === ownerContents) {
        await unlink(lockFile).catch(() => undefined);
      }
    }
    await unlink(ownerFile).catch(() => undefined);
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

export async function withGateWorkflowLock<T>(operation: () => Promise<T>) {
  const queued = gateWorkflowQueue.then(() =>
    withFileLock(gateWorkflowLockFile, operation),
  );
  gateWorkflowQueue = queued.catch(() => undefined);
  return queued;
}

export async function withGovernanceTierWorkflowLock<T>(
  operation: () => Promise<T>,
) {
  const queued = governanceTierWorkflowQueue.then(() =>
    withFileLock(governanceTierWorkflowLockFile, operation),
  );
  governanceTierWorkflowQueue = queued.catch(() => undefined);
  return queued;
}

function actor(displayName: string): ActionActor {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error("Enter the name of the person making this update.");
  }
  return { userId: null, displayName: normalized };
}

function actionUpdate(
  updateActor: ActionActor,
  occurredAt: string,
  kind: ProjectActionUpdate["kind"],
  text: string,
  changes: ProjectActionChange[] = [],
): ProjectActionUpdate {
  return {
    id: randomUUID(),
    occurredAt,
    actor: updateActor,
    kind,
    text,
    changes,
  };
}

function normalizeOptional(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parsePriority(value: FormDataEntryValue | null) {
  const normalized = normalizeOptional(value);
  if (!normalized) return null;
  if (!projectActionPriorities.includes(normalized as ProjectActionPriority)) {
    throw new Error("Select a valid priority.");
  }
  return normalized as ProjectActionPriority;
}

function parseDate(value: FormDataEntryValue | null) {
  const normalized = normalizeOptional(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new Error("Enter a valid due date.");
  }
  return normalized;
}

function parseStatus(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "new");
  if (!projectActionStatuses.includes(normalized as ProjectActionStatus)) {
    throw new Error("Select a valid status.");
  }
  return normalized as ProjectActionStatus;
}

function parsePackageIds(formData: FormData, validPackageIds: string[]) {
  const scope = String(formData.get("scope") ?? "project");
  if (scope === "project") return [];
  if (scope !== "packages") {
    throw new Error("Select Project-level or Package(s) scope.");
  }

  const selected = Array.from(
    new Set(formData.getAll("packageIds").map((value) => String(value))),
  );
  if (selected.length === 0) {
    throw new Error("Select at least one Package for Package scope.");
  }
  if (selected.some((id) => !validPackageIds.includes(id))) {
    throw new Error("One or more selected Packages are invalid.");
  }
  return selected;
}

export function parseProjectActionFormData(
  formData: FormData,
  validPackageIds: string[],
  validGovernanceTierIds: string[],
): { input: ProjectActionInput; actor: ActionActor } {
  const description = String(formData.get("description") ?? "").trim();
  const assignee = String(formData.get("assignee") ?? "").trim();
  if (!description) throw new Error("Enter an Action description.");
  if (!assignee) throw new Error("Enter an assignee.");

  return {
    actor: actor(String(formData.get("actorName") ?? "")),
    input: {
      description,
      assignee,
      dueDate: parseDate(formData.get("dueDate")),
      status: parseStatus(formData.get("status")),
      priority: parsePriority(formData.get("priority")),
      packageIds: parsePackageIds(formData, validPackageIds),
      governanceTierId: parseGovernanceTierId(
        formData.get("governanceTierId"),
        validGovernanceTierIds,
      ),
      gateId: normalizeOptional(formData.get("gateId")),
      initialUpdate: normalizeOptional(formData.get("initialUpdate")),
    },
  };
}

function parseGovernanceTierId(
  value: FormDataEntryValue | null,
  validGovernanceTierIds: string[],
) {
  const governanceTierId = normalizeOptional(value);
  if (
    governanceTierId &&
    !validGovernanceTierIds.includes(governanceTierId)
  ) {
    throw new Error("The selected Governance Tier is invalid for this Project.");
  }
  return governanceTierId;
}

export function parseGateActionFormData(formData: FormData): {
  input: GateProjectActionInput;
  actor: ActionActor;
} {
  const description = String(formData.get("description") ?? "").trim();
  const assignee = String(formData.get("assignee") ?? "").trim();
  if (!description) throw new Error("Enter an Action description.");
  if (!assignee) throw new Error("Enter an assignee.");

  return {
    actor: actor(String(formData.get("actorName") ?? "")),
    input: {
      description,
      assignee,
      dueDate: parseDate(formData.get("dueDate")),
      priority: parsePriority(formData.get("priority")),
      initialUpdate: normalizeOptional(formData.get("initialUpdate")),
    },
  };
}

export function parseActionUpdateFormData(formData: FormData) {
  const text = String(formData.get("updateText") ?? "").trim();
  if (!text) throw new Error("Enter an update.");
  return {
    actor: actor(String(formData.get("actorName") ?? "")),
    text,
  };
}

export function parseActionTransitionFormData(formData: FormData) {
  return {
    actor: actor(String(formData.get("actorName") ?? "")),
    comment: normalizeOptional(formData.get("comment")),
  };
}

export function parseReopenStatus(formData: FormData): ReopenedProjectActionStatus {
  const status = String(formData.get("status") ?? "in_progress");
  if (status !== "new" && status !== "in_progress") {
    throw new Error("Reopen the Action as New or In Progress.");
  }
  return status;
}

export function formatActionId(sequence: number) {
  return `A-${String(sequence).padStart(3, "0")}`;
}

export const formatProjectActionId = formatActionId;

export function isProjectActionOpen(action: ProjectAction) {
  return action.status !== "closed";
}

export function isProjectActionOverdue(action: ProjectAction, today: string) {
  return Boolean(
    isProjectActionOpen(action) && action.dueDate && action.dueDate < today,
  );
}

export async function getProjectActions(projectId: string) {
  const store = await readStore();
  return store.actions
    .filter((action) => action.projectId === projectId)
    .sort((a, b) => a.sequence - b.sequence);
}

export async function getProjectAction(projectId: string, actionId: string) {
  const store = await readStore();
  return (
    store.actions.find(
      (action) => action.projectId === projectId && action.id === actionId,
    ) ?? null
  );
}

export async function hasActionsForPackage(projectId: string, packageId: string) {
  const actions = await getProjectActions(projectId);
  return actions.some((action) => action.packageIds.includes(packageId));
}

export async function getGovernanceTierActionReferences(
  projectId: string,
  governanceTierId: string,
) {
  const actions = await getProjectActions(projectId);
  const currentActionIds = actions
    .filter((action) => action.governanceTierId === governanceTierId)
    .map((action) => action.id);
  const historicalActionIds = actions
    .filter((action) =>
      action.updates.some((update) =>
        update.changes.some(
          (change) =>
            change.field === "governanceTierId" &&
            (change.from === governanceTierId || change.to === governanceTierId),
        ),
      ),
    )
    .map((action) => action.id);

  return {
    currentActionIds,
    historicalActionIds,
    hasReferences:
      currentActionIds.length > 0 || historicalActionIds.length > 0,
  };
}

export async function getProjectActionDeletionBlocker(projectId: string) {
  const actions = await getProjectActions(projectId);
  const protectedActions = actions.filter(
    (action) => action.gateDecisionReferences.length > 0,
  );
  if (protectedActions.length === 0) return null;
  return `${protectedActions.length} Gate Action${protectedActions.length === 1 ? " is" : "s are"} retained as finalized governance history. Delete those governance records only through a future controlled archival process.`;
}

export async function getGateActions(projectId: string, gateId: string) {
  const actions = await getProjectActions(projectId);
  return actions.filter(
    (action) => action.source === "gate" && action.gateId === gateId,
  );
}

export async function createManualProjectAction(
  projectId: string,
  input: ProjectActionInput,
  loggedBy: ActionActor,
) {
  if (input.status === "closed") {
    throw new Error("Create the Action before closing it.");
  }

  return withStoreMutation(async (store) => {
    const now = new Date().toISOString();
    const sequence = store.nextSequenceByProject[projectId] ?? 1;
    const updates = [
      actionUpdate(loggedBy, now, "change", "Action logged.", [
        { field: "status", from: null, to: input.status },
      ]),
    ];
    if (input.initialUpdate) {
      updates.push(
        actionUpdate(loggedBy, now, "comment", input.initialUpdate),
      );
    }

    const action: ProjectAction = {
      id: randomUUID(),
      projectId,
      sequence,
      description: input.description,
      assignee: input.assignee,
      dueDate: input.dueDate,
      status: input.status,
      priority: input.priority,
      packageIds: input.packageIds,
      governanceTierId: input.governanceTierId,
      gateId: input.gateId,
      source: "manual",
      packageAssociationLocked: false,
      loggedBy,
      dateLogged: now,
      closingDate: null,
      lastUpdated: now,
      updates,
      gateDecisionReferences: [],
    };

    store.actions.push(action);
    store.nextSequenceByProject[projectId] = sequence + 1;
    await writeStore(store);
    return action;
  });
}

export async function createGateProjectAction(
  projectId: string,
  gateId: string,
  packageIds: string[],
  packageAssociationLocked: boolean,
  input: GateProjectActionInput,
  loggedBy: ActionActor,
) {
  return withStoreMutation(async (store) => {
    const now = new Date().toISOString();
    const sequence = store.nextSequenceByProject[projectId] ?? 1;
    const updates = [
      actionUpdate(loggedBy, now, "change", "Gate Action logged.", [
        { field: "status", from: null, to: "new" },
      ]),
    ];
    if (input.initialUpdate) {
      updates.push(
        actionUpdate(loggedBy, now, "comment", input.initialUpdate),
      );
    }

    const action: ProjectAction = {
      id: randomUUID(),
      projectId,
      sequence,
      description: input.description,
      assignee: input.assignee,
      dueDate: input.dueDate,
      status: "new",
      priority: input.priority,
      packageIds,
      governanceTierId: null,
      gateId,
      source: "gate",
      packageAssociationLocked,
      loggedBy,
      dateLogged: now,
      closingDate: null,
      lastUpdated: now,
      updates,
      gateDecisionReferences: [],
    };

    store.actions.push(action);
    store.nextSequenceByProject[projectId] = sequence + 1;
    await writeStore(store);
    return action;
  });
}

function compareArrays(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export async function updateProjectAction(
  projectId: string,
  actionId: string,
  input: ProjectActionInput,
  updatedBy: ActionActor,
) {
  return withStoreMutation(async (store) => {
    const action = store.actions.find(
      (item) => item.projectId === projectId && item.id === actionId,
    );
    if (!action) throw new Error("Action not found.");
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
    const changes: ProjectActionChange[] = [];
    const addChange = (
      field: string,
      from: string | string[] | null,
      to: string | string[] | null,
    ) => {
      if (Array.isArray(from) && Array.isArray(to)) {
        if (!compareArrays(from, to)) changes.push({ field, from, to });
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
    action.description = input.description;
    action.assignee = input.assignee;
    action.dueDate = input.dueDate;
    action.status = input.status;
    action.priority = input.priority;
    action.packageIds = nextPackageIds;
    action.governanceTierId = input.governanceTierId;
    action.gateId = nextGateId;
    action.lastUpdated = now;
    if (changes.length > 0) {
      action.updates.push(
        actionUpdate(updatedBy, now, "change", "Action fields updated.", changes),
      );
    }
    if (input.initialUpdate) {
      action.updates.push(
        actionUpdate(updatedBy, now, "comment", input.initialUpdate),
      );
    }

    await writeStore(store);
    return action;
  });
}

export async function addProjectActionUpdate(
  projectId: string,
  actionId: string,
  text: string,
  updatedBy: ActionActor,
) {
  return withStoreMutation(async (store) => {
    const action = store.actions.find(
      (item) => item.projectId === projectId && item.id === actionId,
    );
    if (!action) throw new Error("Action not found.");
    const now = new Date().toISOString();
    action.updates.push(actionUpdate(updatedBy, now, "comment", text));
    action.lastUpdated = now;
    await writeStore(store);
    return action;
  });
}

export async function closeProjectAction(
  projectId: string,
  actionId: string,
  closedBy: ActionActor,
  comment: string | null,
) {
  return withStoreMutation(async (store) => {
    const action = store.actions.find(
      (item) => item.projectId === projectId && item.id === actionId,
    );
    if (!action) throw new Error("Action not found.");
    if (action.status === "closed") return action;

    const now = new Date().toISOString();
    action.updates.push(
      actionUpdate(closedBy, now, "change", "Action closed.", [
        { field: "status", from: action.status, to: "closed" },
        { field: "closingDate", from: action.closingDate, to: now },
      ]),
    );
    if (comment) {
      action.updates.push(actionUpdate(closedBy, now, "comment", comment));
    }
    action.status = "closed";
    action.closingDate = now;
    action.lastUpdated = now;
    await writeStore(store);
    return action;
  });
}

export async function reopenProjectAction(
  projectId: string,
  actionId: string,
  status: ReopenedProjectActionStatus,
  reopenedBy: ActionActor,
  comment: string | null,
) {
  return withStoreMutation(async (store) => {
    const action = store.actions.find(
      (item) => item.projectId === projectId && item.id === actionId,
    );
    if (!action) throw new Error("Action not found.");
    if (action.status !== "closed") {
      throw new Error("Only a Closed Action can be reopened.");
    }

    const now = new Date().toISOString();
    action.updates.push(
      actionUpdate(reopenedBy, now, "change", "Action reopened.", [
        { field: "status", from: "closed", to: status },
        { field: "closingDate", from: action.closingDate, to: null },
      ]),
    );
    if (comment) {
      action.updates.push(actionUpdate(reopenedBy, now, "comment", comment));
    }
    action.status = status;
    action.closingDate = null;
    action.lastUpdated = now;
    await writeStore(store);
    return action;
  });
}

export async function protectGateActionsForDecision(
  projectId: string,
  gateId: string,
  decision: Extract<ProtectedGateDecision, "approved_with_actions">,
  acceptedActionIds: string[],
): Promise<GateActionProtectionResult> {
  return withStoreMutation(async (store) => {
    const uniqueActionIds = [...new Set(acceptedActionIds)];
    const acceptedActionIdSet = new Set(uniqueActionIds);
    const matching = store.actions.filter(
      (action) =>
        action.projectId === projectId &&
        action.source === "gate" &&
        action.gateId === gateId &&
        acceptedActionIdSet.has(action.id),
    );
    if (matching.length !== uniqueActionIds.length) {
      return { outcome: "accepted_actions_missing" };
    }

    const now = new Date().toISOString();
    const referenceIds: string[] = [];
    for (const action of matching) {
      const referenceId = randomUUID();
      referenceIds.push(referenceId);
      action.gateDecisionReferences.push({
        id: referenceId,
        gateId,
        decision,
        recordedAt: now,
      });
    }
    await writeStore(store);
    return { outcome: "protected", actions: matching, referenceIds };
  });
}

export async function rollbackGateActionProtection(
  projectId: string,
  referenceIds: string[],
) {
  if (referenceIds.length === 0) return;
  const references = new Set(referenceIds);

  await withStoreMutation(async (store) => {
    let changed = false;
    for (const action of store.actions) {
      if (action.projectId !== projectId) continue;
      const retained = action.gateDecisionReferences.filter(
        (reference) => !references.has(reference.id),
      );
      if (retained.length !== action.gateDecisionReferences.length) {
        action.gateDecisionReferences = retained;
        changed = true;
      }
    }
    if (changed) await writeStore(store);
  });
}

export async function deleteProjectAction(
  projectId: string,
  actionId: string,
): Promise<ProjectActionDeletionResult> {
  return withStoreMutation(async (store) => {
    const index = store.actions.findIndex(
      (action) => action.projectId === projectId && action.id === actionId,
    );
    if (index < 0) throw new Error("Action not found.");

    const action = store.actions[index];
    if (action.gateDecisionReferences.length > 0) {
      return {
        deleted: false,
        reason:
          "This Gate Action formed part of a finalized Gate decision and must remain in the governance history.",
      };
    }

    store.actions.splice(index, 1);
    await writeStore(store);
    return { deleted: true };
  });
}

export async function deleteActionsForProject(projectId: string) {
  return withStoreMutation(async (store) => {
    if (
      store.actions.some(
        (action) =>
          action.projectId === projectId &&
          action.gateDecisionReferences.length > 0,
      )
    ) {
      throw new Error(
        "This Project contains Gate Actions retained as finalized governance history.",
      );
    }

    const remaining = store.actions.filter(
      (action) => action.projectId !== projectId,
    );
    const deleted = store.actions.length - remaining.length;
    if (deleted > 0) {
      store.actions = remaining;
      // Retain the Project sequence counter so a restored Project cannot reuse IDs.
      await writeStore(store);
    }
    return deleted;
  });
}
