import { notFound } from "next/navigation";
import { GateDetail } from "@/app/projects/_components/gate-detail";
import {
  createPackageDeliverableAction,
  createPackageGateActionAction,
  createPackageGateApproverAction,
  createPackageGateCriterionAction,
  deletePackageDeliverableAction,
  deletePackageGateApproverAction,
  deletePackageGateCriterionAction,
  reopenPackageGateAction,
  submitPackageGateForApprovalAction,
  updatePackageDeliverableAction,
  updatePackageGateApproverAction,
  updatePackageGateCriterionAction,
} from "@/app/projects/gate-actions";
import { getGateDeliverables } from "@/lib/deliverables";
import { getPackage, packageStageLabels } from "@/lib/packages";
import { getGateActions } from "@/lib/project-actions";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function PackageGatePage({
  params,
  searchParams,
}: PageProps<"/projects/[projectId]/packages/[packageId]/gates/[gateId]">) {
  const { projectId, packageId, gateId } = await params;
  const query = await searchParams;
  const resolvedGateId = decodeURIComponent(gateId);
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const projectPackage = await getPackage(project.id, packageId);
  const gate = projectPackage?.gates.find((gate) => gate.id === resolvedGateId);

  if (!projectPackage || !gate) {
    notFound();
  }

  const deliverables = await getGateDeliverables(project.id, projectPackage.id, gate.id);
  const gateActions = await getGateActions(project.id, gate.id);
  const submittedCycleNumber = parseCycleNumber(query.submitted);

  return (
    <GateDetail
      backHref={`/projects/${project.id}/packages/${projectPackage.id}`}
      backLabel="Package"
      contextLabel={`${projectPackage.packageCode} - ${projectPackage.packageName}`}
      actionRegisterHref={`/projects/${project.id}/actions?packageId=${encodeURIComponent(projectPackage.id)}`}
      createApproverAction={createPackageGateApproverAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      createCriterionAction={createPackageGateCriterionAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      createDeliverableAction={createPackageDeliverableAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      createGateActionAction={createPackageGateActionAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      deleteApproverAction={deletePackageGateApproverAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      deleteCriterionAction={deletePackageGateCriterionAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      deleteDeliverableAction={deletePackageDeliverableAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      deliverables={deliverables}
      gate={gate}
      gateActions={gateActions}
      gateActionPackageId={projectPackage.id}
      isCurrentGate={gate.stageId === projectPackage.currentStage}
      packages={[{
        id: projectPackage.id,
        label: `${projectPackage.packageCode} - ${projectPackage.packageName}`,
      }]}
      reopenAction={reopenPackageGateAction.bind(null, project.id, projectPackage.id, gate.id)}
      scopeLabel="Package"
      stageLabel={packageStageLabels[gate.stageId]}
      submissionAction={submitPackageGateForApprovalAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      submittedCycleNumber={submittedCycleNumber}
      updateApproverAction={updatePackageGateApproverAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      updateCriterionAction={updatePackageGateCriterionAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
      updateDeliverableAction={updatePackageDeliverableAction.bind(
        null,
        project.id,
        projectPackage.id,
        gate.id,
      )}
    />
  );
}

function parseCycleNumber(value: string | string[] | undefined) {
  const cycleNumber = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(cycleNumber) && cycleNumber > 0 ? cycleNumber : undefined;
}
