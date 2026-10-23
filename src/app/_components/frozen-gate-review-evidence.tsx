import { formatTimestamp } from "@/lib/date-format";
import {
  getGateCriterionStatusLabel,
  type GateReviewCycle,
} from "@/lib/gates";
import { projectFrozenGateReviewEvidence } from "@/lib/gate-review-presentation";

export function FrozenGateReviewEvidence({ cycle }: { cycle: GateReviewCycle }) {
  const presentation = projectFrozenGateReviewEvidence(cycle);

  return (
    <div className="space-y-5">
      {presentation.kind === "stage_transition" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <EvidenceColumn
            heading="Current Stage — Completed Deliverables"
            metadata={(
              <dl>
                <Metadata label="Current Stage" value={presentation.currentStageLabel} />
              </dl>
            )}
            items={presentation.currentStageDeliverables}
            emptyLabel="No explicitly Applicable and Completed Deliverables were frozen for this Stage."
          />
          <EvidenceColumn
            heading="Next Stage — Agreed Deliverables"
            metadata={(
              <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <Metadata label="Reviewed Stage" value={presentation.reviewedStageLabel} />
                <Metadata label="Reviewer" value={presentation.reviewerName} />
                <Metadata label="Confirmed" value={formatTimestamp(presentation.confirmedAt)} />
              </dl>
            )}
            items={presentation.nextStageDeliverables}
            emptyLabel="No explicitly Applicable Deliverables were agreed for this Stage."
          />
        </div>
      ) : presentation.kind === "closure" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <h3 className="font-semibold text-emerald-950">Final Applicability Matrix — Confirmed</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <Metadata label="Reviewed Scope" value={presentation.reviewedScopeLabel} />
            <Metadata label="Reviewer" value={presentation.reviewerName} />
            <Metadata label="Confirmed" value={formatTimestamp(presentation.confirmedAt)} />
          </dl>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-950">Legacy frozen evidence</h3>
          <p className="mt-1 text-sm text-slate-700">{presentation.notice}</p>
        </div>
      )}

      {cycle.frozenEvidence.criteria.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Legacy Gate Criteria ({cycle.frozenEvidence.criteria.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {cycle.frozenEvidence.criteria.map((criterion) => (
              <li
                key={criterion.criterionId}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
              >
                <p className="font-medium text-slate-900">{criterion.description}</p>
                <p className="mt-1 text-slate-600">
                  {getGateCriterionStatusLabel(criterion.status)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EvidenceColumn({
  heading,
  metadata,
  items,
  emptyLabel,
}: {
  heading: string;
  metadata: React.ReactNode;
  items: Array<{ deliverableId: string; title: string }>;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-950">{heading}</h3>
      <div className="mt-3">{metadata}</div>
      {items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.deliverableId}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-900"
            >
              {item.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-500">{emptyLabel}</p>
      )}
    </section>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{value}</dd>
    </div>
  );
}
