"use client";

import { useState } from "react";

type ConfirmationActionProps = {
  action: (formData: FormData) => void;
  buttonLabel: string;
  confirmLabel: string;
  message: string;
  title: string;
  textArea?: {
    label: string;
    name: string;
    required?: boolean;
  };
};

export function ConfirmationAction({
  action,
  buttonLabel,
  confirmLabel,
  message,
  title,
  textArea,
}: ConfirmationActionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" className="button-secondary" onClick={() => setIsOpen(true)}>
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

            <form action={action} className="mt-5">
              {textArea ? (
                <label className="block text-sm font-medium text-slate-800">
                  {textArea.label}
                  <textarea
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
                    name={textArea.name}
                    required={textArea.required}
                    rows={4}
                  />
                </label>
              ) : null}
              <div className="mt-6 flex justify-end gap-3">
                <button type="button" className="button-secondary" onClick={() => setIsOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button-primary">{confirmLabel}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
