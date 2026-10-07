"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  createDeliverable,
  deleteDeliverable,
  parseDeliverableFormData,
  removeCriterionFromDeliverables,
  updateDeliverable,
} from "@/lib/deliverables";
import {
  isGateInPreparation,
  parseGateApproverFormData,
  parseGateCriterionFormData,
} from "@/lib/gates";
import {
  createPackageGateApprover,
  createPackageGateCriterion,
  deletePackageGateApprover,
  deletePackageGateCriterion,
  getPackage,
  getPackages,
  reopenPackageGate,
  submitPackageGateForApproval,
  updatePackageGateApprover,
  updatePackageGateCriterion,
} from "@/lib/packages";
import {
  createGateProjectAction,
  parseGateActionFormData,
  withGateWorkflowLock,
} from "@/lib/project-actions";
import {
  createProjectGateApprover,
  createProjectGateCriterion,
  deleteProjectGateApprover,
  deleteProjectGateCriterion,
  getProject,
  reopenProjectGate,
  submitProjectGateForApproval,
  updateProjectGateApprover,
  updateProjectGateCriterion,
} from "@/lib/projects";

export async function submitProjectGateForApprovalAction(projectId: string, gateId: string) {
  const result = await submitProjectGateForApproval(projectId, gateId);

  if (!result) {
    notFound();
  }

  if (result.outcome !== "submitted") {
    redirect(projectGatePath(projectId, gateId));
  }

  revalidateProjectGate(projectId, gateId);
  redirect(`${projectGatePath(projectId, gateId)}?submitted=${result.reviewCycle.cycleNumber}`);
}

