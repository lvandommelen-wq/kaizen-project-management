import { notFound } from "next/navigation";
import { canCreateProject, requireInternalUser } from "@/lib/authorization";
import { ProjectForm } from "../_components/project-form";
import { createProjectAction } from "../actions";

export default async function NewProjectPage() {
  const user = await requireInternalUser();
  if (!await canCreateProject(user)) notFound();

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">All projects</p>
          <h1>New project</h1>
          <p className="page-description">Capture the minimum information needed to start managing a CAPEX project.</p>
        </div>
      </div>

      <ProjectForm action={createProjectAction} submitLabel="Create project" />
    </div>
  );
}
