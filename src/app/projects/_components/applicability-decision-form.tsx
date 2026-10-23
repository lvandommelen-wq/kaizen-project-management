"use client";

import { useState } from "react";
import {
  applicabilityLabels,
  applicabilityValues,
  type Applicability,
} from "@/lib/gates";

type FormAction = (formData: FormData) => void | Promise<void>;

export function ApplicabilityDecisionForm({
  action,
  applicability,
  canEdit,
  justification,
  locked,
}: {
  action: FormAction;
  applicability: Applicability;
  canEdit: boolean;
  justification: string | null;
  locked: boolean;
}) {
  const [selected, setSelected] = useState(applicability);

  if (!canEdit) {
    return (
      <div className="text-sm">
        <span className="font-medium text-slate-900">{applicabilityLabels[applicability]}</span>
        {applicability === "not_applicable" ? (
          <p className="mt-1 text-slate-600">
            Justification: {justification || "Legacy decision — no historical justification recorded."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[11rem_minmax(12rem,1fr)_auto] sm:items-start">
      <select
        name="applicability"
        value={locked ? "applicable" : selected}
        disabled={locked}
        onChange={(event) => setSelected(event.target.value as Applicability)}
        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
      >
        {applicabilityValues.map((value) => (
          <option key={value} value={value}>{applicabilityLabels[value]}</option>
        ))}
      </select>
      {locked ? <input type="hidden" name="applicability" value="applicable" /> : null}
      {selected === "not_applicable" && !locked ? (
        <input
          name="justification"
          required
          defaultValue={justification ?? ""}
          placeholder="N/A justification"
          aria-label="N/A justification"
          className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-sm"
        />
      ) : <span className="hidden sm:block" />}
      <button type="submit" className="button-primary h-10">Save</button>
    </form>
  );
}
