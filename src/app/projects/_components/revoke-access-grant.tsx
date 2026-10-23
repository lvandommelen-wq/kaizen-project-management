"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AccessActionState } from "@/app/projects/access-actions";

type RevokeAction = (
  state: AccessActionState,
  formData: FormData,
) => Promise<AccessActionState>;

const initialState: AccessActionState = { status: "idle", message: "" };

export function RevokeAccessGrant({
  action,
  grantId,
  isLastPackageLead,
  packageId,
  userName,
}: {
  action: RevokeAction;
  grantId: string;
  isLastPackageLead: boolean;
  packageId?: string;
  userName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useActionState(action, initialState);

  return (
    <>
      <button className="button-secondary" onClick={() => setIsOpen(true)} type="button">
        Revoke access
      </button>
      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4" role="presentation">
          <div
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            role="dialog"
          >
            <h2 className="text-xl font-semibold text-slate-950">Revoke access</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Revoke this assignment for {userName}? Broader assignments remain unchanged.
            </p>
            <form action={formAction} className="mt-5 space-y-4">
              <input name="grantId" type="hidden" value={grantId} />
              {packageId ? <input name="packageId" type="hidden" value={packageId} /> : null}
              {isLastPackageLead ? (
                <label className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <input className="mt-1" name="confirmNoPackageLead" required type="checkbox" />
                  <span>
                    This is the only Package Lead. I understand that the Package will have no designated Lead.
                  </span>
                </label>
              ) : null}
              {state.status === "error" ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  {state.message}
                </p>
              ) : null}
              <div className="flex justify-end gap-3">
                <button className="button-secondary" onClick={() => setIsOpen(false)} type="button">
                  Cancel
                </button>
                <RevokeButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button-danger" disabled={pending} type="submit">
      {pending ? "Revoking…" : "Revoke access"}
    </button>
  );
}
