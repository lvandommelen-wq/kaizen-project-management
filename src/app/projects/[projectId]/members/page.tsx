import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmationAction } from "@/app/projects/_components/confirmation-action";
import {
  removeProjectMembershipAction,
  saveProjectMembershipAction,
} from "@/app/projects/membership-actions";
import { getCurrentProjectRole } from "@/lib/authorization";
import { getOperationalDataBackend } from "@/lib/operational/backend";
import {
  getAssignableProjectUsers,
  getProjectMembershipDetails,
} from "@/lib/operational/postgres";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectMembersPage({
  params,
}: PageProps<"/projects/[projectId]/members">) {
  const { projectId } = await params;
  if (getOperationalDataBackend() !== "postgres") notFound();
  const access = await getCurrentProjectRole(projectId);
  if (!access || access.role !== "owner") notFound();
  const [project, memberships, users] = await Promise.all([
    getProject(projectId),
    getProjectMembershipDetails(projectId),
    getAssignableProjectUsers(projectId),
  ]);
  if (!project) notFound();
  const saveAction = saveProjectMembershipAction.bind(null, projectId);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{project.projectNumber}</p>
          <h1>Project members</h1>
          <p className="page-description">Owners control access to this Project and all inherited Package data.</p>
        </div>
        <Link href={`/projects/${projectId}`} className="button-secondary">Project</Link>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {memberships.map((membership) => (
              <tr key={membership.userId}>
                <td className="px-4 py-3"><p className="font-semibold">{membership.displayName}</p><p className="text-slate-600">{membership.email}</p></td>
                <td className="px-4 py-3">
                  <form action={saveAction} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={membership.userId} />
                    <select name="role" defaultValue={membership.role} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
                      <option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                    </select>
                    <button className="button-secondary" type="submit">Save</button>
                  </form>
                </td>
                <td className="px-4 py-3 capitalize">{membership.status}</td>
                <td className="px-4 py-3">
                  <ConfirmationAction
                    action={removeProjectMembershipAction.bind(null, projectId, membership.userId)}
                    buttonLabel="Remove"
                    confirmLabel="Remove member"
                    message={`Remove ${membership.displayName} from this Project?`}
                    title="Remove Project member"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Add member</h2>
        {users.length ? (
          <form action={saveAction} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1 text-sm font-medium">Active internal User
              <select name="userId" required className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="">Select User</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.displayName} ({user.email})</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Role
              <select name="role" defaultValue="viewer" className="mt-2 block rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
              </select>
            </label>
            <button type="submit" className="button-primary">Add member</button>
          </form>
        ) : <p className="mt-3 text-sm text-slate-600">No additional active internal Users are available.</p>}
      </section>
    </div>
  );
}
