import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDefaultDeliverables,
  getGateDeliverables,
  removeCriterionFromDeliverables,
} from "./deliverables";
import {
  createGateReviewCycle,
  createGates,
  getGateSubmissionIssues,
  isGateInPreparation,
  normalizeGates,
  recordGateReviewResponse,
  withdrawGateReviewCycle,
  type Gate,
  type GateApprover,
  type GateApproverInput,
  type GateCriterion,
  type GateCriterionInput,
  type GateReviewResponseInput,
  type GateReviewResponseResult,
  type GateSubmissionResult,
  type GateWithdrawalResult,
} from "./gates";
import { getProjectGateTemplates } from "./governance-templates";
import {
  getGovernanceTierActionReferences,
  getGateActions,
  protectGateActionsForDecision,
  rollbackGateActionProtection,
  withGateWorkflowLock,
  withGovernanceTierWorkflowLock,
} from "./project-actions";

export const projectStatuses = ["not_assessed", "green", "amber", "red"] as const;
export const projectStageIds = ["initiation", "definition_design", "delivery", "validation", "closure"] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectStageId = (typeof projectStageIds)[number];

export type ProjectStage = {
  id: ProjectStageId;
  label: string;
};

export type GovernanceTier = {
  id: string;
  sequence: number;
  name: string;
  description: string;
};

export type GovernanceTierInput = Pick<GovernanceTier, "name" | "description">;

export type Project = {
  id: string;
  projectNumber: string;
  name: string;
  description: string;
  projectManager: string;
  customer: string;
  reportsTo: string;
  siteLocation: string;
  plannedStartDate: string;
  plannedCompletionDate: string;
  validationRequired: boolean;
  currentStage: ProjectStageId;
  governanceTiers: GovernanceTier[];
  gates: Gate<ProjectStageId>[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectFormInput = Omit<
  Project,
  "id" | "governanceTiers" | "gates" | "createdAt" | "updatedAt"
>;

const dataDirectory = path.join(process.cwd(), ".data");
const projectsFile = path.join(dataDirectory, "projects.json");

export const projectStatusLabels: Record<ProjectStatus, string> = {
  not_assessed: "Not assessed",
  green: "Green",
  amber: "Amber",
  red: "Red",
};

export const projectStageLabels: Record<ProjectStageId, string> = {
  initiation: "Initiation",
  definition_design: "Definition & Design",
  delivery: "Delivery",
  validation: "Validation",
  closure: "Closure",
};

export function getProjectLifecycle(validationRequired: boolean): ProjectStage[] {
  const stages: ProjectStageId[] = validationRequired
    ? ["initiation", "definition_design", "delivery", "validation", "closure"]
    : ["initiation", "definition_design", "delivery", "closure"];

  return stages.map((id) => ({ id, label: projectStageLabels[id] }));
}

export function getNextProjectStage(
  currentStage: ProjectStageId,
  validationRequired: boolean,
): ProjectStageId | null {
  const lifecycle = getProjectLifecycle(validationRequired);
  const currentIndex = lifecycle.findIndex((stage) => stage.id === currentStage);
  return lifecycle[currentIndex + 1]?.id ?? null;
}

export function getPreviousProjectStage(
  currentStage: ProjectStageId,
  validationRequired: boolean,
): ProjectStageId | null {
  const lifecycle = getProjectLifecycle(validationRequired);
  const currentIndex = lifecycle.findIndex((stage) => stage.id === currentStage);
  return lifecycle[currentIndex - 1]?.id ?? null;
}

export function getProjectStatus(): ProjectStatus {
  return "not_assessed";
}

async function ensureDataFile() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(projectsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    await writeFile(projectsFile, "[]\n", "utf8");
  }
}

async function readProjectsFile(): Promise<Project[]> {
  await ensureDataFile();
  const contents = await readFile(projectsFile, "utf8");
  const storedProjects = JSON.parse(contents) as Partial<Project>[];
  const projects = storedProjects.map(normalizeProject);

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function writeProjectsFile(projects: Project[]) {
  await ensureDataFile();
  await writeFile(projectsFile, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

export async function getProjects() {
  const projects = await readProjectsFile();

  for (const project of projects) {
    await ensureProjectDefaultDeliverables(project);
  }

  return projects;
}

export async function getProject(projectId: string) {
  const projects = await readProjectsFile();
  const project = projects.find((project) => project.id === projectId) ?? null;

  if (project) {
    await ensureProjectDefaultDeliverables(project);
  }

  return project;
}

export async function createProject(input: ProjectFormInput) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const now = new Date().toISOString();
    const id = randomUUID();
    const project: Project = {
      id,
      ...input,
      currentStage: "initiation",
      governanceTiers: [],
      gates: createGates(id, getProjectGateTemplates(input.validationRequired)),
      createdAt: now,
      updatedAt: now,
    };

    await writeProjectsFile([project, ...projects]);
    await ensureProjectDefaultDeliverables(project);
    return project;
  });
}

export async function updateProject(projectId: string, input: ProjectFormInput) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const index = projects.findIndex((project) => project.id === projectId);

    if (index === -1) {
      return null;
    }

    const updatedProject: Project = {
      ...projects[index],
      ...input,
      currentStage: projects[index].currentStage,
      updatedAt: new Date().toISOString(),
    };

    projects[index] = updatedProject;
    await writeProjectsFile(projects);

    return updatedProject;
  });
}

