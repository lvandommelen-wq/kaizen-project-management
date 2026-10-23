import Link from "next/link";
import {
  addProjectActionUpdateAction,
  closeProjectActionAction,
  createManualProjectActionAction,
  deleteProjectActionAction,
  reopenProjectActionAction,
  updateProjectActionAction,
} from "@/app/projects/action-actions";
import { ConfirmationAction } from "@/app/projects/_components/confirmation-action";
import type {
  ActionRegisterPackage,
  ActionRegisterTier,
  ActionRegisterView,
  AuthorizedProjectAction,
} from "@/lib/action-register";
import {
  formatProjectActionId,
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
import {
  formatCalendarDate as formatDate,
  formatTimestamp as formatDateTime,
} from "@/lib/date-format";

export type ActionRegisterQuery = Record<string, string | string[] | undefined>;

type QuickView = "all" | "open" | "overdue" | "closed" | "gate";

export function ActionRegister({
  query,
  view: register,
}: {
  query: ActionRegisterQuery;
  view: ActionRegisterView;
}) {
  const today = currentDate();
  const quickView = getQuickView(value(query.view));
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
  const actions = register.actions;
  const filteredActions = actions.filter((action) =>
    matchesFilters(action, quickView, filters, today));
  const packageLabels = new Map(
    register.packages.map((projectPackage) => [
      projectPackage.id,
      projectPackage.packageCode,
    ]),
  );
  const gateLabels = new Map(register.gateLabels.map((gate) => [gate.id, gate.label]));
  const governanceTierLabels = new Map(
    register.governanceTiers.map((tier) => [tier.id, formatGovernanceTier(tier)]),
  );
  const filterTiers = register.governanceTiers.filter((tier) =>
    actions.some((action) => action.governanceTierId === tier.id));
  const assignees = unique(actions.map((action) => action.assignee));
  const loggedBy = unique(actions.map((action) => action.loggedBy.displayName));
  const returnQuery = normalizedQuery(query);
  const actionError = value(query.actionError);
  const errorAction = actions.find((action) => action.id === value(query.actionId));
  const writablePackages = register.packages.filter((projectPackage) =>
    register.writablePackageIds.includes(projectPackage.id));
  const canCreate = register.fixedPackage
    ? register.writablePackageIds.includes(register.fixedPackage.id)
    : register.canWriteOverall || writablePackages.length > 0;

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            {register.project.projectNumber} - {register.project.name}
          </p>
          <h1>
            {register.fixedPackage
              ? `${register.fixedPackage.packageCode} Action Register`
              : "Project Master Action Register"}
          </h1>
          {register.fixedPackage ? (
            <p className="page-description">{register.fixedPackage.packageName}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/projects" className="button-secondary">All projects</Link>
          {register.hasProjectMembership ? (
            <Link
              href={register.fixedPackage
                ? `/projects/${register.project.id}/packages/${register.fixedPackage.id}`
                : `/projects/${register.project.id}`}
              className="button-secondary"
            >
              {register.fixedPackage ? "Current package" : "Current project"}
            </Link>
          ) : null}
          {!register.hasProjectMembership && register.fixedPackage && register.canOpenFixedPackage ? (
            <Link
              href={`/projects/${register.project.id}/packages/${register.fixedPackage.id}`}
              className="button-secondary"
            >
              Current package
            </Link>
          ) : null}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Actions" value={String(actions.length)} />
        <SummaryCard
          label="Open"
          value={String(actions.filter(isProjectActionOpen).length)}
        />
        <SummaryCard
          label="Overdue"
          value={String(actions.filter((action) => isProjectActionOverdue(action, today)).length)}
        />
        <SummaryCard
          label="Closed"
          value={String(actions.filter((action) => action.status === "closed").length)}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Actions</h2>
            <p className="mt-1 text-sm text-slate-600">
              {register.fixedPackage
                ? "A fixed Package view of the central Project Action Register."
                : "One source of truth aggregated across your authorized scopes."}
            </p>
          </div>
          {!canCreate && actions.length > 0 ? (
            <span className="status-pill bg-slate-100 text-slate-700">Read only</span>
          ) : null}
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
              className={quickView === key ? "button-primary" : "button-secondary"}
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
            <input type="hidden" name="view" value={quickView} />
            <FilterInput label="Search ID or description" name="q" value={filters.search} />
            <FilterSelect label="Status" name="status" value={filters.status}>
              {projectActionStatuses.map((status) => (
                <option key={status} value={status}>{projectActionStatusLabels[status]}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Assignee" name="assignee" value={filters.assignee}>
              {assignees.map((assignee) => <option key={assignee}>{assignee}</option>)}
            </FilterSelect>
            {!register.fixedPackage ? (
              <FilterSelect label="Scope" name="packageId" value={filters.packageId}>
                {register.canReadOverall ? <option value="project">Overall Project</option> : null}
                {register.packages.map((projectPackage) => (
                  <option key={projectPackage.id} value={projectPackage.id}>
                    {projectPackage.packageCode} - {projectPackage.packageName}
                  </option>
                ))}
              </FilterSelect>
            ) : null}
            <FilterSelect
              label="Governance Tier"
              name="governanceTierId"
              value={filters.governanceTierId}
            >
              <option value="unassigned">Not assigned</option>
              {filterTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>{formatGovernanceTier(tier)}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Priority" name="priority" value={filters.priority}>
              <option value="none">Not set</option>
              {projectActionPriorities.map((priority) => (
                <option key={priority} value={priority}>{projectActionPriorityLabels[priority]}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Source" name="source" value={filters.source}>
              {projectActionSources.map((source) => (
                <option key={source} value={source}>{projectActionSourceLabels[source]}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Due" name="due" value={filters.due}>
              <option value="overdue">Overdue</option>
              <option value="due_today">Due today</option>
              <option value="upcoming">Upcoming</option>
              <option value="no_due_date">No due date</option>
            </FilterSelect>
            <FilterSelect label="Logged By" name="loggedBy" value={filters.loggedBy}>
              {loggedBy.map((name) => <option key={name}>{name}</option>)}
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
          <div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {filteredActions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                gateLabels={gateLabels}
                governanceTierLabels={governanceTierLabels}
                governanceTiers={register.governanceTiers}
                packageLabels={packageLabels}
                packages={writablePackages}
                projectId={register.project.id}
                fixedPackage={register.fixedPackage}
                canWriteOverall={register.canWriteOverall}
                returnQuery={returnQuery}
                today={today}
                showError={errorAction?.id === action.id}
              />
            ))}
          </div>
        )}

        {canCreate ? (
          <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              Add Manual Action
            </summary>
            <ActionForm
              action={createManualProjectActionAction.bind(
                null,
                register.project.id,
                register.fixedPackage?.id ?? null,
                returnQuery,
              )}
              canWriteOverall={register.canWriteOverall}
              fixedPackage={register.fixedPackage}
              governanceTiers={register.governanceTiers}
              packages={writablePackages}
              submitLabel="Add Action"
            />
          </details>
        ) : (
          <p className="mt-5 text-sm text-slate-600">
            You have read-only Actions access in this view.
          </p>
        )}
      </section>
    </div>
  );
}

function ActionRow({
  action,
  gateLabels,
  governanceTierLabels,
  governanceTiers,
  packageLabels,
  packages,
  projectId,
  fixedPackage,
  canWriteOverall,
  returnQuery,
  today,
  showError,
}: {
  action: AuthorizedProjectAction;
  gateLabels: Map<string, string>;
  governanceTierLabels: Map<string, string>;
  governanceTiers: ActionRegisterTier[];
  packageLabels: Map<string, string>;
  packages: ActionRegisterPackage[];
  projectId: string;
  fixedPackage: ActionRegisterPackage | null;
  canWriteOverall: boolean;
  returnQuery: string;
  today: string;
  showError: boolean;
}) {
  const overdue = isProjectActionOverdue(action, today);
  const packageId = action.packageIds[0] ?? null;
  const packageText = packageId
    ? packageLabels.get(packageId) ?? "Authorized Package"
    : "Overall Project";
  const protectedAction = action.gateDecisionReferences.length > 0;
  const fixedPackageId = fixedPackage?.id ?? null;

  return (
    <details id={`action-${action.id}`} className="group scroll-mt-6" open={showError}>
      <summary className="cursor-pointer list-none p-4 hover:bg-slate-50 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[7rem_minmax(0,1fr)_10rem_10rem] md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-500">
              {formatProjectActionId(action.sequence)}
            </span>
            {overdue ? <span className="status-pill status-red">Overdue</span> : null}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-950">{action.description}</p>
            <p className="mt-1 text-xs text-slate-500">
              {action.assignee} · {packageText} · {projectActionSourceLabels[action.source]}
            </p>
          </div>
          <span className={`status-pill w-fit ${statusClass(action)}`}>
            {projectActionStatusLabels[action.status]}
          </span>
          <div className="text-sm text-slate-600 md:text-right">
            <p>{formatDate(action.dueDate)}</p>
            <p className="mt-1 text-xs text-slate-500 group-open:hidden">Open details</p>
            <p className="mt-1 hidden text-xs text-slate-500 group-open:block">Close details</p>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5">
        <dl className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
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
            <Detail label="Related Gate" value={gateLabels.get(action.gateId) ?? "Related Gate"} />
          ) : null}
          <Detail
            label="Governance Tier"
            value={action.governanceTierId
              ? governanceTierLabels.get(action.governanceTierId) ?? "Unconfigured Governance Tier"
              : "Not assigned"}
          />
          <Detail label="Closing Date" value={formatDate(action.closingDate)} />
          <Detail
            label="Priority"
            value={action.priority ? projectActionPriorityLabels[action.priority] : "No priority"}
          />
          <Detail label="Last Updated" value={formatDateTime(action.lastUpdated)} />
        </dl>

        <details className="mt-4 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Comment and change history ({action.updates.length})
          </summary>
          <ol className="mt-4 space-y-3">
            {[...action.updates].reverse().map((update) => (
              <li key={update.id} className="rounded-lg bg-white p-3 text-sm">
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

        {action.canWrite ? (
          <>
            <details className="mt-4 border-t border-slate-200 pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Add comment
              </summary>
              <form
                action={addProjectActionUpdateAction.bind(
                  null,
                  projectId,
                  fixedPackageId,
                  returnQuery,
                  action.id,
                )}
                className="mt-4 grid gap-4"
              >
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Comment
                  <textarea name="updateText" required rows={3} className={textareaClass} />
                </label>
                <div className="flex justify-end">
                  <button type="submit" className="button-primary">Add comment</button>
                </div>
              </form>
            </details>

            <details className="mt-4 border-t border-slate-200 pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Edit Action
              </summary>
              <ActionForm
                action={updateProjectActionAction.bind(
                  null,
                  projectId,
                  fixedPackageId,
                  returnQuery,
                  action.id,
                )}
                canWriteOverall={canWriteOverall}
                existingAction={action}
                fixedPackage={fixedPackage}
                governanceTiers={governanceTiers}
                packages={packages}
                submitLabel="Save Action"
              />
            </details>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-slate-200 pt-4">
              <div>
                {protectedAction ? (
                  <p className="max-w-2xl text-sm text-slate-600">
                    This Action formed part of a finalized Gate decision. It can be updated and closed, but not deleted.
                  </p>
                ) : (
                  <ConfirmationAction
                    action={deleteProjectActionAction.bind(
                      null,
                      projectId,
                      fixedPackageId,
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
                    fixedPackageId,
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
                    fixedPackageId,
                    returnQuery,
                    action.id,
                  )}
                  mode="close"
                />
              )}
            </div>
          </>
        ) : (
          <p className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">
            Read-only access: comments and Action changes are unavailable.
          </p>
        )}
      </div>
    </details>
  );
}

function ActionForm({
  action,
  canWriteOverall,
  existingAction,
  fixedPackage,
  governanceTiers,
  packages,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  canWriteOverall: boolean;
  existingAction?: ProjectAction;
  fixedPackage: ActionRegisterPackage | null;
  governanceTiers: ActionRegisterTier[];
  packages: ActionRegisterPackage[];
  submitLabel: string;
}) {
  const scopeLocked = existingAction?.source === "gate"
    || existingAction?.packageAssociationLocked
    || Boolean(fixedPackage);
  const gateLocked = existingAction?.source === "gate";
  const isClosed = existingAction?.status === "closed";
  const currentPackageId = existingAction?.packageIds[0]
    ?? fixedPackage?.id
    ?? (canWriteOverall ? "" : packages[0]?.id ?? "");
  const destinations = [...packages];
  if (
    currentPackageId
    && !destinations.some((projectPackage) => projectPackage.id === currentPackageId)
    && fixedPackage?.id === currentPackageId
  ) {
    destinations.push(fixedPackage);
  }

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
          <input type="hidden" name="gateId" value={existingAction.gateId ?? ""} />
          <span className={`${inputClass} flex items-center bg-slate-100`}>Gate association fixed by source</span>
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
            <option key={tier.id} value={tier.id}>{formatGovernanceTier(tier)}</option>
          ))}
          {existingAction?.governanceTierId
          && !governanceTiers.some((tier) => tier.id === existingAction.governanceTierId) ? (
            <option value={existingAction.governanceTierId}>Unconfigured Governance Tier</option>
          ) : null}
        </select>
      </label>
      <fieldset className="rounded-lg border border-slate-200 bg-white px-4 py-3 md:col-span-2">
        <legend className="px-1 text-sm font-medium text-slate-700">Scope</legend>
        {scopeLocked ? (
          <>
            <input type="hidden" name="scopePackageId" value={currentPackageId} />
            <p className="text-sm text-slate-600">
              {currentPackageId
                ? `Fixed to ${fixedPackage?.packageCode ?? "the Gate Package"}.`
                : "Fixed to Overall Project by the Project Gate source."}
            </p>
          </>
        ) : (
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Action scope
            <select
              name="scopePackageId"
              defaultValue={currentPackageId}
              className={inputClass}
            >
              {canWriteOverall ? <option value="">Overall Project</option> : null}
              {destinations.map((projectPackage) => (
                <option key={projectPackage.id} value={projectPackage.id}>
                  {projectPackage.packageCode} - {projectPackage.packageName}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        {existingAction ? "Comment (optional)" : "Initial comment (optional)"}
        <textarea name="initialUpdate" rows={2} className={textareaClass} />
      </label>
      <div className="flex justify-end md:col-span-2">
        <button type="submit" className="button-primary">{submitLabel}</button>
      </div>
    </form>
  );
}

function TransitionForm({
  action,
  mode,
}: {
  action: (formData: FormData) => void | Promise<void>;
  mode: "close" | "reopen";
}) {
  return (
    <details className="min-w-72 rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        {mode === "close" ? "Close Action" : "Reopen Action"}
      </summary>
      <form action={action} className="mt-3 grid gap-3">
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

function FilterInput({
  label,
  name,
  value: defaultValue,
}: {
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <input name={name} defaultValue={defaultValue} className={inputClass} />
    </label>
  );
}

function FilterSelect({
  label,
  name,
  value: defaultValue,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
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

function Detail({
  label,
  value: detailValue,
  valueClassName = "text-slate-900",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 ${valueClassName}`}>{detailValue}</dd>
    </div>
  );
}

function matchesFilters(
  action: ProjectAction,
  quickView: QuickView,
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
  if (quickView === "open" && !isProjectActionOpen(action)) return false;
  if (quickView === "overdue" && !isProjectActionOverdue(action, today)) return false;
  if (quickView === "closed" && action.status !== "closed") return false;
  if (quickView === "gate" && action.source !== "gate") return false;
  if (
    search
    && !formatProjectActionId(action.sequence).toLowerCase().includes(search)
    && !action.description.toLowerCase().includes(search)
  ) return false;
  if (filters.status && action.status !== filters.status) return false;
  if (filters.assignee && action.assignee !== filters.assignee) return false;
  if (filters.packageId === "project" && action.packageIds.length > 0) return false;
  if (
    filters.packageId
    && filters.packageId !== "project"
    && action.packageIds[0] !== filters.packageId
  ) return false;
  if (filters.governanceTierId === "unassigned" && action.governanceTierId !== null) return false;
  if (
    filters.governanceTierId
    && filters.governanceTierId !== "unassigned"
    && action.governanceTierId !== filters.governanceTierId
  ) return false;
  if (filters.priority === "none" && action.priority !== null) return false;
  if (filters.priority && filters.priority !== "none" && action.priority !== filters.priority) return false;
  if (filters.source && action.source !== filters.source) return false;
  if (filters.loggedBy && action.loggedBy.displayName !== filters.loggedBy) return false;
  if (filters.due === "overdue" && !isProjectActionOverdue(action, today)) return false;
  if (filters.due === "due_today" && action.dueDate !== today) return false;
  if (
    filters.due === "upcoming"
    && (!action.dueDate || action.dueDate <= today || !isProjectActionOpen(action))
  ) return false;
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
        ? item.map((id) => packageLabels.get(id) ?? "Package").join(", ")
        : "Overall Project";
    }
    if (change.field === "governanceTierId") {
      return governanceTierLabels.get(item) ?? "Unconfigured Governance Tier";
    }
    return item || "Not set";
  };
  return `${change.field}: ${render(change.from)} → ${render(change.to)}`;
}

function formatGovernanceTier(tier: ActionRegisterTier) {
  return `Tier ${tier.sequence} - ${tier.name}`;
}

function statusClass(action: ProjectAction) {
  if (action.status === "closed") return "status-green";
  if (action.status === "finished") return "status-not_assessed";
  return "status-amber";
}

function getQuickView(input: string): QuickView {
  return ["all", "open", "overdue", "closed", "gate"].includes(input)
    ? input as QuickView
    : "all";
}

function normalizedQuery(query: ActionRegisterQuery) {
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
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : "";
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm";
const textareaClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm";