export async function submitPackageGateForApprovalAction(
  projectId: string,
  packageId: string,
  gateId: string,
) {
  const result = await submitPackageGateForApproval(projectId, packageId, gateId);

  if (!result) {
    notFound();
  }

  if (result.outcome !== "submitted") {
    redirect(packageGatePath(projectId, packageId, gateId));
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(`${packageGatePath(projectId, packageId, gateId)}?submitted=${result.reviewCycle.cycleNumber}`);
}

export async function createProjectGateActionAction(projectId: string, gateId: string, formData: FormData) {
  await withGateWorkflowLock(async () => {
    const project = await getProject(projectId);
    const gate = project?.gates.find((candidate) => candidate.id === gateId);

    if (!project || !gate) notFound();
    if (gate.stageId !== project.currentStage || !isGateInPreparation(gate)) {
      redirect(projectGatePath(projectId, gateId));
    }

    const packages = await getPackages(project.id);
    const validPackageIds = new Set(packages.map((projectPackage) => projectPackage.id));
    const scope = String(formData.get("scope") ?? "project");
    const packageIds = scope === "project"
      ? []
      : [...new Set(formData.getAll("packageIds").map(String))];

    if (scope !== "project" && scope !== "packages") {
      throw new Error("Select Project-level or Package(s) scope.");
    }
    if (scope === "packages" && packageIds.length === 0) {
      throw new Error("Select at least one Package for Package scope.");
    }
    if (packageIds.some((packageId) => !validPackageIds.has(packageId))) {
      throw new Error("Invalid related Package.");
    }

    const parsed = parseGateActionFormData(formData);
    await createGateProjectAction(
      project.id,
      gate.id,
      packageIds,
      false,
      parsed.input,
      parsed.actor,
    );
  });
  revalidateProjectGate(projectId, gateId);
  revalidatePath(`/projects/${projectId}/actions`);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageGateActionAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  await withGateWorkflowLock(async () => {
    const projectPackage = await getPackage(projectId, packageId);
    const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

    if (!projectPackage || !gate) notFound();
    if (gate.stageId !== projectPackage.currentStage || !isGateInPreparation(gate)) {
      redirect(packageGatePath(projectId, packageId, gateId));
    }

    const parsed = parseGateActionFormData(formData);
    await createGateProjectAction(
      projectId,
      gate.id,
      [projectPackage.id],
      true,
      parsed.input,
      parsed.actor,
    );
  });
  revalidatePackageGate(projectId, packageId, gateId);
  revalidatePath(`/projects/${projectId}/actions`);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function reopenProjectGateAction(projectId: string, gateId: string) {
  const project = await reopenProjectGate(projectId, gateId);

  if (!project) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function reopenPackageGateAction(projectId: string, packageId: string, gateId: string) {
  const projectPackage = await reopenPackageGate(projectId, packageId, gateId);

  if (!projectPackage) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function createProjectGateApproverAction(projectId: string, gateId: string, formData: FormData) {
  const approver = await createProjectGateApprover(
    projectId,
    gateId,
    parseGateApproverFormData(formData),
  );

  if (!approver) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function updateProjectGateApproverAction(
  projectId: string,
  gateId: string,
  approverId: string,
  formData: FormData,
) {
  const approver = await updateProjectGateApprover(
    projectId,
    gateId,
    approverId,
    parseGateApproverFormData(formData),
  );

  if (!approver) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function deleteProjectGateApproverAction(
  projectId: string,
  gateId: string,
  approverId: string,
) {
  const deleted = await deleteProjectGateApprover(projectId, gateId, approverId);

  if (!deleted) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageGateApproverAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  const approver = await createPackageGateApprover(
    projectId,
    packageId,
    gateId,
    parseGateApproverFormData(formData),
  );

  if (!approver) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function updatePackageGateApproverAction(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
  formData: FormData,
) {
  const approver = await updatePackageGateApprover(
    projectId,
    packageId,
    gateId,
    approverId,
    parseGateApproverFormData(formData),
  );

  if (!approver) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function deletePackageGateApproverAction(
  projectId: string,
  packageId: string,
  gateId: string,
  approverId: string,
) {
  const deleted = await deletePackageGateApprover(projectId, packageId, gateId, approverId);

  if (!deleted) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function createProjectGateCriterionAction(projectId: string, gateId: string, formData: FormData) {
  await requireProjectGatePreparation(projectId, gateId);

  const criterion = await createProjectGateCriterion(projectId, gateId, parseGateCriterionFormData(formData));

  if (!criterion) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function updateProjectGateCriterionAction(
  projectId: string,
  gateId: string,
  criterionId: string,
  formData: FormData,
) {
  const criterion = await updateProjectGateCriterion(
    projectId,
    gateId,
    criterionId,
    parseGateCriterionFormData(formData),
  );

  if (!criterion) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function deleteProjectGateCriterionAction(
  projectId: string,
  gateId: string,
  criterionId: string,
) {
  const deleted = await deleteProjectGateCriterion(projectId, gateId, criterionId);

  if (!deleted) {
    notFound();
  }

  await removeCriterionFromDeliverables(criterionId);
  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageGateCriterionAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  await requirePackageGatePreparation(projectId, packageId, gateId);

  const criterion = await createPackageGateCriterion(
    projectId,
    packageId,
    gateId,
    parseGateCriterionFormData(formData),
  );

  if (!criterion) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function updatePackageGateCriterionAction(
  projectId: string,
  packageId: string,
  gateId: string,
  criterionId: string,
  formData: FormData,
) {
  const criterion = await updatePackageGateCriterion(
    projectId,
    packageId,
    gateId,
    criterionId,
    parseGateCriterionFormData(formData),
  );

  if (!criterion) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function deletePackageGateCriterionAction(
  projectId: string,
  packageId: string,
  gateId: string,
  criterionId: string,
) {
  const deleted = await deletePackageGateCriterion(projectId, packageId, gateId, criterionId);

  if (!deleted) {
    notFound();
  }

  await removeCriterionFromDeliverables(criterionId);
  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function createProjectDeliverableAction(projectId: string, gateId: string, formData: FormData) {
  const { gate } = await requireProjectGatePreparation(projectId, gateId);

  await createDeliverable(
    parseDeliverableFormData(formData, {
      projectId,
      packageId: null,
      gateId,
      stageId: gate.stageId,
      validCriterionIds: gate.criteria.map((criterion) => criterion.id),
    }),
  );

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function updateProjectDeliverableAction(
  projectId: string,
  gateId: string,
  deliverableId: string,
  formData: FormData,
) {
  const { gate } = await requireProjectGatePreparation(projectId, gateId);

  const deliverable = await updateDeliverable(
    deliverableId,
    parseDeliverableFormData(formData, {
      projectId,
      packageId: null,
      gateId,
      stageId: gate.stageId,
      validCriterionIds: gate.criteria.map((criterion) => criterion.id),
    }),
  );

  if (!deliverable) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function deleteProjectDeliverableAction(
  projectId: string,
  gateId: string,
  deliverableId: string,
) {
  await requireProjectGatePreparation(projectId, gateId);
  const deleted = await deleteDeliverable(deliverableId, { projectId, packageId: null, gateId });

  if (!deleted) {
    notFound();
  }

  revalidateProjectGate(projectId, gateId);
  redirect(projectGatePath(projectId, gateId));
}

export async function createPackageDeliverableAction(
  projectId: string,
  packageId: string,
  gateId: string,
  formData: FormData,
) {
  const { gate } = await requirePackageGatePreparation(projectId, packageId, gateId);

  await createDeliverable(
    parseDeliverableFormData(formData, {
      projectId,
      packageId,
      gateId,
      stageId: gate.stageId,
      validCriterionIds: gate.criteria.map((criterion) => criterion.id),
    }),
  );

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function updatePackageDeliverableAction(
  projectId: string,
  packageId: string,
  gateId: string,
  deliverableId: string,
  formData: FormData,
) {
  const { gate } = await requirePackageGatePreparation(projectId, packageId, gateId);

  const deliverable = await updateDeliverable(
    deliverableId,
    parseDeliverableFormData(formData, {
      projectId,
      packageId,
      gateId,
      stageId: gate.stageId,
      validCriterionIds: gate.criteria.map((criterion) => criterion.id),
    }),
  );

  if (!deliverable) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

export async function deletePackageDeliverableAction(
  projectId: string,
  packageId: string,
  gateId: string,
  deliverableId: string,
) {
  await requirePackageGatePreparation(projectId, packageId, gateId);
  const deleted = await deleteDeliverable(deliverableId, { projectId, packageId, gateId });

  if (!deleted) {
    notFound();
  }

  revalidatePackageGate(projectId, packageId, gateId);
  redirect(packageGatePath(projectId, packageId, gateId));
}

async function requireProjectGatePreparation(projectId: string, gateId: string) {
  const project = await getProject(projectId);
  const gate = project?.gates.find((candidate) => candidate.id === gateId);

  if (!project || !gate) notFound();
  if (!isGateInPreparation(gate)) redirect(projectGatePath(projectId, gateId));

  return { project, gate };
}

async function requirePackageGatePreparation(projectId: string, packageId: string, gateId: string) {
  const projectPackage = await getPackage(projectId, packageId);
  const gate = projectPackage?.gates.find((candidate) => candidate.id === gateId);

  if (!projectPackage || !gate) notFound();
  if (!isGateInPreparation(gate)) redirect(packageGatePath(projectId, packageId, gateId));

  return { projectPackage, gate };
}

function projectGatePath(projectId: string, gateId: string) {
  return `/projects/${projectId}/gates/${encodeURIComponent(gateId)}`;
}

function packageGatePath(projectId: string, packageId: string, gateId: string) {
  return `/projects/${projectId}/packages/${packageId}/gates/${encodeURIComponent(gateId)}`;
}

function revalidateProjectGate(projectId: string, gateId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(projectGatePath(projectId, gateId));
}

function revalidatePackageGate(projectId: string, packageId: string, gateId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/packages/${packageId}`);
  revalidatePath(packageGatePath(projectId, packageId, gateId));
}
