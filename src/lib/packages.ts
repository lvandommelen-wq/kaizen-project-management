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
import { packageGateTemplates } from "./governance-templates";
import {
  getGateActions,
  protectGateActionsForDecision,
  rollbackGateActionProtection,
  withGateWorkflowLock,
} from "./project-actions";
import { getProject } from "./projects";

export const packageStageIds = ["definition", "tendering", "procurement", "execution", "closure"] as const;
export const packageStatuses = ["not_assessed", "green", "amber", "red"] as const;
export const packageExecutionModels = ["internal", "external"] as const;

export type PackageStageId = (typeof packageStageIds)[number];
export type PackageStatus = (typeof packageStatuses)[number];
export type PackageExecutionModel = (typeof packageExecutionModels)[number];

export type PackageStage = {
  id: PackageStageId;
  label: string;
};

export type ProjectPackage = {
  id: string;
  projectId: string;
  packageCode: string;
  packageName: string;
  description: string;
  packageOwner: string;
  executionModel: PackageExecutionModel | null;
  currentStage: PackageStageId;
  gates: Gate<PackageStageId>[];
  status: PackageStatus;
  targetDeliveryDate: string;
  createdAt: string;
  updatedAt: string;
};

export type PackageFormInput = Omit<ProjectPackage, "id" | "projectId" | "gates" | "createdAt" | "updatedAt">;

const dataDirectory = path.join(process.cwd(), ".data");
const packagesFile = path.join(dataDirectory, "packages.json");

export const packageStageLabels: Record<PackageStageId, string> = {
  definition: "Definition",
  tendering: "Tendering",
  procurement: "Procurement",
  execution: "Execution",
  closure: "Closure",
};

export const packageStatusLabels: Record<PackageStatus, string> = {
  not_assessed: "Not assessed",
  green: "Green",
  amber: "Amber",
  red: "Red",
};

export const packageExecutionModelLabels: Record<PackageExecutionModel, string> = {
  internal: "Internal",
  external: "External",
};

export function formatPackageExecutionModel(executionModel: PackageExecutionModel | null) {
  return executionModel ? packageExecutionModelLabels[executionModel] : "Not determined";
}

export function getPackageLifecycle(): PackageStage[] {
  return packageStageIds.map((id) => ({ id, label: packageStageLabels[id] }));
}

export function getNextPackageStage(currentStage: PackageStageId): PackageStageId | null {
  const currentIndex = packageStageIds.indexOf(currentStage);
  return packageStageIds[currentIndex + 1] ?? null;
}

export function getPreviousPackageStage(currentStage: PackageStageId): PackageStageId | null {
  const currentIndex = packageStageIds.indexOf(currentStage);
  return packageStageIds[currentIndex - 1] ?? null;
}

async function ensureDataFile() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(packagesFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    await writeFile(packagesFile, "[]\n", "utf8");
  }
}

async function readPackagesFile(): Promise<ProjectPackage[]> {
  await ensureDataFile();
  const contents = await readFile(packagesFile, "utf8");
  const storedPackages = JSON.parse(contents) as Partial<ProjectPackage>[];
  const packages = storedPackages.map(normalizePackage);

  return packages.sort((a, b) => a.packageCode.localeCompare(b.packageCode));
}

async function writePackagesFile(packages: ProjectPackage[]) {
  await ensureDataFile();
  await writeFile(packagesFile, `${JSON.stringify(packages, null, 2)}\n`, "utf8");
}

export async function getPackages(projectId: string) {
  const packages = await readPackagesFile();
  const projectPackages = packages.filter((projectPackage) => projectPackage.projectId === projectId);

  for (const projectPackage of projectPackages) {
    await ensurePackageDefaultDeliverables(projectPackage);
  }

  return projectPackages;
}

export async function getPackage(projectId: string, packageId: string) {
  const packages = await readPackagesFile();
  const projectPackage =
    packages.find((projectPackage) => projectPackage.projectId === projectId && projectPackage.id === packageId) ?? null;

  if (projectPackage) {
    await ensurePackageDefaultDeliverables(projectPackage);
  }

  return projectPackage;
}

