"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    setError("");

    const result = await authClient.signIn.social({
      provider: "microsoft",
      callbackURL: callbackUrl,
    });

    if (result.error) {
      setError("Microsoft sign-in could not be started. Check the authentication configuration.");
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="button-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        onClick={signIn}
      >
        {pending ? "Opening Microsoft sign-in..." : "Sign in with Microsoft"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
