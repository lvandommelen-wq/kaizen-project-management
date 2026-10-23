import { notFound } from "next/navigation";
import { canAccessAnyPackageInProject } from "@/lib/access-authorization";
import { canAccessAnyProjectActions } from "@/lib/action-register";
import { canAccessAnyProjectAccessManagement } from "@/lib/access-management";
import { getCurrentProjectRole, requireInternalUser } from "@/lib/authorization";

export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  if (!await getCurrentProjectRole(projectId)) {
    const user = await requireInternalUser();
    const [canAccessActions, canAccessManagement, canAccessPackage] = await Promise.all([
      canAccessAnyProjectActions(user, projectId),
      canAccessAnyProjectAccessManagement(user, projectId),
      canAccessAnyPackageInProject({ user, projectId }),
    ]);
    if (!canAccessActions && !canAccessManagement && !canAccessPackage) notFound();
  }
  return children;
}
