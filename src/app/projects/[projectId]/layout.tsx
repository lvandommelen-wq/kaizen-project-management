import { notFound } from "next/navigation";
import { getCurrentProjectRole } from "@/lib/authorization";

export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  if (!await getCurrentProjectRole(projectId)) notFound();
  return children;
}