export async function createPackage(projectId: string, input: PackageFormInput) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    assertUniquePackageCode(packages, projectId, input.packageCode);

    const now = new Date().toISOString();
    const id = randomUUID();
    const projectPackage: ProjectPackage = {
      id,
      projectId,
      ...input,
      currentStage: "definition",
      gates: createGates(id, packageGateTemplates),
      createdAt: now,
      updatedAt: now,
    };

    await writePackagesFile([...packages, projectPackage]);
    await ensurePackageDefaultDeliverables(projectPackage);
    return projectPackage;
  });
}

export async function updatePackage(projectId: string, packageId: string, input: PackageFormInput) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const index = packages.findIndex(
      (projectPackage) => projectPackage.projectId === projectId && projectPackage.id === packageId,
    );

    if (index === -1) {
      return null;
    }

    assertUniquePackageCode(packages, projectId, input.packageCode, packageId);

    const updatedPackage: ProjectPackage = {
      ...packages[index],
      ...input,
      currentStage: packages[index].currentStage,
      updatedAt: new Date().toISOString(),
    };

    packages[index] = updatedPackage;
    await writePackagesFile(packages);

    return updatedPackage;
  });
}

export async function submitPackageGateForApproval(
  projectId: string,
  packageId: string,
  gateId: string,
): Promise<GateSubmissionResult<ProjectPackage> | null> {
  return withGateWorkflowLock(async () => {
    const [project, packages] = await Promise.all([getProject(projectId), readPackagesFile()]);
    const projectPackage = packages.find(
      (candidate) => candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !projectPackage || !gate) {
      return null;
    }

    if (gate.stageId !== projectPackage.currentStage) {
      return { outcome: "not_current" };
    }

    if (!isGateInPreparation(gate)) {
      return { outcome: "not_in_preparation" };
    }

    await ensurePackageDefaultDeliverables(projectPackage);
    const deliverables = await getGateDeliverables(projectId, projectPackage.id, gate.id);
    const gateActions = await getGateActions(projectId, gate.id);
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
      package: {
        id: projectPackage.id,
        packageCode: projectPackage.packageCode,
        name: projectPackage.packageName,
      },
      gate,
      stageLabel: packageStageLabels[gate.stageId],
      deliverables,
      gateActions,
    });

    gate.reviewCycles.push(reviewCycle);
    gate.status = "submitted_for_approval";
    projectPackage.updatedAt = now;
    await writePackagesFile(packages);

    return { outcome: "submitted", entity: projectPackage, reviewCycle };
  });
}

export async function withdrawPackageGateSubmission(
  projectId: string,
  packageId: string,
  gateId: string,
): Promise<GateWithdrawalResult<ProjectPackage> | null> {
  return withGateWorkflowLock(async () => {
    const [project, packages] = await Promise.all([getProject(projectId), readPackagesFile()]);
    const projectPackage = packages.find(
      (candidate) => candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !projectPackage || !gate) {
      return null;
    }

    if (gate.stageId !== projectPackage.currentStage) {
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

    projectPackage.updatedAt = now;
    await writePackagesFile(packages);

    return { ...result, entity: projectPackage };
  });
}

export async function respondToPackageGateReview(
  projectId: string,
  packageId: string,
  gateId: string,
  input: GateReviewResponseInput,
): Promise<GateReviewResponseResult<ProjectPackage> | null> {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const projectPackage = packages.find(
      (candidate) =>
        candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find(
      (candidate) => candidate.id === gateId,
    );

    if (!projectPackage || !gate) {
      return null;
    }

    if (gate.stageId !== projectPackage.currentStage) {
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
        projectId,
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
      const nextStage = getNextPackageStage(projectPackage.currentStage);
      if (nextStage) {
        projectPackage.currentStage = nextStage;
      }
    }

    projectPackage.updatedAt = now;
    try {
      await writePackagesFile(packages);
    } catch (error) {
      await rollbackGateActionProtection(projectId, referenceIds);
      throw error;
    }

    return {
      outcome: "recorded",
      entity: projectPackage,
      reviewCycle: transition.reviewCycle,
      completion: transition.completion,
    };
  });
}

export async function reopenPackageGate(projectId: string, packageId: string, gateId: string) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const projectPackage = packages.find(
      (candidate) => candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

    if (!projectPackage || !gate) {
      return null;
    }

    if (gate.status === "approved" || gate.status === "approved_with_actions") {
      gate.status = "not_submitted";
      projectPackage.updatedAt = new Date().toISOString();
      await writePackagesFile(packages);
    }

    return projectPackage;
  });
}

