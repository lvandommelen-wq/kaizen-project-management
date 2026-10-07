import Link from "next/link";
import { ClickableTableRow } from "./_components/clickable-table-row";
import { getProjects, getProjectStatus, projectStageLabels, projectStatusLabels } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Project overview</h1>
          <p className="page-description">
            Manage the basic project register for technical CAPEX execution.
          </p>
        </div>
        <Link href="/projects/new" className="button-primary">
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">No projects yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Create the first project to start building the CAPEX project register.
          </p>
          <Link href="/projects/new" className="button-primary mt-6 inline-flex">
            Create project
          </Link>
        </section>
      ) : (
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
      )}
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