export function parseGovernanceTierFormData(formData: FormData): GovernanceTierInput {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Governance Tier name is required.");

  return {
    name,
    description: String(formData.get("description") ?? "").trim(),
  };
}

export async function createProjectGovernanceTier(
  projectId: string,
  input: GovernanceTierInput,
) {
  return withGateWorkflowLock(() =>
    withGovernanceTierWorkflowLock(() =>
      createProjectGovernanceTierWithoutWorkflowLock(projectId, input),
    ),
  );
}

async function createProjectGovernanceTierWithoutWorkflowLock(
  projectId: string,
  input: GovernanceTierInput,
) {
  const projects = await readProjectsFile();
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;

  assertUniqueGovernanceTierName(project, input.name);
  const tier: GovernanceTier = {
    id: randomUUID(),
    sequence: project.governanceTiers.length + 1,
    ...input,
  };
  project.governanceTiers.push(tier);
  project.updatedAt = new Date().toISOString();
  await writeProjectsFile(projects);
  return tier;
}

export async function updateProjectGovernanceTier(
  projectId: string,
  governanceTierId: string,
  input: GovernanceTierInput,
) {
  return withGateWorkflowLock(() =>
    withGovernanceTierWorkflowLock(() =>
      updateProjectGovernanceTierWithoutWorkflowLock(
        projectId,
        governanceTierId,
        input,
      ),
    ),
  );
}

async function updateProjectGovernanceTierWithoutWorkflowLock(
  projectId: string,
  governanceTierId: string,
  input: GovernanceTierInput,
) {
  const projects = await readProjectsFile();
  const project = projects.find((candidate) => candidate.id === projectId);
  const tier = project?.governanceTiers.find(
    (candidate) => candidate.id === governanceTierId,
  );
  if (!project || !tier) return null;

  assertUniqueGovernanceTierName(project, input.name, tier.id);
  tier.name = input.name;
  tier.description = input.description;
  project.updatedAt = new Date().toISOString();
  await writeProjectsFile(projects);
  return tier;
}

export async function moveProjectGovernanceTier(
  projectId: string,
  governanceTierId: string,
  direction: "up" | "down",
) {
  return withGateWorkflowLock(() =>
    withGovernanceTierWorkflowLock(() =>
      moveProjectGovernanceTierWithoutWorkflowLock(
        projectId,
        governanceTierId,
        direction,
      ),
    ),
  );
}

async function moveProjectGovernanceTierWithoutWorkflowLock(
  projectId: string,
  governanceTierId: string,
  direction: "up" | "down",
) {
  const projects = await readProjectsFile();
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;

  const index = project.governanceTiers.findIndex(
    (tier) => tier.id === governanceTierId,
  );
  if (index < 0) return null;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= project.governanceTiers.length) {
    return project.governanceTiers[index];
  }

  [project.governanceTiers[index], project.governanceTiers[targetIndex]] = [
    project.governanceTiers[targetIndex],
    project.governanceTiers[index],
  ];
  resequenceGovernanceTiers(project.governanceTiers);
  project.updatedAt = new Date().toISOString();
  await writeProjectsFile(projects);
  return project.governanceTiers[targetIndex];
}

export async function deleteProjectGovernanceTier(
  projectId: string,
  governanceTierId: string,
) {
  return withGateWorkflowLock(() =>
    withGovernanceTierWorkflowLock(() =>
      deleteProjectGovernanceTierWithoutWorkflowLock(
        projectId,
        governanceTierId,
      ),
    ),
  );
}

