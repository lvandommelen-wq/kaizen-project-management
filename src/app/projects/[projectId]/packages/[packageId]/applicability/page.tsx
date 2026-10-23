import { notFound } from "next/navigation";
import { getApplicabilityReview } from "@/lib/applicability";
import { requireInternalUser } from "@/lib/authorization";
import { accessPermissionAllows } from "@/lib/access-permissions";
import { getAuthorizedPackageContext } from "@/lib/package-access";
import { applicabilityValues, type Applicability } from "@/lib/gates";
import {
  createApplicabilityItemAction,
  deleteApplicabilityItemAction,
  updateApplicabilityItemAction,
} from "../../../../applicability-actions";
import { ApplicabilityReview } from "../../../../_components/applicability-review";

export const dynamic = "force-dynamic";

export default async function PackageApplicabilityPage({ params, searchParams }: PageProps<"/projects/[projectId]/packages/[packageId]/applicability">) {
  const { projectId, packageId } = await params;
  const query = await searchParams;
  const user = await requireInternalUser();
  const context = await getAuthorizedPackageContext({
    user,
    projectId,
    packageId,
    module: "deliverables",
  });
  if (!context) notFound();
  const review = await getApplicabilityReview(projectId, packageId);
  if (!review) notFound();
  const projectPackage = review.entity as { packageCode: string; packageName: string };
  const filter = parseApplicability(query.status);

  return (
    <ApplicabilityReview
      backHref={accessPermissionAllows(context.permissions.overview, "read")
        ? `/projects/${projectId}/packages/${packageId}`
        : "/projects"}
      backLabel={accessPermissionAllows(context.permissions.overview, "read")
        ? "Current package"
        : "All projects"}
      canEdit={accessPermissionAllows(context.permissions.deliverables, "read_write")
        && !review.methodologyAwaitingApproval}
      changes={review.changes}
      scopeLabel={`${projectPackage.packageCode} - ${projectPackage.packageName}`}
      gates={review.gates}
      methodologyApproved={review.methodologyApproved}
      methodologyAwaitingApproval={review.methodologyAwaitingApproval}
      filter={filter}
      stageFilter={queryValue(query.stage)}
      gateFilter={queryValue(query.gate)}
      finalLifecycleReview={queryValue(query.review) === "final_lifecycle"}
      gateHref={(gateId) => `/projects/${projectId}/packages/${packageId}/gates/${encodeURIComponent(gateId)}`}
      updateAction={(gateId, itemType, itemId) => updateApplicabilityItemAction.bind(null, projectId, packageId, gateId, itemType, itemId)}
      createAction={(gateId, itemType) => createApplicabilityItemAction.bind(null, projectId, packageId, gateId, itemType)}
      deleteAction={(gateId, itemType, itemId) => deleteApplicabilityItemAction.bind(null, projectId, packageId, gateId, itemType, itemId)}
    />
  );
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseApplicability(value: string | string[] | undefined): Applicability | "all" {
  const candidate = queryValue(value);
  return applicabilityValues.includes(candidate as Applicability) ? candidate as Applicability : "all";
}
