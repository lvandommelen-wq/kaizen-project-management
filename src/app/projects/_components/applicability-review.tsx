import Link from "next/link";
import type { Deliverable } from "@/lib/deliverables";
import {
  applicabilityLabels,
  applicabilityValues,
  type Applicability,
} from "@/lib/gates";
import type { ApplicabilityChange, ApplicabilityItemType } from "@/lib/applicability";
import { ApplicabilityDecisionForm } from "./applicability-decision-form";

type FormAction = (formData: FormData) => void | Promise<void>;

type ReviewGate = {
  gate: {
    id: string;
    name: string;
    stageId: string;
    status: string;
    deliverableConfigurationLocked: boolean;
    deliverableCompletionLocked: boolean;
  };
  stageLabel: string;
  deliverables: Deliverable[];
};

export function ApplicabilityReview({
  backHref,
  backLabel,
  canEdit,
  changes,
  createAction,
  deleteAction,
  gates,
  methodologyApproved,
  methodologyAwaitingApproval,
  scopeLabel,
  updateAction,
  filter,
  stageFilter,
  gateFilter,
  finalLifecycleReview,
  gateHref,
}: {
  backHref: string;
  backLabel: string;
  canEdit: boolean;
  changes: ApplicabilityChange[];
  createAction: (gateId: string, itemType: ApplicabilityItemType) => FormAction;
  deleteAction: (gateId: string, itemType: ApplicabilityItemType, itemId: string) => FormAction;
  gates: ReviewGate[];
  methodologyApproved: boolean;
  methodologyAwaitingApproval: boolean;
  scopeLabel: string;
  updateAction: (gateId: string, itemType: ApplicabilityItemType, itemId: string) => FormAction;
  filter: Applicability | "all";
  stageFilter?: string;
  gateFilter?: string;
  finalLifecycleReview: boolean;
  gateHref: (gateId: string) => string;
}) {
  const allItems = gates.flatMap(({ deliverables }) => deliverables);
  const applicableCount = allItems.filter((item) => item.applicability === "applicable").length;
  const notApplicableCount = allItems.length - applicableCount;
  const visibleGates = gates.filter(({ gate }) =>
    (!stageFilter || gate.stageId === stageFilter) && (!gateFilter || gate.id === gateFilter));
  const reviewedStageLabel = stageFilter
    ? gates.find(({ gate }) => gate.stageId === stageFilter)?.stageLabel
    : null;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>{scopeLabel} applicability review</h1>
          <p className="page-description">
            Tailor the instantiated Stage-Gate requirements. Completion remains managed on each Gate page.
          </p>
          {finalLifecycleReview ? (
            <p className="mt-2 text-sm font-semibold text-blue-800">
              Reviewing Scope: Complete active lifecycle matrix
            </p>
          ) : reviewedStageLabel ? (
            <p className="mt-2 text-sm font-semibold text-blue-800">
              Reviewing Stage: {reviewedStageLabel}
            </p>
          ) : null}
        </div>
        <Link href={backHref} className="button-secondary">{backLabel}</Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xl font-semibold text-slate-950">
              {applicableCount} Applicable <span aria-hidden="true">&middot;</span> {notApplicableCount} Not Applicable
            </div>
            <p className="mt-1 text-sm text-slate-600">{allItems.length} Deliverables across the active lifecycle</p>
          </div>
        </div>
        {methodologyApproved ? (
          <p className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-700">
            This methodology has formal approval. Protected submitted or approved Stages are read-only; permitted
            changes to unprotected future Stages are recorded and leave approved snapshots unchanged.
          </p>
        ) : null}
        {methodologyAwaitingApproval ? (
          <p className="mt-3 border-t border-amber-200 pt-3 text-sm font-medium text-amber-900">
            Editing is locked while the methodology Gate Review is awaiting approval.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {(["all", ...applicabilityValues] as const).map((value) => (
            <Link
              key={value}
              href={filterHref(value, stageFilter, gateFilter, finalLifecycleReview)}
              className={filter === value ? "button-primary" : "button-secondary"}
            >
              {value === "all" ? "All" : applicabilityLabels[value]}
            </Link>
          ))}
        </div>
        <form method="get" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input type="hidden" name="status" value={filter} />
          {finalLifecycleReview ? <input type="hidden" name="review" value="final_lifecycle" /> : null}
          <select name="stage" defaultValue={stageFilter ?? ""} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="">All stages</option>
            {gates.map(({ gate, stageLabel }) => <option key={gate.stageId} value={gate.stageId}>{stageLabel}</option>)}
          </select>
          <select name="gate" defaultValue={gateFilter ?? ""} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="">All gates</option>
            {gates.map(({ gate }) => <option key={gate.id} value={gate.id}>{gate.name}</option>)}
          </select>
          <button className="button-secondary" type="submit">Apply filters</button>
        </form>
      </section>

      {visibleGates.map(({ gate, stageLabel, deliverables }) => {
        const visibleDeliverables = deliverables.filter((item) => filter === "all" || item.applicability === filter);
        const canEditStageConfiguration = canEdit && !gate.deliverableConfigurationLocked;
        if (visibleDeliverables.length === 0) return null;
        return (
          <section key={gate.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <div className="text-sm font-medium text-slate-600">{stageLabel}</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{gate.name}</h2>
              </div>
              <Link href={gateHref(gate.id)} className="button-secondary">
                {canEditStageConfiguration ? "Edit Stage Deliverables" : "View Stage Deliverables"}
              </Link>
            </header>
            {gate.deliverableCompletionLocked ? (
              <p className="border-b border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-900">
                This Stage&apos;s Deliverable configuration and completion evidence are protected by its
                submitted or approved Gate. {gate.status === "submitted_for_approval"
                  ? "Withdraw or return the Review Cycle before revising this Stage."
                  : "Formally reopen this Gate before revising this Stage."}
              </p>
            ) : gate.deliverableConfigurationLocked ? (
              <p className="border-b border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-900">
                This active Stage&apos;s configuration is protected by the preceding approved or submitted Gate.
                Applicability, justification, titles and composition are read-only; execution completion remains editable.
              </p>
            ) : null}
            <ItemSection
              title="Deliverables"
              items={visibleDeliverables.map((item) => ({
                ...item,
                completion: item.status.replaceAll("_", " "),
                completionStatus: item.status,
              }))}
              itemType="deliverable"
              canEdit={canEditStageConfiguration}
              updateAction={updateAction}
              deleteAction={deleteAction}
              changes={changes}
            />
            {canEditStageConfiguration ? (
              <div className="border-t border-slate-200 bg-slate-50 p-4">
                <AddItemForm action={createAction(gate.id, "deliverable")} itemType="deliverable" />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

type DisplayItem = {
  id: string;
  gateId: string;
  templateId: string | null;
  title: string;
  completion: string;
  completionStatus: Deliverable["status"];
  applicability: Applicability;
  applicabilityJustification: string | null;
  applicabilityLocked: boolean;
};

function ItemSection({ title, items, itemType, canEdit, updateAction, deleteAction, changes }: {
  title: string;
  items: DisplayItem[];
  itemType: ApplicabilityItemType;
  canEdit: boolean;
  updateAction: (gateId: string, itemType: ApplicabilityItemType, itemId: string) => FormAction;
  deleteAction: (gateId: string, itemType: ApplicabilityItemType, itemId: string) => FormAction;
  changes: ApplicabilityChange[];
}) {
  return (
    <div className="border-b border-slate-100 p-5 last:border-b-0">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-3">
        {[...items]
          .sort((left, right) => applicabilityPriority(left.applicability) - applicabilityPriority(right.applicability))
          .map((item) => {
          const itemChanges = changes.filter((change) =>
            change.itemType === itemType && change.itemId === item.id);
          return (
          <article
            key={item.id}
            className={`rounded-lg border p-4 ${applicabilityItemClass(item)}`}
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,2fr)] xl:items-start">
              <div className="min-w-0">
                <p className="font-medium text-slate-950">{item.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="status-pill status-not_assessed">{item.templateId ? "Default" : "Custom"}</span>
                  <span className={`status-pill ${applicabilityItemStatusClass(item)}`}>
                    {item.applicability === "not_applicable"
                      ? applicabilityLabels.not_applicable
                      : item.completion}
                  </span>
                </div>
              </div>
              <ApplicabilityDecisionForm
                action={updateAction(item.gateId, itemType, item.id)}
                applicability={item.applicability}
                canEdit={canEdit}
                justification={item.applicabilityJustification}
                locked={item.applicabilityLocked}
              />
            </div>
            {canEdit && !item.templateId ? (
              <form action={deleteAction(item.gateId, itemType, item.id)} className="mt-2 flex justify-end">
                <button type="submit" className="text-sm font-medium text-red-700 hover:underline">Remove custom item</button>
              </form>
            ) : null}
            {itemChanges.length > 0 ? (
              <details className="mt-3 text-sm text-slate-600">
                <summary className="cursor-pointer font-medium text-slate-700">
                  Decision history ({itemChanges.length})
                </summary>
                <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4">
                  {itemChanges.map((change) => (
                    <li key={change.id}>
                      <span className="font-medium text-slate-800">
                        {change.previousApplicability
                          ? `${applicabilityLabels[change.previousApplicability]} → `
                          : "Created as "}
                        {applicabilityLabels[change.applicability]}
                      </span>
                      {` by ${change.changedByDisplayName} on ${new Date(change.changedAt).toLocaleString()}`}
                      {change.justification ? <div>Justification: {change.justification}</div> : null}
                      {change.changeReason ? <div>Reason: {change.changeReason}</div> : null}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </article>
          );
        })}
      </div>
    </div>
  );
}

function AddItemForm({ action, itemType }: { action: FormAction; itemType: ApplicabilityItemType }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Add custom {itemType}</summary>
      <form action={action} className="mt-3 space-y-3">
        <input name="title" required placeholder="Deliverable title" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
        <button type="submit" className="button-secondary">Add Deliverable</button>
      </form>
    </details>
  );
}

function applicabilityPriority(value: Applicability) {
  return value === "not_applicable" ? 0 : 1;
}

function applicabilityItemClass(item: DisplayItem) {
  if (item.applicability === "not_applicable") {
    return "border-slate-300 bg-slate-100/80";
  }
  if (item.completionStatus === "completed") {
    return "border-emerald-200 bg-emerald-50/50";
  }
  return "border-amber-200 bg-amber-50/70";
}

function applicabilityItemStatusClass(item: DisplayItem) {
  if (item.applicability === "not_applicable") return "status-not_assessed";
  if (item.completionStatus === "completed") return "status-green";
  return "status-amber";
}

function filterHref(
  status: Applicability | "all",
  stage?: string,
  gate?: string,
  finalLifecycleReview = false,
) {
  const query = new URLSearchParams();
  query.set("status", status);
  if (stage) query.set("stage", stage);
  if (gate) query.set("gate", gate);
  if (finalLifecycleReview) query.set("review", "final_lifecycle");
  return `?${query}`;
}
