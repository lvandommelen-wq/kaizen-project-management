import { notFound } from "next/navigation";
import {
  ActionRegister,
  type ActionRegisterQuery,
} from "@/app/projects/_components/action-register";
import { getActionRegisterView } from "@/lib/action-register";
import { requireInternalUser } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function PackageActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; packageId: string }>;
  searchParams: Promise<ActionRegisterQuery>;
}) {
  const { projectId, packageId } = await params;
  const user = await requireInternalUser();
  const view = await getActionRegisterView(user, projectId, packageId);
  if (!view) notFound();
  return <ActionRegister query={await searchParams} view={view} />;
}
