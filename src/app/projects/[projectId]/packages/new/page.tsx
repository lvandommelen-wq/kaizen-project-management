import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { PackageForm } from "../_components/package-form";
import { createPackageAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPackagePage({ params }: PageProps<"/projects/[projectId]/packages/new">) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const createAction = createPackageAction.bind(null, project.id);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{project.projectNumber}</p>
          <h1>Add package</h1>
          <p className="page-description">
            Create a child Package for this Project. The Package lifecycle starts in Definition.
          </p>
        </div>
      </div>

      <PackageForm action={createAction} projectId={project.id} submitLabel="Create package" />
    </div>
  );
}
