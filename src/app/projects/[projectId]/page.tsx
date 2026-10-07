import Link from "next/link";
import { notFound } from "next/navigation";
import { ClickableTableRow } from "../_components/clickable-table-row";
import { DeleteConfirmation } from "../_components/delete-confirmation";
import { LifecycleProgress } from "../_components/lifecycle-progress";
import {
  createProjectGovernanceTierAction,
  deleteProjectAction,
  deleteProjectGovernanceTierAction,
  moveProjectGovernanceTierAction,
  returnProjectToPreviousStageAction,
  updateProjectGovernanceTierAction,
} from "../actions";
import {
  formatPackageExecutionModel,
  getPackageLifecycle,
  getPackages,
  packageStageLabels,
  type ProjectPackage,
} from "@/lib/packages";
import {
  getPreviousProjectStage,
  getProject,
  getProjectLifecycle,
  projectStageLabels,
  type GovernanceTier,
} from "@/lib/projects";
import { getProjectActionDeletionBlocker } from "@/lib/project-actions";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    deleteError?: string | string[];
    tierError?: string | string[];
    tierId?: string | string[];
  }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const packages = await getPackages(project.id);
  const projectLifecycle = getProjectLifecycle(project.validationRequired);
  const previousStage = getPreviousProjectStage(project.currentStage, project.validationRequired);
  const currentGate = project.gates.find((gate) => gate.stageId === project.currentStage);
  const deletionBlocker = await getProjectActionDeletionBlocker(project.id);
  const returnAction = previousStage ? returnProjectToPreviousStageAction.bind(null, project.id) : null;
  const deleteAction = deleteProjectAction.bind(null, project.id);
  const tierError = queryValue(query.tierError);
  const tierErrorId = queryValue(query.tierId);
  const tierErrorRecord = project.governanceTiers.find(
    (tier) => tier.id === tierErrorId,
  );

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <h1>{project.projectNumber} - {project.name}</h1>
        </div>
        <div className="flex gap-3">
          <Link href="/projects" className="button-secondary">
            Projects
          </Link>
          <Link href={`/projects/${project.id}/edit`} className="button-secondary">
            Edit project
          </Link>
          <Link href={`/projects/${project.id}/actions`} className="button-secondary">
            Actions
          </Link>
          {!deletionBlocker ? (
            <DeleteConfirmation
              action={deleteAction}
              buttonLabel="Delete project"
              confirmLabel="Delete Project"
              message={`Are you sure you want to delete project ${project.projectNumber} - ${project.name}?`}
              title="Delete project"
            />
          ) : null}
        </div>
      </div>

      {deletionBlocker || query.deleteError === "protected-actions" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This Project cannot be deleted. {deletionBlocker ?? "It contains Gate Actions retained as finalized governance history."}
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Customer" value={project.customer} />
        <SummaryCard label="Project manager" value={project.projectManager} />
        <SummaryCard label="Current stage" value={projectStageLabels[project.currentStage]} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">Project lifecycle</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="status-pill status-not_assessed">{projectStageLabels[project.currentStage]}</span>
            {previousStage && returnAction ? (
              <form action={returnAction}>
                <button type="submit" className="button-secondary">
                  Return to {projectStageLabels[previousStage]}
                </button>
              </form>
            ) : null}
            {currentGate ? (
              <Link
                href={`/projects/${project.id}/gates/${encodeURIComponent(currentGate.id)}`}
                className="button-primary"
              >
                {currentGate.status === "not_submitted" ? "Prepare" : "View"} {currentGate.name}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-5">
          <LifecycleProgress
            stages={projectLifecycle}
            gates={project.gates}
            gatePath={`/projects/${project.id}/gates`}
            currentStageId={project.currentStage}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Project details</h2>
        <dl className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <Detail label="Project number" value={project.projectNumber} />
          <Detail label="Project name" value={project.name} />
          <Detail label="Customer" value={project.customer} />
          <Detail label="Project manager" value={project.projectManager} />
          <Detail label="Site / location" value={project.siteLocation} />
          <Detail label="Reports to" value={project.reportsTo} />
          <Detail label="Validation required" value={project.validationRequired ? "Yes" : "No"} />
          <Detail label="Planned start" value={project.plannedStartDate} />
          <Detail label="Planned completion" value={project.plannedCompletionDate} />
          <Detail label="Last updated" value={formatDateTime(project.updatedAt)} />
          <div className="md:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">
              {project.description || "No description entered."}
            </dd>
          </div>
        </dl>
      </section>

      <section
        id="governance-tiers"
        className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Governance Tiers</h2>
          <p className="mt-1 text-sm text-slate-600">
            Configure the ordered governance levels used by this Project and its registers.
          </p>
        </div>

        {tierError ? (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {tierError === "current-reference" ? (
              <>
                {tierErrorRecord ? `${tierErrorRecord.name} cannot be deleted` : "This Tier cannot be deleted"} because one or more Actions are currently assigned to it.{" "}
                <Link
                  href={`/projects/${project.id}/actions?governanceTierId=${encodeURIComponent(tierErrorId)}`}
                  className="font-semibold underline"
                >
                  View referenced Actions
                </Link>
              </>
            ) : (
              <>
                {tierErrorRecord ? `${tierErrorRecord.name} cannot be deleted` : "This Tier cannot be deleted"} because it is referenced by Action Update History.
              </>
            )}
          </p>
        ) : null}

        {project.governanceTiers.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No Governance Tiers are configured. Actions can remain Not assigned.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {project.governanceTiers.map((tier, index) => (
              <article key={tier.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Tier {tier.sequence}
                    </div>
                    <h3 className="mt-1 font-semibold text-slate-950">{tier.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {tier.description || "No description entered."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <form
                      action={moveProjectGovernanceTierAction.bind(
                        null,
                        project.id,
                        tier.id,
                        "up",
                      )}
                    >
                      <button
                        type="submit"
                        disabled={index === 0}
                        className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Move up
                      </button>
                    </form>
                    <form
                      action={moveProjectGovernanceTierAction.bind(
                        null,
                        project.id,
                        tier.id,
                        "down",
                      )}
                    >
                      <button
                        type="submit"
                        disabled={index === project.governanceTiers.length - 1}
                        className="button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Move down
                      </button>
                    </form>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 pt-4">
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                      Edit Tier
                    </summary>
                    <GovernanceTierForm
                      action={updateProjectGovernanceTierAction.bind(
                        null,
                        project.id,
                        tier.id,
                      )}
                      tier={tier}
                      submitLabel="Save Tier"
                    />
                  </details>
                  <DeleteConfirmation
                    action={deleteProjectGovernanceTierAction.bind(
                      null,
                      project.id,
                      tier.id,
                    )}
                    buttonLabel="Delete Tier"
                    confirmLabel="Delete Tier"
                    message={`Delete Tier ${tier.sequence} - ${tier.name}? Referenced Tiers cannot be deleted.`}
                    title="Delete Governance Tier"
                  />
                </div>
              </article>
            ))}
          </div>
        )}

        <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Add Governance Tier
          </summary>
          <GovernanceTierForm
            action={createProjectGovernanceTierAction.bind(null, project.id)}
            submitLabel="Add Tier"
          />
        </details>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Packages</h2>
            <p className="mt-1 text-sm text-slate-600">
              Packages progress independently and can be in different stages at the same time.
            </p>
          </div>
          <Link href={`/projects/${project.id}/packages/new`} className="button-primary">
            Add package
          </Link>
        </div>

        {packages.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">No Packages have been added to this Project yet.</div>
        ) : (
          <div>
            <table className="packages-table w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th>Package Code</th>
                  <th>Package Name</th>
                  <th>Package Owner</th>
                  <th>Execution Model</th>
                  <th>Current Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {packages.map((projectPackage) => (
                  <ClickableTableRow
                    key={projectPackage.id}
                    className="align-top"
                    href={`/projects/${project.id}/packages/${projectPackage.id}`}
                  >
                    <td data-label="Package Code" className="font-medium text-slate-950">{projectPackage.packageCode}</td>
                    <td data-label="Package Name">
                      <Link
                        href={`/projects/${project.id}/packages/${projectPackage.id}`}
                        className="font-semibold text-slate-950 hover:underline"
                      >
                        {projectPackage.packageName}
                      </Link>
                      {projectPackage.description ? (
                        <div className="mt-1 max-w-xs truncate text-xs text-slate-500">{projectPackage.description}</div>
                      ) : null}
                    </td>
                    <td data-label="Package Owner">{projectPackage.packageOwner}</td>
                    <td data-label="Execution Model">{formatPackageExecutionModel(projectPackage.executionModel)}</td>
                    <td data-label="Current Stage">
                      <div className="font-medium text-slate-900">{packageStageLabels[projectPackage.currentStage]}</div>
                      <PackageStageTrack projectPackage={projectPackage} />
                    </td>
                  </ClickableTableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function GovernanceTierForm({
  action,
  tier,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  tier?: GovernanceTier;
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Name
        <input
          name="name"
          required
          defaultValue={tier?.name}
          className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        Description
        <textarea
          name="description"
          rows={3}
          defaultValue={tier?.description}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm"
        />
      </label>
      <div className="flex justify-end md:col-span-2">
        <button type="submit" className="button-primary">{submitLabel}</button>
      </div>
    </form>
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

function queryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function PackageStageTrack({ projectPackage }: { projectPackage: ProjectPackage }) {
  const lifecycle = getPackageLifecycle();

  return (
    <div className="mt-2 flex gap-1" aria-label={`Package stage: ${packageStageLabels[projectPackage.currentStage]}`}>
      {lifecycle.map((stage) => (
        <span
          key={stage.id}
          title={stage.label}
          className={`h-2 flex-1 rounded-full ${stage.id === projectPackage.currentStage ? "bg-slate-900" : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}
