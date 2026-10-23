"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AccessActionState } from "@/app/projects/access-actions";
import type {
  AccessGrantView,
  AccessManagementAuthority,
  AccessManagementPackage,
  AccessManagementUser,
} from "@/lib/access-management";
import {
  accessModuleLabel,
  packageAccessModules,
  type AccessAuthorityRole,
  type AccessPermission,
  type AccessScopeType,
  type AssignableAccessModule,
  type EffectiveAccessPermission,
} from "@/lib/access-permissions";

type AccessFormAction = (
  state: AccessActionState,
  formData: FormData,
) => Promise<AccessActionState>;

type AccessGrantFormProps = {
  action: AccessFormAction;
  actorAuthority: AccessManagementAuthority;
  grant?: AccessGrantView;
  mode: "project" | "package";
  packages: AccessManagementPackage[];
  permissionCeilings?: Partial<Record<AssignableAccessModule, EffectiveAccessPermission>>;
  users?: AccessManagementUser[];
};

const initialState: AccessActionState = { status: "idle", message: "" };

export function AccessGrantForm({
  action,
  actorAuthority,
  grant,
  mode,
  packages,
  permissionCeilings = {},
  users = [],
}: AccessGrantFormProps) {
  const [state, formAction] = useActionState(action, initialState);
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState(grant?.user.id ?? "");
  const [scopeType, setScopeType] = useState<AccessScopeType>(
    mode === "package" ? "specific_package" : grant?.scopeType ?? "overall_project",
  );
  const [authorityRole, setAuthorityRole] = useState<AccessAuthorityRole>(
    grant?.authorityRole ?? "collaborator",
  );
  const [permissions, setPermissions] = useState<Record<AssignableAccessModule, AccessPermission | "">>(
    Object.fromEntries(packageAccessModules.map((module) => [
      module,
      grant?.permissions[module] ?? (module === "overview" ? "read" : ""),
    ])) as Record<AssignableAccessModule, AccessPermission | "">,
  );
  const selectedUser = users.find((user) => user.id === selectedUserId);
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return users;
    return users.filter((user) =>
      user.displayName.toLocaleLowerCase().includes(normalized)
      || user.email.toLocaleLowerCase().includes(normalized));
  }, [query, users]);

  function changeAuthority(next: AccessAuthorityRole) {
    setAuthorityRole(next);
    if (next === "project_access_manager") {
      setScopeType("entire_project");
    } else if (next === "package_lead") {
      setScopeType("specific_package");
      setPermissions(Object.fromEntries(packageAccessModules.map((module) =>
        [module, "read_write"])) as Record<AssignableAccessModule, AccessPermission>);
    }
  }

  return (
    <form action={formAction} className="space-y-5">
      {grant ? <input type="hidden" name="grantId" value={grant.id} /> : null}
      <input type="hidden" name="userId" value={grant?.user.id ?? selectedUserId} />

      {grant ? (
        <div>
          <p className="text-sm font-semibold text-slate-950">{grant.user.displayName}</p>
          <p className="text-sm text-slate-600">{grant.user.email}</p>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-semibold text-slate-800">
            Find an internal User
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or email"
              type="search"
              value={query}
            />
          </label>
          {selectedUser ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-emerald-950">{selectedUser.displayName}</p>
                <p className="text-xs text-emerald-800">{selectedUser.email}</p>
              </div>
              <button
                className="text-sm font-semibold text-emerald-900 underline"
                onClick={() => setSelectedUserId("")}
                type="button"
              >
                Change
              </button>
            </div>
          ) : filteredUsers.length ? (
            <div className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {filteredUsers.map((user) => (
                <button
                  className="block w-full px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50"
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  type="button"
                >
                  <span className="block text-sm font-semibold text-slate-900">{user.displayName}</span>
                  <span className="block text-xs text-slate-600">{user.email}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              No matching verified internal User exists. The person must first sign in through Microsoft Entra.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {mode === "project" ? (
          <label className="text-sm font-semibold text-slate-800">
            Scope
            <select
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              name="scopeType"
              onChange={(event) => setScopeType(event.target.value as AccessScopeType)}
              value={scopeType}
            >
              <option value="overall_project">Overall Project</option>
              <option value="entire_project">Entire Project including Packages</option>
              <option value="specific_package">Specific Package</option>
            </select>
          </label>
        ) : null}

        {mode === "project" && scopeType === "specific_package" ? (
          <label className="text-sm font-semibold text-slate-800">
            Package
            <select
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              defaultValue={grant?.projectPackage?.id ?? ""}
              name="packageId"
              required
            >
              <option value="">Select Package</option>
              {packages.map((projectPackage) => (
                <option key={projectPackage.id} value={projectPackage.id}>
                  {projectPackage.packageCode} — {projectPackage.packageName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="text-sm font-semibold text-slate-800">
          Authority
          <select
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            name="authorityRole"
            onChange={(event) => changeAuthority(event.target.value as AccessAuthorityRole)}
            value={authorityRole}
          >
            <option value="collaborator">Collaborator</option>
            {actorAuthority === "owner" && mode === "project" ? (
              <option value="project_access_manager">Project Access Manager</option>
            ) : null}
            {actorAuthority !== "package_lead" ? (
              <option value="package_lead">Package Lead</option>
            ) : null}
          </select>
        </label>

        {(scopeType === "overall_project" ? (["actions"] as const) : packageAccessModules)
          .map((module) => {
            const ceiling = permissionCeilings[module] ?? "read_write";
            return (
              <label className="text-sm font-semibold text-slate-800" key={module}>
                {accessModuleLabel(module)} permission
                <select
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  disabled={authorityRole === "package_lead"}
                  name={`permission_${module}`}
                  onChange={(event) => setPermissions((current) => ({
                    ...current,
                    [module]: event.target.value as AccessPermission | "",
                  }))}
                  value={permissions[module]}
                >
                  <option value="">No Access</option>
                  <option disabled={!ceiling} value="read">Read</option>
                  <option disabled={ceiling !== "read_write"} value="read_write">
                    Read &amp; Write
                  </option>
                </select>
                {authorityRole === "package_lead" ? (
                  <input type="hidden" name={`permission_${module}`} value="read_write" />
                ) : null}
              </label>
            );
          })}
      </div>

      <p className="text-xs leading-5 text-slate-500">
        Package Leads receive Full Package Read &amp; Write for every implemented module. Contributor permissions are independent and take effect immediately.
      </p>
      {state.message ? (
        <p
          className={`rounded-lg border p-3 text-sm ${
            state.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <SubmitButton disabled={!grant && !selectedUserId} label={grant ? "Save changes" : "Add access"} />
    </form>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-primary" disabled={disabled || pending} type="submit">
      {pending ? "Saving…" : label}
    </button>
  );
}
