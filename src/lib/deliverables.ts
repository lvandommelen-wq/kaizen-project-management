import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Applicability, Gate } from "./gates";
import type { GovernanceGateTemplate } from "./governance-templates";
import { getOperationalDataBackend } from "./operational/backend";
import * as postgresOperational from "./operational/postgres";

export const deliverableStatuses = ["not_started", "in_progress", "completed"] as const;
export const deliverableScopeLevels = ["project", "package"] as const;

export type DeliverableStatus = (typeof deliverableStatuses)[number];
export type DeliverableScopeLevel = (typeof deliverableScopeLevels)[number];

export type Deliverable = {
  id: string;
  templateId: string | null;
  templateVersion: number | null;
  projectId: string;
  packageId: string | null;
  gateId: string;
  criterionIds: string[];
  title: string;
  description: string;
  status: DeliverableStatus;
  applicability: Applicability;
  applicabilityJustification: string | null;
  applicabilityDecidedAt: string | null;
  applicabilityDecidedByUserId: string | null;
  applicabilityDecidedByDisplayName: string | null;
  applicabilityOrigin: "legacy" | "template" | "user";
  applicabilityLocked: boolean;
  stageId: string;
  scopeLevel: DeliverableScopeLevel;
  createdAt: string;
  updatedAt: string;
};

export type DeliverableInput = Omit<
  Deliverable,
  "id" | "templateId" | "templateVersion" | "createdAt" | "updatedAt" |
  "applicability" | "applicabilityJustification" | "applicabilityDecidedAt" |
  "applicabilityDecidedByUserId" | "applicabilityDecidedByDisplayName" |
  "applicabilityOrigin" | "applicabilityLocked"
>;

export const deliverableStatusLabels: Record<DeliverableStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
};

const dataDirectory = path.join(process.cwd(), ".data");
const deliverablesFile = path.join(dataDirectory, "deliverables.json");

async function ensureDataFile() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(deliverablesFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    await writeFile(deliverablesFile, "[]\n", "utf8");
  }
}

async function readDeliverablesFile(): Promise<Deliverable[]> {
  await ensureDataFile();
  const contents = await readFile(deliverablesFile, "utf8");
  return (JSON.parse(contents) as Partial<Deliverable>[]).map(normalizeDeliverable);
}

async function writeDeliverablesFile(deliverables: Deliverable[]) {
  await ensureDataFile();
  await writeFile(deliverablesFile, `${JSON.stringify(deliverables, null, 2)}\n`, "utf8");
}

export async function getGateDeliverables(projectId: string, packageId: string | null, gateId: string) {
  if (getOperationalDataBackend() === "postgres") {
    return postgresOperational.getGateDeliverables(projectId, packageId, gateId);
  }
  const deliverables = await readDeliverablesFile();
  return deliverables.filter(
    (deliverable) =>
      deliverable.projectId === projectId && deliverable.packageId === packageId && deliverable.gateId === gateId,
  );
}

export async function createDeliverable(input: DeliverableInput) {
  if (getOperationalDataBackend() === "postgres") {
    return postgresOperational.createDeliverable(input);
  }
  const deliverables = await readDeliverablesFile();
  const now = new Date().toISOString();
  const deliverable: Deliverable = {
    id: randomUUID(),
    templateId: null,
    templateVersion: null,
    ...input,
    applicability: "applicable",
    applicabilityJustification: null,
    applicabilityDecidedAt: now,
    applicabilityDecidedByUserId: null,
    applicabilityDecidedByDisplayName: null,
    applicabilityOrigin: "user",
    applicabilityLocked: false,
    createdAt: now,
    updatedAt: now,
  };

  await writeDeliverablesFile([...deliverables, deliverable]);
  return deliverable;
}

export async function updateDeliverable(deliverableId: string, input: DeliverableInput) {
  if (getOperationalDataBackend() === "postgres") {
    return postgresOperational.updateDeliverable(deliverableId, input);
  }
  const deliverables = await readDeliverablesFile();
  const index = deliverables.findIndex((deliverable) => deliverable.id === deliverableId);

  if (index === -1) {
    return null;
  }

  const existingDeliverable = deliverables[index];

  if (
    existingDeliverable.projectId !== input.projectId ||
    existingDeliverable.packageId !== input.packageId ||
    existingDeliverable.gateId !== input.gateId
  ) {
    return null;
  }

  const updatedDeliverable: Deliverable = {
    ...existingDeliverable,
    ...input,
    description: existingDeliverable.description,
    updatedAt: new Date().toISOString(),
  };

  deliverables[index] = updatedDeliverable;
  await writeDeliverablesFile(deliverables);
  return updatedDeliverable;
}

