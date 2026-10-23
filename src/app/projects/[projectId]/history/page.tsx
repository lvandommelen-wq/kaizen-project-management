import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import { getProjectAuditEvents } from "@/lib/operational/postgres";
import { getProject } from "@/lib/projects";
import { getCurrentProjectRole } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function ProjectHistoryPage({
  params,
}: PageProps<"/projects/[projectId]/history">) {
  const { projectId } = await params;
  if (getOperationalDataBackend() !== "postgres") notFound();
  if (!await getCurrentProjectRole(projectId)) notFound();
  const [project, events] = await Promise.all([
    getProject(projectId),
    getProjectAuditEvents(projectId),
  ]);
  if (!project) notFound();

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div><p className="eyebrow">{project.projectNumber}</p><h1>Project history</h1><p className="page-description">Immutable governance and operational changes.</p></div>
        <Link href="/projects" className="button-secondary">All projects</Link>
        <Link href={`/projects/${projectId}`} className="button-secondary">Current project</Link>
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {events.length ? (
          <table className="w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">Related record</th><th className="px-4 py-3">Summary</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{events.map((event) => <tr key={event.id}><td className="px-4 py-3 whitespace-nowrap">{formatTimestamp(event.occurredAt)}</td><td className="px-4 py-3">{event.actorDisplayName ?? "System"}</td><td className="px-4 py-3 font-medium">{event.eventType}</td><td className="px-4 py-3"><span className="capitalize">{event.resourceType.replaceAll("_", " ")}</span>{event.resourceType === "access_grant" ? null : <><br/><span className="font-mono text-xs text-slate-500">{event.resourceId}</span></>}</td><td className="px-4 py-3 text-slate-600">{formatSummary(event.resourceType === "access_grant" ? event.changeSummary : { ...event.metadata, ...event.changeSummary })}</td></tr>)}</tbody>
          </table>
        ) : <p className="p-8 text-sm text-slate-600">No audit events have been recorded for this Project.</p>}
      </section>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function formatSummary(value: Record<string, unknown>) {
  const entries = Object.entries(value);
  return entries.length ? entries.map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : String(item)}`).join("; ") : "-";
}
