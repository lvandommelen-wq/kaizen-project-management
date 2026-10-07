import { notFound } from "next/navigation";
import { getPackage } from "@/lib/packages";
import { getProject } from "@/lib/projects";
import { PackageForm } from "../../_components/package-form";
import { updatePackageAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditPackagePage({
  params,
}: PageProps<"/projects/[projectId]/packages/[packageId]/edit">) {
  const { projectId, packageId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const projectPackage = await getPackage(project.id, packageId);

  if (!projectPackage) {
    notFound();
  }

  const updateAction = updatePackageAction.bind(null, project.id, projectPackage.id);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="eyebrow">{projectPackage.packageCode} - {projectPackage.packageName}</p>
          <h1>Edit package</h1>
          <p className="page-description">
            Update the currently supported Package information.
          </p>
        </div>
      </div>

      <PackageForm
        action={updateAction}
        projectId={project.id}
        projectPackage={projectPackage}
        submitLabel="Save package"
      />
    </div>
  );
}
