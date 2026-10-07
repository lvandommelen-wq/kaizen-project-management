import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteConfirmation } from "../../../_components/delete-confirmation";
import { LifecycleProgress } from "../../../_components/lifecycle-progress";
import { deletePackageAction, returnPackageToPreviousStageAction } from "../actions";
import {
  formatPackageExecutionModel,
  getPackage,
  getPackageLifecycle,
  getPreviousPackageStage,
  packageStageLabels,
} from "@/lib/packages";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function PackageDetailPage({
  params,
  searchParams,
}: PageProps<"/projects/[projectId]/packages/[packageId]">) {
  const { projectId, packageId } = await params;
  const query = await searchParams;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const projectPackage = await getPackage(project.id, packageId);

  if (!projectPackage) {
    notFound();
  }

  const lifecycle = getPackageLifecycle();
  const previousStage = getPreviousPackageStage(projectPackage.currentStage);
  const currentGate = projectPackage.gates.find((gate) => gate.stageId === projectPackage.currentStage);
  const returnAction = previousStage
    ? returnPackageToPreviousStageAction.bind(null, project.id, projectPackage.id)
    : null;
  const deleteAction = deletePackageAction.bind(null, project.id, projectPackage.id);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{project.projectNumber} - {project.name}</p>
          <h1>{projectPackage.packageCode} - {projectPackage.packageName}</h1>
        </div>
        <div className="flex gap-3">
          <Link href={`/projects/${project.id}`} className="button-secondary">
            Project
          </Link>
          <Link href={`/projects/${project.id}/packages/${projectPackage.id}/edit`} className="button-secondary">
            Edit package
          </Link>
          <Link
            href={`/projects/${project.id}/actions?packageId=${encodeURIComponent(projectPackage.id)}`}
            className="button-secondary"
          >
            Actions
          </Link>
          <DeleteConfirmation
            action={deleteAction}
            buttonLabel="Delete package"
            confirmLabel="Delete Package"
            message={`Are you sure you want to delete package ${projectPackage.packageCode} - ${projectPackage.packageName}?`}
            title="Delete package"
          />
        </div>
      </div>

      {query.deleteError === "linked-actions" ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          This Package cannot be deleted while Actions remain associated with it. Review the
          {" "}
          <Link
            href={`/projects/${project.id}/actions?packageId=${encodeURIComponent(projectPackage.id)}`}
            className="font-semibold underline"
          >
            filtered Project Action Register
          </Link>
          .
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Package code" value={projectPackage.packageCode} />
        <SummaryCard label="Package owner" value={projectPackage.packageOwner} />
        <SummaryCard label="Execution model" value={formatPackageExecutionModel(projectPackage.executionModel)} />
        <SummaryCard label="Current stage" value={packageStageLabels[projectPackage.currentStage]} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Package lifecycle</h2>
            <p className="mt-1 text-sm text-slate-600">
              Package lifecycle is independent from the Project lifecycle and other Packages.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="status-pill status-not_assessed">{packageStageLabels[projectPackage.currentStage]}</span>
            {previousStage && returnAction ? (
              <form action={returnAction}>
                <button type="submit" className="button-secondary">
                  Return to {packageStageLabels[previousStage]}
                </button>
              </form>
            ) : null}
            {currentGate ? (
              <Link
                href={`/projects/${project.id}/packages/${projectPackage.id}/gates/${encodeURIComponent(currentGate.id)}`}
                className="button-primary"
              >
                {currentGate.status === "not_reviewed" ? "Review" : "View"} {currentGate.name}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-5">
          <LifecycleProgress
            stages={lifecycle}
            gates={projectPackage.gates}
            gatePath={`/projects/${project.id}/packages/${projectPackage.id}/gates`}
            currentStageId={projectPackage.currentStage}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Package details</h2>
        <dl className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <Detail label="Package code" value={projectPackage.packageCode} />
          <Detail label="Package name" value={projectPackage.packageName} />
          <Detail label="Package owner" value={projectPackage.packageOwner} />
          <Detail label="Execution model" value={formatPackageExecutionModel(projectPackage.executionModel)} />
          <Detail label="Last updated" value={formatDateTime(projectPackage.updatedAt)} />
          <div className="md:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">
              {projectPackage.description || "No description entered."}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value || "Not set"}</dd>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