async function deleteProjectGovernanceTierWithoutWorkflowLock(
  projectId: string,
  governanceTierId: string,
) {
  const references = await getGovernanceTierActionReferences(
    projectId,
    governanceTierId,
  );
  if (references.hasReferences) {
    return { outcome: "referenced" as const, references };
  }

  const projects = await readProjectsFile();
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;
  const index = project.governanceTiers.findIndex(
    (tier) => tier.id === governanceTierId,
  );
  if (index < 0) return null;

  project.governanceTiers.splice(index, 1);
  resequenceGovernanceTiers(project.governanceTiers);
  project.updatedAt = new Date().toISOString();
  await writeProjectsFile(projects);
  return { outcome: "deleted" as const };
}

function assertUniqueGovernanceTierName(
  project: Project,
  name: string,
  ignoredTierId?: string,
) {
  const normalizedName = name.toLocaleLowerCase();
  if (
    project.governanceTiers.some(
      (tier) =>
        tier.id !== ignoredTierId &&
        tier.name.toLocaleLowerCase() === normalizedName,
    )
  ) {
    throw new Error("Governance Tier names must be unique within the Project.");
  }
}

function resequenceGovernanceTiers(tiers: GovernanceTier[]) {
  tiers.forEach((tier, index) => {
    tier.sequence = index + 1;
  });
}

export async function submitProjectGateForApproval(
  projectId: string,
  gateId: string,
): Promise<GateSubmissionResult<Project> | null> {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !gate) {
      return null;
    }

    if (gate.stageId !== project.currentStage) {
      return { outcome: "not_current" };
    }

    if (!isGateInPreparation(gate)) {
      return { outcome: "not_in_preparation" };
    }

    await ensureProjectDefaultDeliverables(project);
    const deliverables = await getGateDeliverables(project.id, null, gate.id);
    const gateActions = await getGateActions(project.id, gate.id);
    const issues = getGateSubmissionIssues(gate, deliverables, gateActions);

    if (issues.length > 0) {
      return { outcome: "blocked", issues };
    }

    const now = new Date().toISOString();
    const reviewCycle = createGateReviewCycle({
      id: randomUUID(),
      submittedAt: now,
      submittedBy: {
        userId: null,
        displayName: project.projectManager,
        email: null,
      },
      project: {
        id: project.id,
        projectNumber: project.projectNumber,
        name: project.name,
      },
      package: null,
      gate,
      stageLabel: projectStageLabels[gate.stageId],
      deliverables,
      gateActions,
    });

    gate.reviewCycles.push(reviewCycle);
    gate.status = "submitted_for_approval";
    project.updatedAt = now;
    await writeProjectsFile(projects);

    return { outcome: "submitted", entity: project, reviewCycle };
  });
}

export async function withdrawProjectGateSubmission(
  projectId: string,
  gateId: string,
): Promise<GateWithdrawalResult<Project> | null> {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !gate) {
      return null;
    }

    if (gate.stageId !== project.currentStage) {
      return { outcome: "not_current" };
    }

    const now = new Date().toISOString();
    const result = withdrawGateReviewCycle(gate, {
      withdrawnAt: now,
      withdrawnBy: {
        userId: null,
        displayName: project.projectManager,
        email: null,
      },
    });

    if (result.outcome !== "withdrawn") {
      return result;
    }

    project.updatedAt = now;
    await writeProjectsFile(projects);

    return { ...result, entity: project };
  });
}

export async function respondToProjectGateReview(
  projectId: string,
  gateId: string,
  input: GateReviewResponseInput,
): Promise<GateReviewResponseResult<Project> | null> {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !gate) {
      return null;
    }

    if (gate.stageId !== project.currentStage) {
      return { outcome: "not_current" };
    }

    const now = new Date().toISOString();
    const transition = recordGateReviewResponse(gate, input, now);
    if (transition.outcome !== "recorded") {
      return transition;
    }

    let referenceIds: string[] = [];
    if (transition.completion === "approved_with_actions") {
      const protection = await protectGateActionsForDecision(
        project.id,
        gate.id,
        transition.completion,
        transition.acceptedActionIds,
      );
      if (protection.outcome !== "protected") {
        return protection;
      }
      referenceIds = protection.referenceIds;
    }

    if (
      transition.completion === "approved" ||
      transition.completion === "approved_with_actions"
    ) {
      const nextStage = getNextProjectStage(
        project.currentStage,
        project.validationRequired,
      );
      if (nextStage) {
        project.currentStage = nextStage;
      }
    }

    project.updatedAt = now;
    try {
      await writeProjectsFile(projects);
    } catch (error) {
      await rollbackGateActionProtection(project.id, referenceIds);
      throw error;
    }

    return {
      outcome: "recorded",
      entity: project,
      reviewCycle: transition.reviewCycle,
      completion: transition.completion,
    };
  });
}

