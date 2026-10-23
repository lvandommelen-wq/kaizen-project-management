import Link from "next/link";
import { notFound } from "next/navigation";
import {
  revokePackageAccessGrantAction,
  savePackageAccessGrantAction,
} from "@/app/projects/access-actions";
import { AccessGrantForm } from "@/app/projects/_components/access-grant-form";
import { AccessHistory } from "@/app/projects/_components/access-history";
import { RevokeAccessGrant } from "@/app/projects/_components/revoke-access-grant";
import {
  accessAuthorityLabel,
  accessPermissionLabel,
  getPackageAccessManagementView,
  isAccessManagementSchemaAvailable,
  type PackageAccessManagementView,
  type PackageUserAccessView,
} from "@/lib/access-management";
import { accessModuleLabel, packageAccessModules } from "@/lib/access-permissions";
import { requireInternalUser } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function PackageAccessManagementPage({
  params,
}: {
  params: Promise<{ projectId: string; packageId: string }>;
}) {
  const { projectId, packageId } = await params;
  if (!await isAccessManagementSchemaAvailable()) notFound();
  const user = await requireInternalUser();
  const view = await getPackageAccessManagementView(user, projectId, packageId);
  if (!view) notFound();

  const saveAction = savePackageAccessGrantAction.bind(null, projectId, packageId);
  const revokeAction = revokePackageAccessGrantAction.bind(null, projectId, packageId);
  const packageLeads = view.users.filter(
    (entry) => entry.packageGrant?.authorityRole === "package_lead",
  );
  const contributors = view.users.filter(
    (entry) => entry.packageGrant?.authorityRole !== "package_lead",
  );
  const permissionCeilings = view.authority === "package_lead"
    ? view.actorPermissionCeilings
    : undefined;

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            {view.project.projectNumber} · {view.projectPackage.packageCode}
          </p>
          <h1>Package Access Management</h1>
          <p className="page-description">
             Manage implemented Package module access for {view.projectPackage.packageName}. Broader inherited access remains separate.
          </p>
        </div>
        <div className="flex gap-3">
          <Link className="button-secondary" href="/projects">All projects</Link>
          {view.actorPermissionCeilings.overview ? (
            <Link
              className="button-secondary"
              href={`/projects/${projectId}/packages/${packageId}`}
            >
               Current package
            </Link>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">Package Lead</h2>
          <p className="mt-1 text-sm text-slate-600">
            Package-specific delegated authority. A Package may continue without a designated Lead.
          </p>
        </div>
        {packageLeads.length ? (
          <div className="divide-y divide-slate-100">
            {packageLeads.map((entry) => (
              <PackageUserRow
                entry={entry}
                key={entry.user.id}
                leadCount={packageLeads.length}
                revokeAction={revokeAction}
                saveAction={saveAction}
                userId={user.id}
                view={view}
              />
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-amber-800">
            No Package Lead is currently designated.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">Package contributors</h2>
          <p className="mt-1 text-sm text-slate-600">
            Direct and inherited permissions are shown separately; the highest applicable permission is effective.
          </p>
        </div>
        {contributors.length ? (
          <div className="divide-y divide-slate-100">
            {contributors.map((entry) => (
              <PackageUserRow
                entry={entry}
                key={entry.user.id}
                leadCount={packageLeads.length}
                revokeAction={revokeAction}
                saveAction={saveAction}
                userId={user.id}
                view={view}
              />
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-slate-600">No Package collaborator access is assigned.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Add internal User</h2>
        <p className="mt-1 text-sm text-slate-600">
          This creates only a direct assignment for {view.projectPackage.packageCode}.
        </p>
        <div className="mt-5 max-w-3xl">
          <AccessGrantForm
            action={saveAction}
            actorAuthority={view.authority}
            mode="package"
            packages={[view.projectPackage]}
            permissionCeilings={permissionCeilings}
            users={view.assignableUsers}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Protected Project Owner</h2>
        <p className="mt-1 text-sm text-slate-600">
          Project Owners retain implicit oversight and are not represented by editable grants.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {view.owners.map((owner) => (
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" key={owner.id}>
              <span className="font-semibold text-slate-950">{owner.displayName}</span>
              <span className="ml-2 text-slate-600">{owner.email}</span>
            </span>
          ))}
        </div>
      </section>

      <AccessHistory events={view.history} />
    </div>
  );
}

function PackageUserRow({
  entry,
  leadCount,
  revokeAction,
  saveAction,
  userId,
  view,
}: {
  entry: PackageUserAccessView;
  leadCount: number;
  revokeAction: Parameters<typeof RevokeAccessGrant>[0]["action"];
  saveAction: Parameters<typeof AccessGrantForm>[0]["action"];
  userId: string;
  view: PackageAccessManagementView;
}) {
  const direct = entry.packageGrant;
  const inherited = entry.entireProjectGrant;
  const canEdit = Boolean(
    direct
    && direct.userAccessClass === "internal"
    && entry.user.id !== userId
    && (
      view.authority === "owner"
      || view.authority === "project_access_manager"
      || (view.authority === "package_lead" && direct.authorityRole === "collaborator")
    ),
  );
  const permissionCeilings = view.authority === "package_lead"
    ? view.actorPermissionCeilings
    : undefined;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none p-5 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900 sm:p-6">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] md:items-center">
          <div>
            <p className="font-semibold text-slate-950">{entry.user.displayName}</p>
            <p className="text-sm text-slate-600">{entry.user.email}</p>
          </div>
          <div className="space-y-1 text-sm text-slate-700">
            {inherited ? (
              <p>
                 <span className="font-medium">Entire Project</span> · {permissionSummary(inherited.permissions)}
                <span className="ml-2 text-xs text-slate-500">Inherited</span>
              </p>
            ) : null}
            {direct ? (
              <p>
                 <span className="font-medium">Specific Package</span> · {direct.authorityRole === "package_lead"
                   ? "Full Package Read & Write"
                   : permissionSummary(direct.permissions)}
                <span className="ml-2 text-xs text-slate-500">Direct</span>
              </p>
            ) : null}
            <p className="text-xs font-semibold text-slate-900">
               Effective: {permissionSummary(entry.effectivePermissions)}
            </p>
          </div>
          <div className="text-sm text-slate-600">
            {direct ? accessAuthorityLabel(direct.authorityRole) : "Inherited access"}
          </div>
        </div>
      </summary>
      <div className="border-t border-slate-100 bg-slate-50 p-5 sm:p-6">
        {inherited ? (
          <p className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            Entire Project access is inherited and cannot be changed from this Package. Editing or revoking the direct Package assignment leaves it unchanged.
          </p>
        ) : null}
        {direct && canEdit ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
            <AccessGrantForm
              action={saveAction}
              actorAuthority={view.authority}
              grant={direct}
              mode="package"
              packages={[view.projectPackage]}
              permissionCeilings={permissionCeilings}
            />
            <div className="xl:border-l xl:border-slate-200 xl:pl-6">
              <RevokeAccessGrant
                action={revokeAction}
                grantId={direct.id}
                isLastPackageLead={direct.authorityRole === "package_lead" && leadCount === 1}
                packageId={view.projectPackage.id}
                userName={entry.user.displayName}
              />
            </div>
          </div>
        ) : direct ? (
          <p className="text-sm text-slate-600">
            The direct Package assignment is read-only for your current authority.
          </p>
        ) : (
          <p className="text-sm text-slate-600">There is no direct Package assignment to edit.</p>
        )}
      </div>
    </details>
  );
}

function permissionSummary(permissions: PackageUserAccessView["effectivePermissions"]) {
  return packageAccessModules
    .map((module) => `${accessModuleLabel(module)} ${accessPermissionLabel(permissions[module])}`)
    .join("; ");
}
