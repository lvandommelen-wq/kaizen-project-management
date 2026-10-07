import { notFound } from "next/navigation";
import { ProjectForm } from "../../_components/project-form";
import { updateProjectAction } from "../../actions";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: PageProps<"/projects/[projectId]/edit">) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const updateAction = updateProjectAction.bind(null, project.id);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{project.projectNumber} - {project.name}</p>
          <h1>Edit project</h1>
          <p className="page-description">Update the basic information for this CAPEX project.</p>
        </div>
      </div>

      <ProjectForm action={updateAction} project={project} submitLabel="Save changes" />
    </div>
  );
}