export async function reopenProjectGate(projectId: string, gateId: string) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !gate) {
      return null;
    }

    if (gate.status === "approved" || gate.status === "approved_with_actions") {
      gate.status = "not_submitted";
      project.updatedAt = new Date().toISOString();
      await writeProjectsFile(projects);
    }

    return project;
  });
}

export async function returnProjectToPreviousStage(projectId: string) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const index = projects.findIndex((project) => project.id === projectId);

    if (index === -1) {
      return null;
    }

    if (
      projects[index].gates.some(
        (gate) => gate.status === "submitted_for_approval",
      )
    ) {
      return projects[index];
    }

    const previousStage = getPreviousProjectStage(
      projects[index].currentStage,
      projects[index].validationRequired,
    );

    if (!previousStage) {
      return projects[index];
    }

    const updatedProject: Project = {
      ...projects[index],
      currentStage: previousStage,
      updatedAt: new Date().toISOString(),
    };

    projects[index] = updatedProject;
    await writeProjectsFile(projects);

    return updatedProject;
  });
}

export async function createProjectGateApprover(
  projectId: string,
  gateId: string,
  input: GateApproverInput,
) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !gate || !isGateInPreparation(gate)) {
      return null;
    }

    const approver: GateApprover = {
      id: randomUUID(),
      ...input,
    };

    gate.approvers.push(approver);
    project.updatedAt = new Date().toISOString();
    await writeProjectsFile(projects);
    return approver;
  });
}

export async function updateProjectGateApprover(
  projectId: string,
  gateId: string,
  approverId: string,
  input: GateApproverInput,
) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);
    const approverIndex = gate?.approvers.findIndex(
      (approver) => approver.id === approverId,
    ) ?? -1;

    if (!project || !gate || !isGateInPreparation(gate) || approverIndex === -1) {
      return null;
    }

    const approver: GateApprover = {
      id: approverId,
      ...input,
    };

    gate.approvers[approverIndex] = approver;
    project.updatedAt = new Date().toISOString();
    await writeProjectsFile(projects);
    return approver;
  });
}

export async function deleteProjectGateApprover(
  projectId: string,
  gateId: string,
  approverId: string,
) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const project = projects.find((candidate) => candidate.id === projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);
    const approverIndex = gate?.approvers.findIndex(
      (approver) => approver.id === approverId,
    ) ?? -1;

    if (!project || !gate || !isGateInPreparation(gate) || approverIndex === -1) {
      return false;
    }

    gate.approvers.splice(approverIndex, 1);
    project.updatedAt = new Date().toISOString();
    await writeProjectsFile(projects);
    return true;
  });
}

export async function createProjectGateCriterion(
  projectId: string,
  gateId: string,
  input: GateCriterionInput,
) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      return null;
    }

    const gate = projects[projectIndex].gates.find((gate) => gate.id === gateId);

    if (!gate || !isGateInPreparation(gate)) {
      return null;
    }

    const criterion: GateCriterion = {
      id: randomUUID(),
      templateId: null,
      ...input,
    };

    gate.criteria.push(criterion);
    projects[projectIndex].updatedAt = new Date().toISOString();
    await writeProjectsFile(projects);
    return criterion;
  });
}

export async function updateProjectGateCriterion(
  projectId: string,
  gateId: string,
  criterionId: string,
  input: GateCriterionInput,
) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      return null;
    }

    const gate = projects[projectIndex].gates.find((gate) => gate.id === gateId);
    const criterionIndex = gate?.criteria.findIndex(
      (criterion) => criterion.id === criterionId,
    ) ?? -1;

    if (!gate || !isGateInPreparation(gate) || criterionIndex === -1) {
      return null;
    }

    const criterion: GateCriterion = {
      id: criterionId,
      templateId: gate.criteria[criterionIndex].templateId,
      ...input,
    };

    gate.criteria[criterionIndex] = criterion;
    projects[projectIndex].updatedAt = new Date().toISOString();
    await writeProjectsFile(projects);
    return criterion;
  });
}

export async function deleteProjectGateCriterion(projectId: string, gateId: string, criterionId: string) {
  return withGateWorkflowLock(async () => {
    const projects = await readProjectsFile();
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      return false;
    }

    const gate = projects[projectIndex].gates.find((gate) => gate.id === gateId);
    const criterionIndex = gate?.criteria.findIndex(
      (criterion) => criterion.id === criterionId,
    ) ?? -1;

    if (
      !gate ||
      !isGateInPreparation(gate) ||
      criterionIndex === -1 ||
      gate.criteria[criterionIndex].templateId
    ) {
      return false;
    }

    gate.criteria.splice(criterionIndex, 1);
    projects[projectIndex].updatedAt = new Date().toISOString();
    await writeProjectsFile(projects);
    await removeCriterionFromDeliverables(criterionId);
    return true;
  });
}

