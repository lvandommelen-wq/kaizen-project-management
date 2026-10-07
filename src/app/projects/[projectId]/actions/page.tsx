import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addProjectActionUpdateAction,
  closeProjectActionAction,
  createManualProjectActionAction,
  deleteProjectActionAction,
  reopenProjectActionAction,
  updateProjectActionAction,
} from "@/app/projects/action-actions";
import { ConfirmationAction } from "@/app/projects/_components/confirmation-action";
import { getPackages, type ProjectPackage } from "@/lib/packages";
import {
  formatProjectActionId,
  getProjectActions,
  isProjectActionOpen,
  isProjectActionOverdue,
  projectActionPriorities,
  projectActionPriorityLabels,
  projectActionSources,
  projectActionSourceLabels,
  projectActionStatusLabels,
  projectActionStatuses,
  type ProjectAction,
  type ProjectActionChange,
} from "@/lib/project-actions";
import { getProject, type GovernanceTier } from "@/lib/projects";

export const dynamic = "force-dynamic";

type GateOption = { id: string; label: string };
type Query = Record<string, string | string[] | undefined>;
type QuickView = "all" | "open" | "overdue" | "closed" | "gate";

export default async function ProjectActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Query>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const project = await getProject(projectId);
  if (!project) notFound();

  const packages = await getPackages(project.id);
  const actions = await getProjectActions(project.id);
  const today = currentDate();
  const view = getQuickView(value(query.view));
  const filters = {
    search: value(query.q).trim(),
    status: value(query.status),
    assignee: value(query.assignee),
    packageId: value(query.packageId),
    governanceTierId: value(query.governanceTierId),
    priority: value(query.priority),
    source: value(query.source),
    due: value(query.due),
    loggedBy: value(query.loggedBy),
  };
  const filteredActions = actions.filter((action) =>
    matchesFilters(action, view, filters, today),
  );
  const gateOptions: GateOption[] = [
    ...project.gates.map((gate) => ({
      id: gate.id,
      label: `Project - ${gate.name}`,
    })),
    ...packages.flatMap((projectPackage) =>
      projectPackage.gates.map((gate) => ({
        id: gate.id,
        label: `${projectPackage.packageCode} - ${gate.name}`,
      })),
    ),
  ];
  const packageLabels = new Map(
    packages.map((projectPackage) => [
      projectPackage.id,
      projectPackage.packageCode,
    ]),
  );
  const gateLabels = new Map(gateOptions.map((gate) => [gate.id, gate.label]));
  const assignees = unique(actions.map((action) => action.assignee));
  const loggedBy = unique(actions.map((action) => action.loggedBy.displayName));
  const governanceTierLabels = new Map(
    project.governanceTiers.map((tier) => [tier.id, formatGovernanceTier(tier)]),
  );
  const returnQuery = normalizedQuery(query);
  const actionError = value(query.actionError);
  const errorAction = actions.find((action) => action.id === value(query.actionId));

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            {project.projectNumber} - {project.name}
          </p>
          <h1>Project Master Action Register</h1>
        </div>
        <Link href={`/projects/${project.id}`} className="button-secondary">
          Project
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Actions" value={String(actions.length)} />
        <SummaryCard
          label="Open"
          value={String(actions.filter(isProjectActionOpen).length)}
        />
        <SummaryCard
          label="Overdue"
          value={String(
            actions.filter((action) => isProjectActionOverdue(action, today)).length,
          )}
        />
        <SummaryCard
          label="Closed"
          value={String(actions.filter((action) => action.status === "closed").length)}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Actions</h2>
          <p className="mt-1 text-sm text-slate-600">
            One Project-level source of truth throughout the Project lifecycle.
          </p>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Action quick views">
          {([
            ["all", "All"],
            ["open", "Open"],
            ["overdue", "Overdue"],
            ["closed", "Closed"],
            ["gate", "Gate Actions"],
          ] as const).map(([key, label]) => (
            <Link
              key={key}
              href={`?view=${key}`}
              className={view === key ? "button-primary" : "button-secondary"}
            >
              {label}
            </Link>
          ))}
        </nav>

        <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Search and filters
          </summary>
          <form method="get" className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <input type="hidden" name="view" value={view} />
            <FilterInput label="Search ID or description" name="q" value={filters.search} />
            <FilterSelect label="Status" name="status" value={filters.status}>
              {projectActionStatuses.map((status) => (
                <option key={status} value={status}>
                  {projectActionStatusLabels[status]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Assignee" name="assignee" value={filters.assignee}>
              {assignees.map((assignee) => (
                <option key={assignee}>{assignee}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Package" name="packageId" value={filters.packageId}>
              <option value="project">Project-level</option>
              {packages.map((projectPackage) => (
                <option key={projectPackage.id} value={projectPackage.id}>
                  {projectPackage.packageCode} - {projectPackage.packageName}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Governance Tier"
              name="governanceTierId"
              value={filters.governanceTierId}
            >
              <option value="unassigned">Not assigned</option>
              {project.governanceTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {formatGovernanceTier(tier)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Priority" name="priority" value={filters.priority}>
              <option value="none">Not set</option>
              {projectActionPriorities.map((priority) => (
                <option key={priority} value={priority}>
                  {projectActionPriorityLabels[priority]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Source" name="source" value={filters.source}>
              {projectActionSources.map((source) => (
                <option key={source} value={source}>
                  {projectActionSourceLabels[source]}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Due" name="due" value={filters.due}>
              <option value="overdue">Overdue</option>
              <option value="due_today">Due today</option>
              <option value="upcoming">Upcoming</option>
              <option value="no_due_date">No due date</option>
            </FilterSelect>
            <FilterSelect label="Logged By" name="loggedBy" value={filters.loggedBy}>
              {loggedBy.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </FilterSelect>
            <div className="flex items-end gap-3 md:col-span-2 xl:col-span-3">
              <button type="submit" className="button-primary">Apply filters</button>
              <Link href="?view=all" className="button-secondary">Reset</Link>
            </div>
          </form>
        </details>

        {actionError ? (
          <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
            {errorAction ? `${formatProjectActionId(errorAction.sequence)}: ` : ""}
            {actionError}
          </p>
        ) : null}

        {filteredActions.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No Actions match this view.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {filteredActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                gateLabels={gateLabels}
                governanceTierLabels={governanceTierLabels}
                governanceTiers={project.governanceTiers}
                packageLabels={packageLabels}
                packages={packages}
                projectId={project.id}
                returnQuery={returnQuery}
                today={today}
              />
            ))}
          </div>
        )}

        <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Add Manual Action
          </summary>
          <ActionForm
            action={createManualProjectActionAction.bind(
              null,
              project.id,
              returnQuery,
            )}
            governanceTiers={project.governanceTiers}
            packages={packages}
            submitLabel="Add Action"
          />
        </details>
      </section>
    </div>
  );
}

function ActionCard({
  action,
  gateLabels,
  governanceTierLabels,
  governanceTiers,
  packageLabels,
  packages,
  projectId,
  returnQuery,
  today,
}: {
  action: ProjectAction;
  gateLabels: Map<string, string>;
  governanceTierLabels: Map<string, string>;
  governanceTiers: GovernanceTier[];
  packageLabels: Map<string, string>;
  packages: ProjectPackage[];
  projectId: string;
  returnQuery: string;
  today: string;
}) {
  const overdue = isProjectActionOverdue(action, today);
  const packageText = action.packageIds.length
    ? action.packageIds
        .map((packageId) => packageLabels.get(packageId) ?? "Unknown Package")
        .join(", ")
    : "Project-level";
  const protectedAction = action.gateDecisionReferences.length > 0;

  return (
    <article className="rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-500">
              {formatProjectActionId(action.sequence)}
            </span>
            <span className={`status-pill ${statusClass(action)}`}>
              {projectActionStatusLabels[action.status]}
            </span>
            {overdue ? <span className="status-pill status-red">Overdue</span> : null}
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {projectActionSourceLabels[action.source]}
            </span>
          </div>
          <h3 className="mt-2 font-semibold text-slate-950">{action.description}</h3>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-slate-600">
            {action.priority ? projectActionPriorityLabels[action.priority] : "No priority"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Last updated {formatDateTime(action.lastUpdated)}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
        <Detail label="Assignee" value={action.assignee} />
        <Detail label="Logged By" value={action.loggedBy.displayName} />
        <Detail label="Date Logged" value={formatDate(action.dateLogged)} />
        <Detail
          label="Due Date"
          value={formatDate(action.dueDate)}
          valueClassName={overdue ? "text-red-700" : undefined}
        />
        <Detail label="Scope" value={packageText} />
        {action.gateId ? (
          <Detail
            label="Related Gate"
            value={gateLabels.get(action.gateId) ?? "Unknown Gate"}
          />
        ) : null}
        <Detail
          label="Governance Tier"
          value={action.governanceTierId
            ? governanceTierLabels.get(action.governanceTierId) ?? "Unconfigured Governance Tier"
            : "Not assigned"}
        />
        <Detail label="Closing Date" value={formatDate(action.closingDate)} />
      </dl>

      <details className="mt-4 border-t border-slate-100 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Update history ({action.updates.length})
        </summary>
        <ol className="mt-4 space-y-3">
          {[...action.updates].reverse().map((update) => (
            <li key={update.id} className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold text-slate-900">{update.actor.displayName}</span>
                <time className="text-slate-500">{formatDateTime(update.occurredAt)}</time>
              </div>
              <p className="mt-1 text-slate-700">{update.text}</p>
              {update.changes.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {update.changes.map((change, index) => (
                    <li key={`${change.field}-${index}`}>
                      {formatChange(change, packageLabels, governanceTierLabels)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </details>

      <details className="mt-4 border-t border-slate-100 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Add update
        </summary>
        <form
          action={addProjectActionUpdateAction.bind(
            null,
            projectId,
            returnQuery,
            action.id,
          )}
          className="mt-4 grid gap-4 md:grid-cols-2"
        >
          <ActorInput />
          <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
            Update
            <textarea name="updateText" required rows={3} className={textareaClass} />
          </label>
          <div className="flex justify-end md:col-span-2">
            <button type="submit" className="button-primary">Add update</button>
          </div>
        </form>
      </details>

      <details className="mt-4 border-t border-slate-100 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Edit Action
        </summary>
        <ActionForm
          action={updateProjectActionAction.bind(
            null,
            projectId,
            returnQuery,
            action.id,
          )}
          existingAction={action}
          governanceTiers={governanceTiers}
          packages={packages}
          submitLabel="Save Action"
        />
      </details>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 pt-4">
        <div>
          {protectedAction ? (
            <p className="max-w-2xl text-sm text-slate-600">
              This Action is retained because it formed part of a finalized Gate decision. It can be updated and closed, but not deleted.
            </p>
          ) : (
            <ConfirmationAction
              action={deleteProjectActionAction.bind(
                null,
                projectId,
                returnQuery,
                action.id,
              )}
              buttonLabel="Delete Action"
              confirmLabel="Delete Action"
              message={`Delete ${formatProjectActionId(action.sequence)} permanently? Its Action ID will not be reused.`}
              title="Delete Action"
            />
          )}
        </div>
        {action.status === "closed" ? (
          <TransitionForm
            action={reopenProjectActionAction.bind(
              null,
              projectId,
              returnQuery,
              action.id,
            )}
            mode="reopen"
          />
        ) : (
          <TransitionForm
            action={closeProjectActionAction.bind(
              null,
              projectId,
              returnQuery,
              action.id,
            )}
            mode="close"
          />
        )}
      </div>
    </article>
  );
}

function ActionForm({
  action,
  existingAction,
  governanceTiers,
  packages,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  existingAction?: ProjectAction;
  governanceTiers: GovernanceTier[];
  packages: ProjectPackage[];
  submitLabel: string;
}) {
  const packageScopeLocked = existingAction?.packageAssociationLocked ?? false;
  const gateLocked = existingAction?.source === "gate";
  const isClosed = existingAction?.status === "closed";

  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        Description
        <textarea
          name="description"
          required
          rows={3}
          defaultValue={existingAction?.description}
          className={textareaClass}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Assignee
        <input name="assignee" required defaultValue={existingAction?.assignee} className={inputClass} />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Due date
        <input type="date" name="dueDate" defaultValue={existingAction?.dueDate ?? ""} className={inputClass} />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Status
        {isClosed ? (
          <>
            <input type="hidden" name="status" value="closed" />
            <span className={`${inputClass} flex items-center bg-slate-100`}>Closed</span>
          </>
        ) : (
          <select name="status" defaultValue={existingAction?.status ?? "new"} className={inputClass}>
            {projectActionStatuses.filter((status) => status !== "closed").map((status) => (
              <option key={status} value={status}>{projectActionStatusLabels[status]}</option>
            ))}
          </select>
        )}
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Priority
        <select name="priority" defaultValue={existingAction?.priority ?? ""} className={inputClass}>
          <option value="">No priority</option>
          {projectActionPriorities.map((priority) => (
            <option key={priority} value={priority}>{projectActionPriorityLabels[priority]}</option>
          ))}
        </select>
      </label>
      {gateLocked ? (
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Related Gate
          <>
            <input type="hidden" name="gateId" value={existingAction.gateId ?? ""} />
            <span className={`${inputClass} flex items-center bg-slate-100`}>Gate association fixed by source</span>
          </>
        </label>
      ) : null}
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Governance Tier
        <select
          name="governanceTierId"
          defaultValue={existingAction?.governanceTierId ?? ""}
          className={inputClass}
        >
          <option value="">Not assigned</option>
          {governanceTiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {formatGovernanceTier(tier)}
            </option>
          ))}
          {existingAction?.governanceTierId &&
          !governanceTiers.some((tier) => tier.id === existingAction.governanceTierId) ? (
            <option value={existingAction.governanceTierId}>
              Unconfigured Governance Tier
            </option>
          ) : null}
        </select>
      </label>
      <fieldset className="rounded-lg border border-slate-200 bg-white px-4 py-3 md:col-span-2">
        <legend className="px-1 text-sm font-medium text-slate-700">Scope</legend>
        {packageScopeLocked ? (
          <>
            <input type="hidden" name="scope" value="packages" />
            {(existingAction?.packageIds ?? []).map((packageId) => (
              <input key={packageId} type="hidden" name="packageIds" value={packageId} />
            ))}
            <p className="text-sm text-slate-600">Package association fixed by the Package Gate source.</p>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-5 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input type="radio" name="scope" value="project" defaultChecked={!existingAction || existingAction.packageIds.length === 0} />
                Project-level
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="scope" value="packages" defaultChecked={Boolean(existingAction?.packageIds.length)} />
                Package(s)
              </label>
            </div>
            {packages.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {packages.map((projectPackage) => (
                  <label key={projectPackage.id} className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="packageIds"
                      value={projectPackage.id}
                      defaultChecked={existingAction?.packageIds.includes(projectPackage.id)}
                      className="mt-1 size-4 accent-slate-900"
                    />
                    {projectPackage.packageCode} - {projectPackage.packageName}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No Packages are available.</p>
            )}
          </div>
        )}
      </fieldset>
      {existingAction ? <ActorInput /> : null}
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        {existingAction ? "Update note (optional)" : "Initial update (optional)"}
        <textarea name="initialUpdate" rows={2} className={textareaClass} />
      </label>
      <div className="flex justify-end md:col-span-2">
        <button type="submit" className="button-primary">{submitLabel}</button>
      </div>
    </form>
  );
}

function TransitionForm({ action, mode }: { action: (formData: FormData) => void | Promise<void>; mode: "close" | "reopen" }) {
  return (
    <details className="min-w-72 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        {mode === "close" ? "Close Action" : "Reopen Action"}
      </summary>
      <form action={action} className="mt-3 grid gap-3">
        <ActorInput />
        {mode === "reopen" ? (
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Reopen as
            <select name="status" defaultValue="in_progress" className={inputClass}>
              <option value="new">New</option>
              <option value="in_progress">In Progress</option>
            </select>
          </label>
        ) : null}
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Comment (optional)
          <textarea name="comment" rows={2} className={textareaClass} />
        </label>
        <button type="submit" className="button-primary">
          {mode === "close" ? "Close Action" : "Reopen Action"}
        </button>
      </form>
    </details>
  );
}

function ActorInput({ label = "Updated by" }: { label?: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <input name="actorName" required className={inputClass} />
    </label>
  );
}

function FilterInput({ label, name, value: defaultValue }: { label: string; name: string; value: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <input name={name} defaultValue={defaultValue} className={inputClass} />
    </label>
  );
}

function FilterSelect({ label, name, value: defaultValue, children }: { label: string; name: string; value: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        <option value="">All</option>
        {children}
      </select>
    </label>
  );
}

function SummaryCard({ label, value: cardValue }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-lg font-semibold text-slate-950">{cardValue}</div>
    </div>
  );
}

function Detail({ label, value: detailValue, valueClassName = "text-slate-900" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 ${valueClassName}`}>{detailValue}</dd>
    </div>
  );
}

function matchesFilters(
  action: ProjectAction,
  view: QuickView,
  filters: {
    search: string;
    status: string;
    assignee: string;
    packageId: string;
    governanceTierId: string;
    priority: string;
    source: string;
    due: string;
    loggedBy: string;
  },
  today: string,
) {
  const search = filters.search.toLowerCase();
  if (view === "open" && !isProjectActionOpen(action)) return false;
  if (view === "overdue" && !isProjectActionOverdue(action, today)) return false;
  if (view === "closed" && action.status !== "closed") return false;
  if (view === "gate" && action.source !== "gate") return false;
  if (
    search &&
    !formatProjectActionId(action.sequence).toLowerCase().includes(search) &&
    !action.description.toLowerCase().includes(search)
  ) return false;
  if (filters.status && action.status !== filters.status) return false;
  if (filters.assignee && action.assignee !== filters.assignee) return false;
  if (filters.packageId === "project" && action.packageIds.length > 0) return false;
  if (filters.packageId && filters.packageId !== "project" && !action.packageIds.includes(filters.packageId)) return false;
  if (filters.governanceTierId === "unassigned" && action.governanceTierId !== null) return false;
  if (
    filters.governanceTierId &&
    filters.governanceTierId !== "unassigned" &&
    action.governanceTierId !== filters.governanceTierId
  ) return false;
  if (filters.priority === "none" && action.priority !== null) return false;
  if (filters.priority && filters.priority !== "none" && action.priority !== filters.priority) return false;
  if (filters.source && action.source !== filters.source) return false;
  if (filters.loggedBy && action.loggedBy.displayName !== filters.loggedBy) return false;
  if (filters.due === "overdue" && !isProjectActionOverdue(action, today)) return false;
  if (filters.due === "due_today" && action.dueDate !== today) return false;
  if (filters.due === "upcoming" && (!action.dueDate || action.dueDate <= today || !isProjectActionOpen(action))) return false;
  if (filters.due === "no_due_date" && action.dueDate !== null) return false;
  return true;
}

function formatChange(
  change: ProjectActionChange,
  packageLabels: Map<string, string>,
  governanceTierLabels: Map<string, string>,
) {
  const render = (item: string | string[] | null) => {
    if (item === null) return "Not set";
    if (Array.isArray(item)) {
      return item.length
        ? item.map((id) => packageLabels.get(id) ?? id).join(", ")
        : "Project-level";
    }
    if (change.field === "governanceTierId") {
      return governanceTierLabels.get(item) ?? "Unconfigured Governance Tier";
    }
    return item || "Not set";
  };
  return `${change.field}: ${render(change.from)} -> ${render(change.to)}`;
}

function formatGovernanceTier(tier: GovernanceTier) {
  return `Tier ${tier.sequence} - ${tier.name}`;
}

function statusClass(action: ProjectAction) {
  if (action.status === "closed") return "status-green";
  if (action.status === "finished") return "status-not_assessed";
  return "status-amber";
}

function getQuickView(input: string): QuickView {
  return ["all", "open", "overdue", "closed", "gate"].includes(input)
    ? (input as QuickView)
    : "all";
}

function normalizedQuery(query: Query) {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    if (key === "actionError" || key === "actionId") continue;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (item) params.append(key, item);
    }
  }
  return params.toString();
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : "";
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(input: string | null) {
  if (!input) return "Not set";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(input.length === 10 ? `${input}T00:00:00Z` : input));
}

function formatDateTime(input: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(input));
}

const inputClass = "h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm";
const textareaClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm";
