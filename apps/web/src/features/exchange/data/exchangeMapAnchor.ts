import { getOrg, getUserOrgs } from "@/lib/firestore";
import type { BusinessMapAnchor } from "../map/mapSession";

/**
 * Loads only a coordinate pair from organizations the viewer actively belongs
 * to. It is used for initial camera placement and never enters map feature data.
 */
export async function loadPrimaryBusinessAnchor(
  uid: string,
  preferredOrganizationId?: string,
): Promise<BusinessMapAnchor | null> {
  try {
    const memberships = await getUserOrgs(uid);
    const roleRank = { owner: 0, admin: 1, member: 2 } as const;
    const orderedMemberships = memberships
      .filter((membership) => membership.status === "active")
      .sort((left, right) =>
      roleRank[left.role] - roleRank[right.role]
      || right.joinedAt - left.joinedAt);
    const activeOrganizationIds = new Set(
      orderedMemberships.map((membership) => membership.orgId),
    );
    const organizationIds = [...new Set([
      preferredOrganizationId && activeOrganizationIds.has(preferredOrganizationId)
        ? preferredOrganizationId
        : undefined,
      ...orderedMemberships.map((membership) => membership.orgId),
    ].filter((value): value is string => Boolean(value)))].slice(0, 8);
    const organizations = await Promise.all(organizationIds.map(async (organizationId) => {
      try {
        return await getOrg(organizationId);
      } catch {
        return null;
      }
    }));
    const organization = organizations.find((candidate) =>
      candidate?.status === "active"
      && typeof candidate.latitude === "number"
      && Number.isFinite(candidate.latitude)
      && candidate.latitude >= -85.051129
      && candidate.latitude <= 85.051129
      && typeof candidate.longitude === "number"
      && Number.isFinite(candidate.longitude)
      && candidate.longitude >= -180
      && candidate.longitude <= 180);
    return organization
      && typeof organization.latitude === "number"
      && typeof organization.longitude === "number"
      ? { latitude: organization.latitude, longitude: organization.longitude }
      : null;
  } catch {
    return null;
  }
}
