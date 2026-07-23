import { getUserOrgs } from "@/lib/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { BusinessMapAnchor } from "../map/mapSession";

export interface ActorEstablishmentMapProjection {
  organizationId: string;
  locationId: string;
  organizationName: string;
  establishmentLabel: string;
  locationType: string;
  primary: boolean;
  headquarters: boolean;
  preferredOrientation: boolean;
  latitude: number;
  longitude: number;
  visibilityClassification: "private_actor" | "private_and_public_candidate";
  markerState: "private_actor_visible";
}

export interface ActorBusinessMapContext {
  organizationId: string;
  anchor: BusinessMapAnchor;
  locationId?: string;
  locations: ActorEstablishmentMapProjection[];
}

/**
 * Loads a privacy-minimized location projection only after the callable
 * revalidates exact-active organization authority.
 */
export async function loadActorBusinessMapContext(
  uid: string,
  preferredOrganizationId?: string,
): Promise<ActorBusinessMapContext | null> {
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
      {
        anchor: BusinessMapAnchor | null;
        source: string;
        locationId?: string;
        locations: ActorEstablishmentMapProjection[];
      }
    >(functions, "exchange_getActorMapAnchor");
    const anchors = await Promise.all(organizationIds.map(async (organizationId): Promise<ActorBusinessMapContext | null> => {
      try {
        const response = (await getAnchor({ organizationId })).data;
        return response.anchor ? {
          organizationId,
          anchor: response.anchor,
          locationId: response.locationId,
          locations: response.locations,
        } : null;
      } catch {
        return null;
      }
    }));
    return anchors.find((candidate) => candidate
      && Number.isFinite(candidate.anchor.latitude)
      && Number.isFinite(candidate.anchor.longitude)) ?? null;
  } catch {
    return null;
  }
}

export async function loadPrimaryBusinessAnchor(
  uid: string,
  preferredOrganizationId?: string,
): Promise<BusinessMapAnchor | null> {
  return (await loadActorBusinessMapContext(uid, preferredOrganizationId))?.anchor ?? null;
}
