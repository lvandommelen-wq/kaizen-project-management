import { redirect } from "next/navigation";

export default async function ProjectMembersPage({
  params,
}: PageProps<"/projects/[projectId]/members">) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/access`);
}
