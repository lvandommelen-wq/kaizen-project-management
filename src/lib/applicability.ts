import "server-only";

import type { CurrentUser } from "./current-user";
import type { Applicability } from "./gates";
import {
  createApplicabilityItem as createPostgresApplicabilityItem,
  deleteApplicabilityItem as deletePostgresApplicabilityItem,
  confirmGateMatrixReview as confirmPostgresGateMatrixReview,
  getApplicabilityReview as getPostgresApplicabilityReview,
  getGateMatrixReview as getPostgresGateMatrixReview,
  updateApplicabilityItem as updatePostgresApplicabilityItem,
  type ApplicabilityItemType,
} from "./operational/postgres";

export { type ApplicabilityItemType } from "./operational/postgres";
export { type ApplicabilityChange } from "./operational/postgres";

export function getApplicabilityReview(projectId: string, packageId: string | null) {
  return getPostgresApplicabilityReview(projectId, packageId);
}

export function getGateMatrixReview(
  projectId: string,
  packageId: string | null,
  gateId: string,
) {
  return getPostgresGateMatrixReview(projectId, packageId, gateId);
}

export function confirmGateMatrixReview(
  projectId: string,
  packageId: string | null,
  gateId: string,
  actor: CurrentUser,
) {
  return confirmPostgresGateMatrixReview(projectId, packageId, gateId, actor);
}

export function updateApplicabilityItem(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  itemType: ApplicabilityItemType;
  itemId: string;
  applicability: Applicability;
  justification: string;
}, actor: CurrentUser) {
  return updatePostgresApplicabilityItem(input, actor);
}

export function createApplicabilityItem(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  itemType: ApplicabilityItemType;
  title: string;
}, actor: CurrentUser) {
  return createPostgresApplicabilityItem(input, actor);
}

export function deleteApplicabilityItem(input: {
  projectId: string;
  packageId: string | null;
  gateId: string;
  itemType: ApplicabilityItemType;
  itemId: string;
}) {
  return deletePostgresApplicabilityItem(input);
}