export async function returnPackageToPreviousStage(projectId: string, packageId: string) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const index = packages.findIndex(
      (projectPackage) => projectPackage.projectId === projectId && projectPackage.id === packageId,
    );

    if (index === -1) {
      return null;
    }

    if (
      packages[index].gates.some(
        (gate) => gate.status === "submitted_for_approval",
      )
    ) {
      return packages[index];
    }

    const previousStage = getPreviousPackageStage(packages[index].currentStage);

    if (!previousStage) {
      return packages[index];
    }

    const updatedPackage: ProjectPackage = {
      ...packages[index],
      currentStage: previousStage,
      updatedAt: new Date().toISOString(),
    };

    packages[index] = updatedPackage;
    await writePackagesFile(packages);

    return updatedPackage;
  });
}

export async function createPackageGateApprover(
  projectId: string,
  packageId: string,
  gateId: string,
  input: GateApproverInput,
) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const projectPackage = packages.find(
      (candidate) => candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

    if (!projectPackage || !gate || !isGateInPreparation(gate)) {
      return null;
    }

    const approver: GateApprover = {
      id: randomUUID(),
      ...input,
    };

    gate.approvers.push(approver);
    projectPackage.updatedAt = new Date().toISOString();
    await writePackagesFile(packages);
    return approver;
  });
}

export async function updatePackageGateApprover(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
  input: GateApproverInput,
) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const projectPackage = packages.find(
      (candidate) => candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);
    const approverIndex = gate?.approvers.findIndex(
      (approver) => approver.id === approverId,
    ) ?? -1;

    if (!projectPackage || !gate || !isGateInPreparation(gate) || approverIndex === -1) {
      return null;
    }

    const approver: GateApprover = {
      id: approverId,
      ...input,
    };

    gate.approvers[approverIndex] = approver;
    projectPackage.updatedAt = new Date().toISOString();
    await writePackagesFile(packages);
    return approver;
  });
}

export async function deletePackageGateApprover(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const projectPackage = packages.find(
      (candidate) => candidate.projectId === projectId && candidate.id === packageId,
    );
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);
    const approverIndex = gate?.approvers.findIndex(
      (approver) => approver.id === approverId,
    ) ?? -1;

    if (!projectPackage || !gate || !isGateInPreparation(gate) || approverIndex === -1) {
      return false;
    }

    gate.approvers.splice(approverIndex, 1);
    projectPackage.updatedAt = new Date().toISOString();
    await writePackagesFile(packages);
    return true;
  });
}

export async function createPackageGateCriterion(
  projectId: string,
  packageId: string,
  gateId: string,
  input: GateCriterionInput,
) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const packageIndex = packages.findIndex(
      (projectPackage) => projectPackage.projectId === projectId && projectPackage.id === packageId,
    );

    if (packageIndex === -1) {
      return null;
    }

    const gate = packages[packageIndex].gates.find((gate) => gate.id === gateId);

    if (!gate || !isGateInPreparation(gate)) {
      return null;
    }

    const criterion: GateCriterion = {
      id: randomUUID(),
      templateId: null,
      ...input,
    };

    gate.criteria.push(criterion);
    packages[packageIndex].updatedAt = new Date().toISOString();
    await writePackagesFile(packages);
    return criterion;
  });
}

export async function updatePackageGateCriterion(
  projectId: string,
  packageId: string,
  gateId: string,
  criterionId: string,
  input: GateCriterionInput,
) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const packageIndex = packages.findIndex(
      (projectPackage) => projectPackage.projectId === projectId && projectPackage.id === packageId,
    );

    if (packageIndex === -1) {
      return null;
    }

    const gate = packages[packageIndex].gates.find((gate) => gate.id === gateId);
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
    packages[packageIndex].updatedAt = new Date().toISOString();
    await writePackagesFile(packages);
    return criterion;
  });
}

export async function deletePackageGateCriterion(
  projectId: string,
  packageId: string,
  gateId: string,
  criterionId: string,
) {
  return withGateWorkflowLock(async () => {
    const packages = await readPackagesFile();
    const packageIndex = packages.findIndex(
      (projectPackage) => projectPackage.projectId === projectId && projectPackage.id === packageId,
    );

    if (packageIndex === -1) {
      return false;
    }

    const gate = packages[packageIndex].gates.find((gate) => gate.id === gateId);
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
    packages[packageIndex].updatedAt = new Date().toISOString();
    await writePackagesFile(packages);
    await removeCriterionFromDeliverables(criterionId);
    return true;
  });
}

