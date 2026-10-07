import { ProjectForm } from "../_components/project-form";
import { createProjectAction } from "../actions";

export default function NewProjectPage() {
  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>New project</h1>
          <p className="page-description">Capture the minimum information needed to start managing a CAPEX project.</p>
        </div>
      </div>

      <ProjectForm action={createProjectAction} submitLabel="Create project" />
    </div>
  );
}
