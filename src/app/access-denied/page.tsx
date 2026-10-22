import Link from "next/link";
import { SignOutButton } from "@/app/_components/sign-out-button";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const reason = Array.isArray(query.reason) ? query.reason[0] : query.reason;

  return (
    <div className="mx-auto max-w-xl py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="eyebrow">Access restricted</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">
          Operational access is unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {reason === "inactive"
            ? "This application User is not active. Contact an application administrator if access should be restored."
            : "External reviewer accounts cannot access normal Project or Package routes. Assigned frozen Gate Reviews will be made available through a dedicated route in a later increment."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <SignOutButton />
          <Link href="/sign-in" className="button-secondary">
            Sign in with another account
          </Link>
        </div>
      </section>
    </div>
  );
}
