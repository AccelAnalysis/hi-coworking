import { getUserOrgs } from "@/lib/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
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
    const getAnchor = httpsCallable<
      { organizationId: string },
      { anchor: BusinessMapAnchor | null; source: string; locationId?: string }
    >(functions, "exchange_getActorMapAnchor");
    const anchors = await Promise.all(organizationIds.map(async (organizationId) => {
      try {
        return (await getAnchor({ organizationId })).data.anchor;
      } catch {
        return null;
      }
    }));
    return anchors.find((candidate) => candidate
      && Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)) ?? null;
  } catch {
    return null;
  }
}
