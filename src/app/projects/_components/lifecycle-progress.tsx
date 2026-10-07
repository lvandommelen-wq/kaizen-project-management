import Link from "next/link";
import type { CSSProperties } from "react";
import { gateStatusLabels, getAwaitingGateReviewCycle, isGateInPreparation, type Gate } from "@/lib/gates";

type LifecycleStage = {
  id: string;
  label: string;
};

type LifecycleProgressProps = {
  stages: LifecycleStage[];
  gates: Gate[];
  gatePath: string;
  currentStageId: string;
};

export function LifecycleProgress({ stages, gates, gatePath, currentStageId }: LifecycleProgressProps) {
  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);

  return (
    <ol className="grid gap-3 md:grid-cols-[repeat(var(--stage-count),minmax(0,1fr))]" style={{ "--stage-count": stages.length } as CSSProperties}>
      {stages.map((stage, index) => {
        const isCurrent = stage.id === currentStageId;
        const isComplete = currentIndex > index;
        const gate = gates.find((gate) => gate.stageId === stage.id);
        const awaitingReviewCycle = gate ? getAwaitingGateReviewCycle(gate) : null;
        const gateContent = gate ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-75">
              Gate - {gateStatusLabels[gate.status]}
            </div>
            <div className="mt-1 font-semibold leading-5">{gate.name}</div>
            {isCurrent || isComplete ? (
              <div className="mt-2 text-xs font-semibold underline">
                {awaitingReviewCycle
                  ? `View Review Cycle ${awaitingReviewCycle.cycleNumber}`
                  : isCurrent && gate.status === "returned_for_rework"
                    ? "Continue rework"
                    : isCurrent && isGateInPreparation(gate)
                      ? `Prepare ${gate.name}`
                      : "View Gate"}
              </div>
            ) : null}
          </>
        ) : null;

        return (
          <li key={stage.id} className="flex min-w-0 flex-col">
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                isCurrent
                  ? "border-slate-900 bg-slate-900 text-white"
                  : isComplete
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide opacity-75">
                {isCurrent ? "Current" : isComplete ? "Complete" : "Upcoming"}
              </div>
              <div className="mt-1 font-semibold">{stage.label}</div>
            </div>
            {gate ? (
              <>
                <div className="py-1 text-center text-slate-400" aria-hidden="true">&darr;</div>
                {isCurrent || isComplete ? (
                  <Link
                    href={`${gatePath}/${encodeURIComponent(gate.id)}`}
                    className={`${gateCardClass(gate.status)} transition-colors hover:brightness-95`}
                  >
                    {gateContent}
                  </Link>
                ) : (
                  <div className={gateCardClass(gate.status)}>{gateContent}</div>
                )}
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function gateCardClass(status: Gate["status"]) {
  const base = "rounded-lg border px-3 py-2 text-sm";

  if (status === "approved") {
    return `${base} border-emerald-200 bg-emerald-50 text-emerald-900`;
  }

  if (status === "approved_with_actions") {
    return `${base} border-amber-200 bg-amber-50 text-amber-950`;
  }

  if (status === "submitted_for_approval") {
    return `${base} border-amber-200 bg-amber-50 text-amber-950`;
  }

  if (status === "returned_for_rework") {
    return `${base} border-red-200 bg-red-50 text-red-900`;
  }

  return `${base} border-slate-200 bg-slate-50 text-slate-600`;
}