export async function deleteDeliverable(
  deliverableId: string,
  context: { projectId: string; packageId: string | null; gateId: string },
) {
  if (getOperationalDataBackend() === "postgres") {
    return postgresOperational.deleteDeliverable(deliverableId, context);
  }
  const deliverables = await readDeliverablesFile();
  const index = deliverables.findIndex(
    (deliverable) =>
      deliverable.id === deliverableId &&
      deliverable.projectId === context.projectId &&
      deliverable.packageId === context.packageId &&
      deliverable.gateId === context.gateId,
  );

  if (index === -1 || deliverables[index].templateId) {
    return false;
  }

  deliverables.splice(index, 1);
  await writeDeliverablesFile(deliverables);
  return true;
}

export async function ensureDefaultDeliverables<StageId extends string>(context: {
  projectId: string;
  packageId: string | null;
  gates: Gate<StageId>[];
  templates: GovernanceGateTemplate<StageId>[];
}) {
  if (getOperationalDataBackend() === "postgres") {
    return postgresOperational.ensureDefaultDeliverables(context);
  }
  const deliverables = await readDeliverablesFile();
  let changed = false;

  for (const template of context.templates) {
    const gate = context.gates.find((gate) => gate.stageId === template.stageId);

    if (!gate) {
      continue;
    }
    if (gate.status !== "not_submitted" && gate.status !== "returned_for_rework") {
      continue;
    }

    const defaultTemplateIds = new Set(template.deliverables.map((definition) => definition.id));
    const seenDefaultTemplateIds = new Set<string>();

    for (let index = 0; index < deliverables.length; ) {
      const existingDeliverable = deliverables[index];
      const belongsToGate =
        existingDeliverable.projectId === context.projectId &&
        existingDeliverable.packageId === context.packageId &&
        existingDeliverable.gateId === gate.id;

      if (!belongsToGate) {
        index += 1;
        continue;
      }

      if (existingDeliverable.templateId) {
        const isCurrentDefault =
          defaultTemplateIds.has(existingDeliverable.templateId) &&
          !seenDefaultTemplateIds.has(existingDeliverable.templateId);

        if (!isCurrentDefault) {
          deliverables.splice(index, 1);
          changed = true;
          continue;
        }

        seenDefaultTemplateIds.add(existingDeliverable.templateId);
      }

      if (existingDeliverable.criterionIds.length > 0) {
        existingDeliverable.criterionIds = [];
        existingDeliverable.updatedAt = new Date().toISOString();
        changed = true;
      }

      index += 1;
    }

    for (const definition of template.deliverables) {
      const id = `${gate.id}:deliverable:${definition.id}`;
      const existingDeliverable = deliverables.find(
        (deliverable) =>
          deliverable.projectId === context.projectId &&
          deliverable.packageId === context.packageId &&
          deliverable.gateId === gate.id &&
          (deliverable.templateId === definition.id ||
            (deliverable.templateId != null && deliverable.id === id)),
      );

      if (existingDeliverable) {
        const usesPreviousDefaultTitle = definition.previousTitles?.includes(
          existingDeliverable.title,
        ) ?? false;

        if (
          existingDeliverable.templateId !== definition.id ||
          existingDeliverable.templateVersion !== template.templateVersion ||
          usesPreviousDefaultTitle ||
          existingDeliverable.description !== definition.description
        ) {
          existingDeliverable.templateId = definition.id;
          existingDeliverable.templateVersion = template.templateVersion;
          existingDeliverable.criterionIds = [];
          if (usesPreviousDefaultTitle) existingDeliverable.title = definition.title;
          existingDeliverable.description = definition.description;
          existingDeliverable.updatedAt = new Date().toISOString();
          changed = true;
        }

        continue;
      }

      const now = new Date().toISOString();
      deliverables.push({
        id,
        templateId: definition.id,
        templateVersion: template.templateVersion,
        projectId: context.projectId,
        packageId: context.packageId,
        gateId: gate.id,
        criterionIds: [],
        title: definition.title,
        description: definition.description,
        status: "not_started",
        applicability: "applicable",
        applicabilityJustification: null,
        applicabilityDecidedAt: null,
        applicabilityDecidedByUserId: null,
        applicabilityDecidedByDisplayName: null,
        applicabilityOrigin: "template",
        applicabilityLocked: definition.applicabilityLocked ?? false,
        stageId: gate.stageId,
        scopeLevel: context.packageId ? "package" : "project",
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
  }

  if (changed) {
    await writeDeliverablesFile(deliverables);
  }
}

export async function deleteDeliverablesForProject(projectId: string) {
  if (getOperationalDataBackend() === "postgres") {
    return;
  }
  const deliverables = await readDeliverablesFile();
  const remainingDeliverables = deliverables.filter((deliverable) => deliverable.projectId !== projectId);

  if (remainingDeliverables.length !== deliverables.length) {
    await writeDeliverablesFile(remainingDeliverables);
  }
}

export async function deleteDeliverablesForPackage(projectId: string, packageId: string) {
  if (getOperationalDataBackend() === "postgres") {
    return;
  }
  const deliverables = await readDeliverablesFile();
  const remainingDeliverables = deliverables.filter(
    (deliverable) => !(deliverable.projectId === projectId && deliverable.packageId === packageId),
  );

  if (remainingDeliverables.length !== deliverables.length) {
    await writeDeliverablesFile(remainingDeliverables);
  }
}

export function parseDeliverableFormData(
  formData: FormData,
  context: {
    projectId: string;
    packageId: string | null;
    gateId: string;
    stageId: string;
  },
): DeliverableInput {
  const title = String(formData.get("title") ?? "").trim();
  const status = String(formData.get("status") ?? "not_started");

  if (!title) {
    throw new Error("Deliverable title is required.");
  }

  if (!deliverableStatuses.includes(status as DeliverableStatus)) {
    throw new Error("Invalid Deliverable status.");
  }

  return {
    projectId: context.projectId,
    packageId: context.packageId,
    gateId: context.gateId,
    criterionIds: [],
    title,
    description: "",
    status: status as DeliverableStatus,
    stageId: context.stageId,
    scopeLevel: context.packageId ? "package" : "project",
  };
}

function normalizeDeliverable(deliverable: Partial<Deliverable>): Deliverable {
  const legacyNotApplicable = (deliverable.status as string) === "not_applicable";
  const status = deliverableStatuses.includes(deliverable.status as DeliverableStatus)
    ? (deliverable.status as DeliverableStatus)
    : "not_started";
  const scopeLevel = deliverableScopeLevels.includes(deliverable.scopeLevel as DeliverableScopeLevel)
    ? (deliverable.scopeLevel as DeliverableScopeLevel)
    : deliverable.packageId
      ? "package"
      : "project";
  const now = new Date().toISOString();

  return {
    id: deliverable.id ?? randomUUID(),
    templateId: deliverable.templateId ?? null,
    templateVersion:
      typeof deliverable.templateVersion === "number" ? deliverable.templateVersion : null,
    projectId: deliverable.projectId ?? "",
    packageId: deliverable.packageId ?? null,
    gateId: deliverable.gateId ?? "",
    criterionIds: [],
    title: deliverable.title ?? "",
    description: deliverable.description ?? "",
    status,
    applicability:
      (deliverable.applicability as string) === "not_applicable" || legacyNotApplicable
        ? "not_applicable"
        : "applicable",
    applicabilityJustification: deliverable.applicabilityJustification ?? null,
    applicabilityDecidedAt: deliverable.applicabilityDecidedAt ?? null,
    applicabilityDecidedByUserId: deliverable.applicabilityDecidedByUserId ?? null,
    applicabilityDecidedByDisplayName: deliverable.applicabilityDecidedByDisplayName ?? null,
    applicabilityOrigin: deliverable.applicabilityOrigin ?? "legacy",
    applicabilityLocked: deliverable.applicabilityLocked ?? false,
    stageId: deliverable.stageId ?? "",
    scopeLevel,
    createdAt: deliverable.createdAt ?? now,
    updatedAt: deliverable.updatedAt ?? deliverable.createdAt ?? now,
  };
}