export async function deletePackage(projectId: string, packageId: string) {
  const packages = await readPackagesFile();
  const remainingPackages = packages.filter(
    (projectPackage) => !(projectPackage.projectId === projectId && projectPackage.id === packageId),
  );

  if (remainingPackages.length === packages.length) {
    return false;
  }

  await writePackagesFile(remainingPackages);
  return true;
}

export async function deletePackagesForProject(projectId: string) {
  const packages = await readPackagesFile();
  const remainingPackages = packages.filter((projectPackage) => projectPackage.projectId !== projectId);

  if (remainingPackages.length === packages.length) {
    return;
  }

  await writePackagesFile(remainingPackages);
}

export function parsePackageFormData(
  formData: FormData,
  { allowStageSelection = false }: { allowStageSelection?: boolean } = {},
): PackageFormInput {
  const currentStage = allowStageSelection
    ? String(formData.get("currentStage") ?? "definition")
    : "definition";
  const status = String(formData.get("status") ?? "not_assessed");
  const executionModel = String(formData.get("executionModel") ?? "");

  if (!packageStageIds.includes(currentStage as PackageStageId)) {
    throw new Error("Invalid package stage.");
  }

  if (!packageStatuses.includes(status as PackageStatus)) {
    throw new Error("Invalid package status.");
  }

  if (executionModel && !packageExecutionModels.includes(executionModel as PackageExecutionModel)) {
    throw new Error("Invalid package execution model.");
  }

  const input: PackageFormInput = {
    packageCode: String(formData.get("packageCode") ?? "").trim(),
    packageName: String(formData.get("packageName") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    packageOwner: String(formData.get("packageOwner") ?? "").trim(),
    executionModel: executionModel ? (executionModel as PackageExecutionModel) : null,
    currentStage: currentStage as PackageStageId,
    status: status as PackageStatus,
    targetDeliveryDate: String(formData.get("targetDeliveryDate") ?? ""),
  };

  if (!input.packageCode || !input.packageName || !input.packageOwner) {
    throw new Error("Package code, package name, and package owner are required.");
  }

  return input;
}

function assertUniquePackageCode(
  packages: ProjectPackage[],
  projectId: string,
  packageCode: string,
  ignoredPackageId?: string,
) {
  const normalizedCode = packageCode.toLocaleLowerCase();
  const duplicate = packages.some(
    (projectPackage) =>
      projectPackage.projectId === projectId &&
      projectPackage.id !== ignoredPackageId &&
      projectPackage.packageCode.toLocaleLowerCase() === normalizedCode,
  );

  if (duplicate) {
    throw new Error("Package code must be unique within the Project.");
  }
}

function normalizePackage(projectPackage: Partial<ProjectPackage>): ProjectPackage {
  const id = projectPackage.id ?? randomUUID();
  const currentStage = packageStageIds.includes(projectPackage.currentStage as PackageStageId)
    ? (projectPackage.currentStage as PackageStageId)
    : "definition";
  const status = packageStatuses.includes(projectPackage.status as PackageStatus)
    ? (projectPackage.status as PackageStatus)
    : "not_assessed";
  const executionModel = packageExecutionModels.includes(projectPackage.executionModel as PackageExecutionModel)
    ? (projectPackage.executionModel as PackageExecutionModel)
    : null;
  const now = new Date().toISOString();

  return {
    id,
    projectId: projectPackage.projectId ?? "",
    packageCode: projectPackage.packageCode ?? "",
    packageName: projectPackage.packageName ?? "",
    description: projectPackage.description ?? "",
    packageOwner: projectPackage.packageOwner ?? "",
    executionModel,
    currentStage,
    gates: normalizeGates(id, projectPackage.gates, packageGateTemplates),
    status,
    targetDeliveryDate: projectPackage.targetDeliveryDate ?? "",
    createdAt: projectPackage.createdAt ?? now,
    updatedAt: projectPackage.updatedAt ?? projectPackage.createdAt ?? now,
  };
}

async function ensurePackageDefaultDeliverables(projectPackage: ProjectPackage) {
  await ensureDefaultDeliverables({
    projectId: projectPackage.projectId,
    packageId: projectPackage.id,
    gates: projectPackage.gates,
    templates: packageGateTemplates,
  });
}
