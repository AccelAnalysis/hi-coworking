import { collection, getDocs, limit, onSnapshot, query } from "firebase/firestore";
import type { PublicOrganizationEstablishment } from "@hi/shared/organization-establishments";
import { db } from "@/lib/firebase";

const PUBLIC_LOCATION_LIMIT = 2_000;

function locationRecords(snapshot: { docs: Array<{ id: string; data(): unknown }> }): PublicOrganizationEstablishment[] {
  return snapshot.docs.map((document) => ({
    ...(document.data() as PublicOrganizationEstablishment),
    id: document.id,
  })).filter((location) => location.organizationId && location.coordinatePublicationApproved);
}

/** Reads only the server-maintained public allowlist; private locations never reach React. */
export async function loadPublicOrganizationLocations(): Promise<PublicOrganizationEstablishment[]> {
  const snapshot = await getDocs(query(collection(db, "publicOrganizationLocations"), limit(PUBLIC_LOCATION_LIMIT)));
  return locationRecords(snapshot);
}

export function subscribePublicOrganizationLocations(
  listener: (locations: PublicOrganizationEstablishment[]) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "publicOrganizationLocations"), limit(PUBLIC_LOCATION_LIMIT)),
    (snapshot) => listener(locationRecords(snapshot)),
    () => listener([]),
  );
}
