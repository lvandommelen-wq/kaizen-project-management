"use client";

import type { Gate } from "@/lib/gates";

type FormAction = (formData: FormData) => void | Promise<void>;

export function ApproverForm({
  action,
  approver,
  submitLabel,
}: {
  action: FormAction;
  approver?: Gate["approvers"][number];
  submitLabel: string;
}) {
  return (
    <form action={action} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Name
        <input name="name" required defaultValue={approver?.name} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Email address
        <input type="email" name="email" required defaultValue={approver?.email} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        Organization <span className="font-normal text-slate-500">Optional</span>
        <input name="organizationName" defaultValue={approver?.organizationName ?? ""} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Role / Function
        <input name="roleFunction" required defaultValue={approver?.roleFunction} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Gate Approval Role
        <input name="approvalRole" required defaultValue={approver?.approvalRole} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Approval Level
        <input type="number" name="approvalLevel" required min="1" step="1" defaultValue={approver?.approvalLevel ?? 1} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm" />
      </label>
      <div className="flex items-end justify-end">
        <button type="submit" className="button-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
