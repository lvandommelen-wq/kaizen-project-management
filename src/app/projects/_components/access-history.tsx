import type { AccessHistoryView } from "@/lib/access-management";

export function AccessHistory({ events }: { events: AccessHistoryView[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Access history</h2>
        <p className="mt-1 text-sm text-slate-600">Append-only record of permission changes.</p>
      </div>
      {events.length ? (
        <div className="mt-5 divide-y divide-slate-100">
          {events.map((event) => (
            <div className="grid gap-2 py-4 text-sm md:grid-cols-[10rem_1fr_1fr]" key={event.id}>
              <div className="text-slate-500">{formatTimestamp(event.occurredAt)}</div>
              <div>
                <p className="font-semibold text-slate-950">{event.targetName}</p>
                <p className="text-slate-600">{event.targetEmail}</p>
                <p className="mt-1 text-xs text-slate-500">Changed by {event.actorName}</p>
              </div>
              <div className="text-slate-700">
                <p className="font-medium">{eventLabel(event.eventType)}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {event.scopeLabel} · {event.authorityLabel} · Actions {event.permissionLabel}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No Access Management changes have been recorded.</p>
      )}
    </section>
  );
}

function eventLabel(eventType: string) {
  if (eventType === "access_grant.created") return "Access assigned";
  if (eventType === "access_grant.updated") return "Access changed";
  if (eventType === "access_grant.revoked") return "Access revoked";
  return "Access changed";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
