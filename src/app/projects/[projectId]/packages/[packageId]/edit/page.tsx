import { notFound } from "next/navigation";
import { PackageForm } from "../../_components/package-form";
import { updatePackageAction } from "../../actions";
import { requireInternalUser } from "@/lib/authorization";
import { getAuthorizedPackageContext } from "@/lib/package-access";

export const dynamic = "force-dynamic";

export default async function EditPackagePage({
  params,
}: PageProps<"/projects/[projectId]/packages/[packageId]/edit">) {
  const { projectId, packageId } = await params;
  const user = await requireInternalUser();
  const context = await getAuthorizedPackageContext({
    user,
    projectId,
    packageId,
    module: "overview",
    requestedPermission: "read_write",
  });
  if (!context) notFound();
  const { project, projectPackage } = context;

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
