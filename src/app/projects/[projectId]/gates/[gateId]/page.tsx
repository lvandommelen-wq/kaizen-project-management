import { notFound } from "next/navigation";
import { GateDetail } from "@/app/projects/_components/gate-detail";
import {
  createProjectDeliverableAction,
  createProjectGateActionAction,
  createProjectGateApproverAction,
  createProjectGateCriterionAction,
  deleteProjectDeliverableAction,
  deleteProjectGateApproverAction,
  deleteProjectGateCriterionAction,
  reopenProjectGateAction,
  submitProjectGateForApprovalAction,
  updateProjectDeliverableAction,
  updateProjectGateApproverAction,
  updateProjectGateCriterionAction,
} from "@/app/projects/gate-actions";
import { getGateDeliverables } from "@/lib/deliverables";
import { getPackages } from "@/lib/packages";
import { getGateActions } from "@/lib/project-actions";
import { getProject, projectStageLabels } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectGatePage({
  params,
  searchParams,
}: PageProps<"/projects/[projectId]/gates/[gateId]">) {
  const { projectId, gateId } = await params;
  const query = await searchParams;
  const resolvedGateId = decodeURIComponent(gateId);
  const project = await getProject(projectId);
  const gate = project?.gates.find((gate) => gate.id === resolvedGateId);

  if (!project || !gate) {
    notFound();
  }

  const packages = await getPackages(project.id);
  const deliverables = await getGateDeliverables(project.id, null, gate.id);
  const gateActions = await getGateActions(project.id, gate.id);
  const submittedCycleNumber = parseCycleNumber(query.submitted);

  return (
    <GateDetail
      backHref={`/projects/${project.id}`}
      backLabel="Project"
      contextLabel={`${project.projectNumber} - ${project.name}`}
      actionRegisterHref={`/projects/${project.id}/actions`}
      createApproverAction={createProjectGateApproverAction.bind(null, project.id, gate.id)}
      createCriterionAction={createProjectGateCriterionAction.bind(null, project.id, gate.id)}
      createDeliverableAction={createProjectDeliverableAction.bind(null, project.id, gate.id)}
      createGateActionAction={createProjectGateActionAction.bind(null, project.id, gate.id)}
      deleteApproverAction={deleteProjectGateApproverAction.bind(null, project.id, gate.id)}
      deleteCriterionAction={deleteProjectGateCriterionAction.bind(null, project.id, gate.id)}
      deleteDeliverableAction={deleteProjectDeliverableAction.bind(null, project.id, gate.id)}
      deliverables={deliverables}
      gate={gate}
      gateActions={gateActions}
      gateActionPackageId={null}
      isCurrentGate={gate.stageId === project.currentStage}
      packages={packages.map((projectPackage) => ({
        id: projectPackage.id,
        label: `${projectPackage.packageCode} - ${projectPackage.packageName}`,
      }))}
      reopenAction={reopenProjectGateAction.bind(null, project.id, gate.id)}
      scopeLabel="Project"
      stageLabel={projectStageLabels[gate.stageId]}
      submissionAction={submitProjectGateForApprovalAction.bind(null, project.id, gate.id)}
      submittedCycleNumber={submittedCycleNumber}
      updateApproverAction={updateProjectGateApproverAction.bind(null, project.id, gate.id)}
      updateCriterionAction={updateProjectGateCriterionAction.bind(null, project.id, gate.id)}
      updateDeliverableAction={updateProjectDeliverableAction.bind(null, project.id, gate.id)}
    />
  );
}

function parseCycleNumber(value: string | string[] | undefined) {
  const cycleNumber = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(cycleNumber) && cycleNumber > 0 ? cycleNumber : undefined;
}
