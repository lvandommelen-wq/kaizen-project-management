import Link from "next/link";
import { getAuthorizedActionNavigation } from "@/lib/action-register";
import { getAuthorizedPackageNavigation } from "@/lib/package-access";
import type { PackageAccessModule } from "@/lib/access-permissions";
import { canCreateProject, requireInternalUser } from "@/lib/authorization";
import { ClickableTableRow } from "./_components/clickable-table-row";
import { getProjects, getProjectStatus, projectStageLabels, projectStatusLabels } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireInternalUser();
  const [projects, actionNavigation, packageNavigation, mayCreateProject] = await Promise.all([
    getProjects(user.id),
    getAuthorizedActionNavigation(user),
    getAuthorizedPackageNavigation(user),
    canCreateProject(user),
  ]);
  const membershipProjectIds = new Set(projects.map((project) => project.id));
  const delegatedActionNavigation = actionNavigation
    .filter((entry) => !membershipProjectIds.has(entry.projectId) && entry.canOpenProjectRegister)
    .map((entry) => ({ ...entry, packages: [] }));
  const delegatedPackageNavigation = packageNavigation.filter(
    (entry) => !membershipProjectIds.has(entry.projectId),
  );

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">All projects</p>
          <h1>Project overview</h1>
          <p className="page-description">
            Manage the basic project register for technical CAPEX execution.
          </p>
        </div>
        {mayCreateProject ? (
          <Link href="/projects/new" className="button-primary">
            New project
          </Link>
        ) : null}
      </div>

      {projects.length === 0
        && delegatedActionNavigation.length === 0
        && delegatedPackageNavigation.length === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">No projects yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {mayCreateProject
              ? "Create the first project to start building the CAPEX project register."
              : "No Project or Package access has been assigned to you."}
          </p>
          {mayCreateProject ? (
            <Link href="/projects/new" className="button-primary mt-6 inline-flex">
              Create project
            </Link>
          ) : null}
        </section>
      ) : projects.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div>
            <table className="projects-table w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th>Number</th>
                  <th>Project</th>
                  <th>Customer / location</th>
                  <th>Project manager</th>
                  <th>Reports to</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Planned start</th>
                  <th>Planned completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {projects.map((project) => {
                  const status = getProjectStatus();

                  return (
                    <ClickableTableRow key={project.id} href={`/projects/${project.id}`}>
                      <td data-label="Number" className="font-medium text-slate-950">
                        {project.projectNumber}
                      </td>
                      <td data-label="Project">
                        <Link href={`/projects/${project.id}`} className="font-semibold text-slate-950 hover:underline">
                          {project.name}
                        </Link>
                      </td>
                      <td data-label="Customer / location">
                        <div className="font-medium text-slate-900">{project.customer || "Not set"}</div>
                        <div className="mt-1 text-xs text-slate-500">{project.siteLocation || "Not set"}</div>
                      </td>
                      <td data-label="Project manager">{project.projectManager}</td>
                      <td data-label="Reports to">{project.reportsTo || "Not set"}</td>
                      <td data-label="Stage">{projectStageLabels[project.currentStage]}</td>
                      <td data-label="Status">
                        <span className={`status-pill status-${status}`}>
                          {projectStatusLabels[status]}
                        </span>
                      </td>
                      <td data-label="Planned start">
                        {formatProjectDate(project.plannedStartDate)}
                      </td>
                      <td data-label="Planned completion">
                        {formatProjectDate(project.plannedCompletionDate)}
                      </td>
                    </ClickableTableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {delegatedActionNavigation.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Authorized Action Registers</h2>
            <p className="mt-1 text-sm text-slate-600">
              Direct links to Action scopes shared with you. Other Project information remains restricted.
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {delegatedActionNavigation.map((entry) => (
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={entry.projectId}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {entry.projectNumber}
                </p>
                <h3 className="mt-1 font-semibold text-slate-950">{entry.projectName}</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    className="button-secondary"
                    href={`/projects/${entry.projectId}/actions`}
                  >
                    Authorized Project Actions
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {delegatedPackageNavigation.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Authorized packages</h2>
            <p className="mt-1 text-sm text-slate-600">
              Only explicitly authorized Package destinations are shown. Overall Project information remains restricted.
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {delegatedPackageNavigation.flatMap((entry) => entry.packages.map((projectPackage) => {
              const destination = packageNavigationDestination(entry.projectId, projectPackage);
              return (
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={projectPackage.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {entry.projectNumber}
                  </p>
                  <h3 className="mt-1 font-semibold text-slate-950">
                    {projectPackage.packageCode} — {projectPackage.packageName}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">{entry.projectName}</p>
                  {destination ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link className="button-secondary" href={destination.href}>
                        {destination.label}
                      </Link>
                    </div>
                  ) : null}
                </article>
              );
            }))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatProjectDate(value: string) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function packageNavigationDestination(
  projectId: string,
  projectPackage: {
    id: string;
    currentGateId: string | null;
    modules: PackageAccessModule[];
  },
) {
  const packageHref = `/projects/${projectId}/packages/${projectPackage.id}`;
  if (projectPackage.modules.includes("overview")) {
    return { href: packageHref, label: "Open package" };
  }
  if (projectPackage.modules.includes("deliverables")) {
    return { href: `${packageHref}/applicability`, label: "Deliverables" };
  }
  if (projectPackage.modules.includes("gate_reviews") && projectPackage.currentGateId) {
    return {
      href: `${packageHref}/gates/${encodeURIComponent(projectPackage.currentGateId)}`,
      label: "Current Gate",
    };
  }
  if (projectPackage.modules.includes("actions")) {
    return { href: `${packageHref}/actions`, label: "Action Register" };
  }
  return null;
}
