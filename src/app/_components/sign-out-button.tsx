"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const result = await authClient.signOut();
    if (!result.error) {
      router.replace("/sign-in");
      router.refresh();
      return;
    }
    setPending(false);
  }

  return (
    <button
      type="button"
      className="button-secondary disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      onClick={signOut}
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
