import { notFound } from "next/navigation";
import { getApplicabilityReview } from "@/lib/applicability";
import { getCurrentProjectRole } from "@/lib/authorization";
import { applicabilityValues, type Applicability } from "@/lib/gates";
import {
  createApplicabilityItemAction,
  deleteApplicabilityItemAction,
  updateApplicabilityItemAction,
} from "../../applicability-actions";
import { ApplicabilityReview } from "../../_components/applicability-review";

export const dynamic = "force-dynamic";

export default async function ProjectApplicabilityPage({ params, searchParams }: PageProps<"/projects/[projectId]/applicability">) {
  const { projectId } = await params;
  const query = await searchParams;
  const access = await getCurrentProjectRole(projectId);
  if (!access) notFound();
  const review = await getApplicabilityReview(projectId, null);
  if (!review) notFound();
  const filter = parseApplicability(query.status);

  return (
    <ApplicabilityReview
      backHref={`/projects/${projectId}`}
      canEdit={access.role !== "viewer" && !review.methodologyAwaitingApproval}
      changes={review.changes}
      scopeLabel={`${review.project.projectNumber} - ${review.project.name}`}
      gates={review.gates}
      methodologyApproved={review.methodologyApproved}
      methodologyAwaitingApproval={review.methodologyAwaitingApproval}
      filter={filter}
      stageFilter={queryValue(query.stage)}
      gateFilter={queryValue(query.gate)}
      finalLifecycleReview={queryValue(query.review) === "final_lifecycle"}
      gateHref={(gateId) => `/projects/${projectId}/gates/${encodeURIComponent(gateId)}`}
      updateAction={(gateId, itemType, itemId) => updateApplicabilityItemAction.bind(null, projectId, null, gateId, itemType, itemId)}
      createAction={(gateId, itemType) => createApplicabilityItemAction.bind(null, projectId, null, gateId, itemType)}
      deleteAction={(gateId, itemType, itemId) => deleteApplicabilityItemAction.bind(null, projectId, null, gateId, itemType, itemId)}
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
