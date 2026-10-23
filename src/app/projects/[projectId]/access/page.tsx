import Link from "next/link";
import { notFound } from "next/navigation";
import {
  revokeProjectAccessGrantAction,
  saveProjectAccessGrantAction,
} from "@/app/projects/access-actions";
import { AccessGrantForm } from "@/app/projects/_components/access-grant-form";
import { AccessHistory } from "@/app/projects/_components/access-history";
import { RevokeAccessGrant } from "@/app/projects/_components/revoke-access-grant";
import {
  accessAuthorityLabel,
  accessPermissionLabel,
  accessScopeLabel,
  getProjectAccessManagementView,
  isAccessManagementSchemaAvailable,
  type AccessGrantView,
  type ProjectAccessManagementView,
} from "@/lib/access-management";
import { accessModuleLabel, packageAccessModules } from "@/lib/access-permissions";
import { requireInternalUser } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function ProjectAccessManagementPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  if (!await isAccessManagementSchemaAvailable()) notFound();
  const user = await requireInternalUser();
  const view = await getProjectAccessManagementView(user, projectId);
  if (!view) notFound();

  const saveAction = saveProjectAccessGrantAction.bind(null, projectId);
  const revokeAction = revokeProjectAccessGrantAction.bind(null, projectId);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{view.project.projectNumber}</p>
          <h1>Access Management</h1>
          <p className="page-description">
             Assign enforced Project and Package module access without changing protected Project ownership.
          </p>
        </div>
        <div className="flex gap-3">
          <Link className="button-secondary" href="/projects">All projects</Link>
          {view.hasProjectMembership ? (
            <Link className="button-secondary" href={`/projects/${projectId}`}>Current project</Link>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Project Owner</h2>
            <p className="mt-1 text-sm text-slate-600">Protected authority with implicit full access.</p>
          </div>
          <span className="status-pill bg-slate-900 text-white">Protected</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {view.owners.map((owner) => (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={owner.id}>
              <p className="font-semibold text-slate-950">{owner.displayName}</p>
              <p className="mt-1 text-sm text-slate-600">{owner.email}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">Active access</h2>
          <p className="mt-1 text-sm text-slate-600">
            Open an assignment to review its direct scope and make permitted changes.
          </p>
        </div>
        {view.grants.length ? (
          <div className="divide-y divide-slate-100">
            {view.grants.map((grant) => (
              <ProjectGrantRow
                grant={grant}
                key={grant.id}
                revokeAction={revokeAction}
                saveAction={saveAction}
                userId={user.id}
                view={view}
              />
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-slate-600">No collaborator access has been assigned.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Add internal User</h2>
        <p className="mt-1 text-sm text-slate-600">
          Select an existing verified User. Email entry does not create or link an identity.
        </p>
        <div className="mt-5 max-w-3xl">
          <AccessGrantForm
            action={saveAction}
            actorAuthority={view.authority}
            mode="project"
            packages={view.packages}
            users={view.assignableUsers}
          />
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Pending requests</h2>
        <p className="mt-2 text-sm text-slate-600">
          External collaborator requests and onboarding are deferred to Increment 19A.4.
        </p>
      </section>

      <AccessHistory events={view.history} />
    </div>
  );
}

function ProjectGrantRow({
  grant,
  revokeAction,
  saveAction,
  userId,
  view,
}: {
  grant: AccessGrantView;
  revokeAction: Parameters<typeof RevokeAccessGrant>[0]["action"];
  saveAction: Parameters<typeof AccessGrantForm>[0]["action"];
  userId: string;
  view: ProjectAccessManagementView;
}) {
  const canEdit = grant.userAccessClass === "internal"
    && grant.user.id !== userId
    && (view.authority === "owner" || grant.authorityRole !== "project_access_manager");
  const packageLabel = grant.projectPackage
    ? `${grant.projectPackage.packageCode} — ${grant.projectPackage.packageName}`
    : null;
  const packageLeadCount = grant.projectPackage
    ? view.grants.filter((candidate) =>
        candidate.authorityRole === "package_lead"
        && candidate.projectPackage?.id === grant.projectPackage?.id).length
    : 0;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none p-5 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900 sm:p-6">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
          <div>
            <p className="font-semibold text-slate-950">{grant.user.displayName}</p>
            <p className="text-sm text-slate-600">{grant.user.email}</p>
          </div>
          <div className="text-sm text-slate-700">
            <span className="font-medium">{accessScopeLabel(grant.scopeType)}</span>
            {packageLabel ? <span className="block text-xs text-slate-500">{packageLabel}</span> : null}
          </div>
          <div className="text-sm text-slate-700">
            <span className="font-medium">{accessAuthorityLabel(grant.authorityRole)}</span>
            <span className="block text-xs text-slate-500">
               {grant.authorityRole === "package_lead"
                 ? "Full Package Read & Write"
                 : packageAccessModules.map((module) =>
                   `${accessModuleLabel(module)} ${accessPermissionLabel(grant.permissions[module])}`).join("; ")}
            </span>
          </div>
          <span className="text-sm font-semibold text-slate-500 group-open:hidden">Details</span>
          <span className="hidden text-sm font-semibold text-slate-500 group-open:inline">Close</span>
        </div>
      </summary>
      <div className="border-t border-slate-100 bg-slate-50 p-5 sm:p-6">
        {canEdit ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
            <AccessGrantForm
              action={saveAction}
              actorAuthority={view.authority}
              grant={grant}
              mode="project"
              packages={view.packages}
            />
            <div className="xl:border-l xl:border-slate-200 xl:pl-6">
              <RevokeAccessGrant
                action={revokeAction}
                grantId={grant.id}
                isLastPackageLead={grant.authorityRole === "package_lead" && packageLeadCount === 1}
                packageId={grant.projectPackage?.id}
                userName={grant.user.displayName}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            This assignment is read-only for your current Access Management authority.
          </p>
        )}
      </div>
    </details>
  );
}