export async function deleteProject(projectId: string) {
  const projects = await readProjectsFile();
  const remainingProjects = projects.filter((project) => project.id !== projectId);

  if (remainingProjects.length === projects.length) {
    return false;
  }

  await writeProjectsFile(remainingProjects);
  return true;
}

export function parseProjectFormData(formData: FormData): ProjectFormInput {
  return parseProjectFormDataWithOptions(formData);
}

export function parseProjectFormDataWithOptions(
  formData: FormData,
  { allowStageSelection = false }: { allowStageSelection?: boolean } = {},
): ProjectFormInput {
  const validationRequired = String(formData.get("validationRequired")) === "yes";

  const currentStage = allowStageSelection
    ? String(formData.get("currentStage") ?? "initiation")
    : "initiation";

  if (!projectStageIds.includes(currentStage as ProjectStageId)) {
    throw new Error("Invalid project stage.");
  }

  if (!getProjectLifecycle(validationRequired).some((stage) => stage.id === currentStage)) {
    throw new Error("Selected project stage is not available for this lifecycle.");
  }

  const input = {
    projectNumber: String(formData.get("projectNumber") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    projectManager: String(formData.get("projectManager") ?? "").trim(),
    customer: String(formData.get("customer") ?? "").trim(),
    reportsTo: String(formData.get("reportsTo") ?? "").trim(),
    siteLocation: String(formData.get("siteLocation") ?? "").trim(),
    plannedStartDate: String(formData.get("plannedStartDate") ?? ""),
    plannedCompletionDate: String(formData.get("plannedCompletionDate") ?? ""),
    validationRequired,
    currentStage: currentStage as ProjectStageId,
  };

  if (
    !input.projectNumber ||
    !input.name ||
    !input.projectManager ||
    !input.customer ||
    !input.siteLocation ||
    !input.reportsTo
  ) {
    throw new Error("Project number, name, project manager, customer, site / location, and reports to are required.");
  }

  return input;
}

function normalizeProject(project: Partial<Project>): Project {
  const id = project.id ?? randomUUID();
  const validationRequired = Boolean(project.validationRequired);
  const currentStage = projectStageIds.includes(project.currentStage as ProjectStageId)
    ? (project.currentStage as ProjectStageId)
    : "initiation";
  const normalizedStage = getProjectLifecycle(validationRequired).some((stage) => stage.id === currentStage)
    ? currentStage
    : "initiation";
  const now = new Date().toISOString();

  return {
    id,
    projectNumber: project.projectNumber ?? "",
    name: project.name ?? "",
    description: project.description ?? "",
    projectManager: project.projectManager ?? "",
    customer: project.customer ?? "",
    reportsTo: project.reportsTo ?? "",
    siteLocation: project.siteLocation ?? "",
    plannedStartDate: project.plannedStartDate ?? "",
    plannedCompletionDate: project.plannedCompletionDate ?? "",
    validationRequired,
    currentStage: normalizedStage,
    governanceTiers: normalizeGovernanceTiers(project.governanceTiers),
    gates: normalizeGates(id, project.gates, getProjectGateTemplates(validationRequired)),
    createdAt: project.createdAt ?? now,
    updatedAt: project.updatedAt ?? project.createdAt ?? now,
  };
}

function normalizeGovernanceTiers(value: unknown): GovernanceTier[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  const tiers = value.flatMap((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const stored = candidate as Record<string, unknown>;
    const name = typeof stored.name === "string" ? stored.name.trim() : "";
    if (!name) return [];

    let id = typeof stored.id === "string" && stored.id ? stored.id : randomUUID();
    if (ids.has(id)) id = randomUUID();
    ids.add(id);

    return [{
      id,
      sequence:
        typeof stored.sequence === "number" && Number.isFinite(stored.sequence)
          ? stored.sequence
          : index + 1,
      name,
      description:
        typeof stored.description === "string" ? stored.description.trim() : "",
    }];
  });

  tiers.sort((left, right) => left.sequence - right.sequence);
  resequenceGovernanceTiers(tiers);
  return tiers;
}

async function ensureProjectDefaultDeliverables(project: Project) {
  await ensureDefaultDeliverables({
    projectId: project.id,
    packageId: null,
    gates: project.gates,
    templates: getProjectGateTemplates(project.validationRequired),
  });
}
