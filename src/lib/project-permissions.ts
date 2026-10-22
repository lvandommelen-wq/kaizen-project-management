export const projectMembershipRoles = ["owner", "editor", "viewer"] as const;
export type ProjectMembershipRole = (typeof projectMembershipRoles)[number];

const roleRank: Record<ProjectMembershipRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function projectRoleAllows(
  actualRole: ProjectMembershipRole,
  requiredRole: ProjectMembershipRole,
) {
  return roleRank[actualRole] >= roleRank[requiredRole];
}
