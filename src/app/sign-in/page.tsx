import { SignInButton } from "@/app/_components/sign-in-button";
import { getAuthConfigurationIssues } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const callbackUrl = safeCallbackUrl(firstValue(query.callbackUrl));
  const configurationIssues = getAuthConfigurationIssues();
  const error = firstValue(query.error);

  return (
    <div className="mx-auto max-w-lg py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="eyebrow">Secure access</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Use the Microsoft account assigned to Kaizen Project Management.
          External reviewers can sign in, but cannot access operational Project
          or Package pages.
        </p>

        {configurationIssues.length > 0 ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Authentication setup is incomplete.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        ) : (
          <div className="mt-6">
            {error === "unavailable" ? (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                Authentication or its identity database is currently unavailable.
              </p>
            ) : null}
            <SignInButton callbackUrl={callbackUrl} />
          </div>
        )}
      </section>
    </div>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCallbackUrl(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/projects";
  if (value.startsWith("/api/")) return "/projects";
  return value;
}
