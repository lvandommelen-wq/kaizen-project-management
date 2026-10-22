import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/app/_components/sign-out-button";
import { getCurrentUser } from "@/lib/current-user";

export default async function ProjectsLayout({ children }: LayoutProps<"/projects">) {
  const user = await getCurrentUser(await headers());

  if (!user) {
    redirect("/sign-in?callbackUrl=%2Fprojects");
  }
  if (user.status !== "active" || user.accessClass !== "internal") {
    redirect("/access-denied");
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{user.displayName}</p>
          <p className="truncate text-slate-600">{user.email}</p>
        </div>
        <SignOutButton />
      </div>
      {children}
    </>
  );
}
