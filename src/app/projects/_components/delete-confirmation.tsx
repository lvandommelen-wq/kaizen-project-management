"use client";

import { useState } from "react";

type DeleteConfirmationProps = {
  action: (formData: FormData) => void;
  buttonLabel: string;
  confirmLabel: string;
  message: string;
  title: string;
};

export function DeleteConfirmation({ action, buttonLabel, confirmLabel, message, title }: DeleteConfirmationProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" className="button-danger" onClick={() => setIsOpen(true)}>
        {buttonLabel}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4" role="presentation">
          <div
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            role="dialog"
          >
            <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
            <p className="mt-3 text-sm font-semibold text-red-700">This action is destructive and cannot be undone.</p>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="button-secondary" onClick={() => setIsOpen(false)}>
                Cancel
              </button>
              <form action={action}>
                <button type="submit" className="button-danger">
                  {confirmLabel}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
