"use client";

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  startAfter,
  onSnapshot,
  type Unsubscribe,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import type { Floorplan, Booking, ProfileDoc, RfxDoc, RfxResponseDoc, UserDoc, MembershipTrack, PaymentDoc, PaymentProvider, PaymentStatus, PaymentPurpose, ProductDoc, PaymentAuditEntry, EventDoc, EventRegistrationDoc, EventFormat, EventStatus, ReferralDoc, ReferralStatus, RfxTeamInviteDoc, OrgDoc, OrgMemberDoc, NotificationDoc, BookDoc, BookPurchaseDoc, BookAffiliateClickDoc, ReferralPolicyDoc, LocationDoc, FloorDoc, ShellDoc, LayoutVariant, EventCampaignDoc, CampaignJobDoc, EventShareKitDoc, SocialPostDoc, EventMediaImage, EventSeriesDoc, DoorDoc, AccessGrantDoc, AccessCodeDoc, AccessEventDoc } from "@hi/shared";

export interface PublicSiteSettingsDoc {
  id: "public";
  comingSoonEnabled: boolean;
  updatedAt: number;
  updatedBy?: string;
}

// --- Space Designer v2 (Locations/Floors/Shells/Layouts) ---

export async function getLocations(): Promise<LocationDoc[]> {
  const q = query(collection(db, "locations"), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as LocationDoc);
}

export async function getLocation(locationId: string): Promise<LocationDoc | null> {
  const snap = await getDoc(doc(db, "locations", locationId));
  return snap.exists() ? (snap.data() as LocationDoc) : null;
}

export async function saveLocation(location: LocationDoc): Promise<void> {
  await setDoc(doc(db, "locations", location.id), location, { merge: true });
}

export async function deleteLocation(locationId: string): Promise<void> {
  await deleteDoc(doc(db, "locations", locationId));
}

export async function getFloors(locationId: string): Promise<FloorDoc[]> {
  const q = query(collection(db, "locations", locationId, "floors"), orderBy("levelIndex"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as FloorDoc);
}

export async function getFloor(locationId: string, floorId: string): Promise<FloorDoc | null> {
  const snap = await getDoc(doc(db, "locations", locationId, "floors", floorId));
  return snap.exists() ? (snap.data() as FloorDoc) : null;
}

export async function saveFloor(locationId: string, floor: FloorDoc): Promise<void> {
  await setDoc(doc(db, "locations", locationId, "floors", floor.id), floor, { merge: true });
}

export async function deleteFloor(locationId: string, floorId: string): Promise<void> {
  await deleteDoc(doc(db, "locations", locationId, "floors", floorId));
}

export async function getShell(locationId: string, floorId: string): Promise<ShellDoc | null> {
  const snap = await getDoc(doc(db, "locations", locationId, "floors", floorId, "shell", "main"));
  return snap.exists() ? (snap.data() as ShellDoc) : null;
}

export async function saveShell(locationId: string, floorId: string, shell: ShellDoc): Promise<void> {
  await setDoc(doc(db, "locations", locationId, "floors", floorId, "shell", "main"), shell);
}

export async function getLayouts(locationId: string, floorId: string): Promise<LayoutVariant[]> {
  const q = query(collection(db, "locations", locationId, "floors", floorId, "layouts"), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as LayoutVariant);
}

export async function getLayout(
  locationId: string,
  floorId: string,
  layoutId: string
): Promise<LayoutVariant | null> {
  const snap = await getDoc(doc(db, "locations", locationId, "floors", floorId, "layouts", layoutId));
  return snap.exists() ? (snap.data() as LayoutVariant) : null;
}

export async function saveLayout(
  locationId: string,
  floorId: string,
  layout: LayoutVariant
): Promise<void> {
  await setDoc(doc(db, "locations", locationId, "floors", floorId, "layouts", layout.id), layout);
}

export async function deleteLayout(locationId: string, floorId: string, layoutId: string): Promise<void> {
  await deleteDoc(doc(db, "locations", locationId, "floors", floorId, "layouts", layoutId));
}

export async function publishLayout(locationId: string, floorId: string, layoutId: string): Promise<void> {
  await updateDoc(doc(db, "locations", locationId, "floors", floorId, "layouts", layoutId), {
    status: "PUBLISHED",
    updatedAt: Date.now(),
  });
}

export async function getPublishedLayouts(locationId: string, floorId: string): Promise<LayoutVariant[]> {
  const q = query(
    collection(db, "locations", locationId, "floors", floorId, "layouts"),
    where("status", "==", "PUBLISHED"),
    orderBy("updatedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as LayoutVariant);
}

function isWithinRuleWindow(layout: LayoutVariant, targetDate: Date): boolean {
  const rules = layout.effectiveRules;
  if (!rules) return true;

  const day = targetDate.getDay();
  if (rules.daysOfWeek?.length && !rules.daysOfWeek.includes(day)) {
    return false;
  }

  const toMinutes = (value?: string) => {
    if (!value) return undefined;
    const [h, m] = value.split(":").map((x) => Number(x));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
    return h * 60 + m;
  };

  const startMin = toMinutes(rules.startTime);
  const endMin = toMinutes(rules.endTime);
  if (startMin == null || endMin == null) return true;

  const nowMin = targetDate.getHours() * 60 + targetDate.getMinutes();
  return nowMin >= startMin && nowMin <= endMin;
}

function matchesOneOffOverride(layout: LayoutVariant, targetTime: number) {
  const rules = layout.effectiveRules;
  if (!rules?.oneOffOverrideWindows?.length) return null;

  const matching = rules.oneOffOverrideWindows
    .filter((window) => targetTime >= window.start && targetTime <= window.end)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return matching[0] ?? null;
}

function precedenceRank(layout: LayoutVariant): number {
  const precedence = layout.effectiveRules?.precedence ?? "SCHEDULED";
  if (precedence === "OVERRIDE") return 3;
  if (precedence === "DEFAULT") return 1;
  return 2;
}

function layoutPriority(layout: LayoutVariant): number {
  return layout.effectiveRules?.priority ?? 0;
}

function resolveByDeterministicOrder(layouts: LayoutVariant[]): LayoutVariant | null {
  if (!layouts.length) return null;

  const sorted = [...layouts].sort((a, b) => {
    const precedenceDiff = precedenceRank(b) - precedenceRank(a);
    if (precedenceDiff !== 0) return precedenceDiff;

    const priorityDiff = layoutPriority(b) - layoutPriority(a);
    if (priorityDiff !== 0) return priorityDiff;

    const updatedDiff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    if (updatedDiff !== 0) return updatedDiff;

    return a.id.localeCompare(b.id);
  });

  return sorted[0] ?? null;
}

export async function resolvePublishedLayout(
  locationId: string,
  floorId: string,
  targetDate = new Date()
): Promise<LayoutVariant | null> {
  const layouts = await getPublishedLayouts(locationId, floorId);
  if (!layouts.length) return null;

  const targetTime = targetDate.getTime();

  const overrideCandidates = layouts
    .map((layout) => ({
      layout,
      window: matchesOneOffOverride(layout, targetTime),
    }))
    .filter((item) => item.window != null)
    .sort((a, b) => {
      const windowPriorityDiff = (b.window?.priority ?? 0) - (a.window?.priority ?? 0);
      if (windowPriorityDiff !== 0) return windowPriorityDiff;

      const precedenceDiff = precedenceRank(b.layout) - precedenceRank(a.layout);
      if (precedenceDiff !== 0) return precedenceDiff;

      const layoutPriorityDiff = layoutPriority(b.layout) - layoutPriority(a.layout);
      if (layoutPriorityDiff !== 0) return layoutPriorityDiff;

      const updatedDiff = (b.layout.updatedAt ?? 0) - (a.layout.updatedAt ?? 0);
      if (updatedDiff !== 0) return updatedDiff;

      return a.layout.id.localeCompare(b.layout.id);
    });

  if (overrideCandidates.length) {
    return overrideCandidates[0]?.layout ?? null;
  }

  const scheduledMatches = layouts.filter((layout) => isWithinRuleWindow(layout, targetDate));
  const scheduledResolved = resolveByDeterministicOrder(scheduledMatches);
  if (scheduledResolved) return scheduledResolved;

  const defaultCandidates = layouts.filter(
    (layout) => (layout.effectiveRules?.precedence ?? "SCHEDULED") === "DEFAULT"
  );
  const defaultResolved = resolveByDeterministicOrder(defaultCandidates);
  if (defaultResolved) return defaultResolved;

  return resolveByDeterministicOrder(layouts);
}

export async function uploadFloorBackground(
  locationId: string,
  floorId: string,
  file: File
): Promise<{ storagePath: string; downloadUrl: string }> {
  const storagePath = `floorplanBackgrounds/${locationId}/${floorId}/${Date.now()}-${file.name}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file);
  const downloadUrl = await getDownloadURL(fileRef);
  return { storagePath, downloadUrl };
}

export async function deleteFloorBackground(storagePath: string): Promise<void> {
  if (!storagePath) return;
  await deleteObject(ref(storage, storagePath));
}

// --- Legacy Floorplans ---

// --- Site Settings ---

export async function getPublicSiteSettings(): Promise<PublicSiteSettingsDoc> {
  const ref = doc(db, "siteSettings", "public");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return {
      id: "public",
      comingSoonEnabled: false,
      updatedAt: 0,
    };
  }
  return snap.data() as PublicSiteSettingsDoc;
}

export async function setPublicSiteSettings(
  data: Pick<PublicSiteSettingsDoc, "comingSoonEnabled" | "updatedBy">
): Promise<void> {
  await setDoc(
    doc(db, "siteSettings", "public"),
    {
      id: "public",
      comingSoonEnabled: data.comingSoonEnabled,
      updatedAt: Date.now(),
      ...(data.updatedBy ? { updatedBy: data.updatedBy } : {}),
    },
    { merge: true }
  );
}

export function subscribeToPublicSiteSettings(
  callback: (settings: PublicSiteSettingsDoc) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, "siteSettings", "public"),
    (snap) => {
      if (!snap.exists()) {
        callback({
          id: "public",
          comingSoonEnabled: false,
          updatedAt: 0,
        });
        return;
      }
      callback(snap.data() as PublicSiteSettingsDoc);
    },
    (err) => {
      console.error("subscribeToPublicSiteSettings error:", err);
      callback({
        id: "public",
        comingSoonEnabled: false,
        updatedAt: 0,
      });
    }
  );
}

export async function getFloorplansFromFirestore(): Promise<Floorplan[]> {
  const q = query(collection(db, "floorplans"), orderBy("levelIndex"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => doc.data() as Floorplan);
}

export async function saveFloorplanToFirestore(floorplan: Floorplan) {
  await setDoc(doc(db, "floorplans", floorplan.id), floorplan);
}

export async function deleteFloorplanFromFirestore(id: string) {
  await deleteDoc(doc(db, "floorplans", id));
}

// --- Bookings ---

export async function createBookingInFirestore(booking: Omit<Booking, "id" | "createdAt">) {
  // In a real app, this would be a cloud function transaction to enforce slot locking.
  // For this prototype phase, we write directly to Firestore.
  const bookingRef = doc(collection(db, "bookings"));
  const finalBooking: Booking = {
    ...booking,
    id: bookingRef.id,
    createdAt: Date.now()
  };
  await setDoc(bookingRef, finalBooking);
  return finalBooking;
}

export async function getUserBookingsFromFirestore(userId: string): Promise<Booking[]> {
  const q = query(
    collection(db, "bookings"),
    where("userId", "==", userId),
    orderBy("start", "desc")
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => doc.data() as Booking);
}

export async function getBookingsInRange(start: number, end: number): Promise<Booking[]> {
  // Note: Range queries for overlaps in NoSQL are tricky.
  // Standard approach: find bookings where 'end' > requested_start
  // Then client-side filter for 'start' < requested_end
  // This requires a composite index on end ASC.
  
  const q = query(
    collection(db, "bookings"),
    where("end", ">", start),
    // orderBy("end") // Implicitly ordered by inequality filter
  );
  
  const querySnapshot = await getDocs(q);
  const candidates = querySnapshot.docs.map((doc) => doc.data() as Booking);
  
  // Client-side filter for the other bound
  return candidates.filter(b => b.start < end && b.status !== "CANCELLED");
}

// --- Profiles (PR-05) ---

export async function getProfileFromFirestore(uid: string): Promise<ProfileDoc | null> {
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? (snap.data() as ProfileDoc) : null;
}

export async function saveProfileToFirestore(uid: string, data: Partial<ProfileDoc>): Promise<void> {
  const ref = doc(db, "profiles", uid);
  const existing = await getDoc(ref);

  if (existing.exists()) {
    await setDoc(ref, { ...data, uid, updatedAt: Date.now() }, { merge: true });
  } else {
    await setDoc(ref, {
      ...data,
      uid,
      published: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

/**
 * Compute profile completeness score (0–100).
 * Field weights:
 *   businessName: 15, bio: 10, website: 5, linkedin: 5,
 *   naicsCodes (≥1): 15, certifications (≥1): 10,
 *   uei: 10, duns: 5, cageCode: 5,
 *   capabilityStatementUrl: 15, photoUrl: 5
 */
export function computeProfileCompleteness(profile: Partial<ProfileDoc> | null): number {
  if (!profile) return 0;
  let score = 0;
  if (profile.businessName) score += 15;
  if (profile.bio) score += 10;
  if (profile.website) score += 5;
  if (profile.linkedin) score += 5;
  if (profile.naicsCodes && profile.naicsCodes.length > 0) score += 15;
  if (profile.certifications && profile.certifications.length > 0) score += 10;
  if (profile.uei) score += 10;
  if (profile.duns) score += 5;
  if (profile.cageCode) score += 5;
  if (profile.capabilityStatementUrl) score += 15;
  if (profile.photoUrl) score += 5;
  return score;
}

/** Procurement-Ready threshold: 70+ */
export function isProcurementReady(score: number): boolean {
  return score >= 70;
}

// --- Directory (PR-07) ---

export interface DirectoryFilters {
  certification?: string;
  procurementReady?: boolean;
  search?: string; // client-side filter on businessName/bio
}

export interface DirectoryPage {
  profiles: ProfileDoc[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Fetch published profiles with optional filters and cursor-based pagination.
 * NAICS filter uses array-contains (Firestore limitation: one per query).
 * Certification and search filters are applied client-side.
 */
export async function getPublishedProfiles(
  filters: DirectoryFilters = {},
  pageSize = 12,
  afterDoc?: QueryDocumentSnapshot<DocumentData> | null
): Promise<DirectoryPage> {
  const col = collection(db, "profiles");
  const q = afterDoc
    ? query(col, where("published", "==", true), orderBy("businessName"), startAfter(afterDoc), limit(pageSize + 1))
    : query(col, where("published", "==", true), orderBy("businessName"), limit(pageSize + 1));
  const snap = await getDocs(q);

  let profiles = snap.docs.map((d) => d.data() as ProfileDoc);
  const rawDocs = snap.docs;

  // Client-side filters
  if (filters.certification) {
    const cert = filters.certification;
    profiles = profiles.filter((p) => p.certifications?.includes(cert));
  }
  if (filters.procurementReady) {
    profiles = profiles.filter(
      (p) => (p.profileCompletenessScore ?? 0) >= 70
    );
  }
  if (filters.search) {
    const term = filters.search.toLowerCase();
    profiles = profiles.filter(
      (p) =>
        (p.businessName?.toLowerCase().includes(term)) ||
        (p.bio?.toLowerCase().includes(term))
    );
  }

  const hasMore = rawDocs.length > pageSize;
  if (hasMore) {
    profiles = profiles.slice(0, pageSize);
  }

  return {
    profiles,
    lastDoc: rawDocs.length > 0 ? rawDocs[Math.min(rawDocs.length - 1, pageSize - 1)] : null,
    hasMore,
  };
}

/**
 * Count published profiles that share at least one NAICS code with the given list.
 * Uses client-side filtering since Firestore doesn't support array-contains-any + where published.
 */
export async function countPublishedProfilesByNaics(
  naicsCodes: string[]
): Promise<number> {
  if (naicsCodes.length === 0) return 0;
  const q = query(
    collection(db, "profiles"),
    where("published", "==", true)
  );
  const snap = await getDocs(q);
  let count = 0;
  snap.docs.forEach((d) => {
    const p = d.data() as ProfileDoc;
    if (p.naicsCodes?.some((code) => naicsCodes.includes(code))) {
      count++;
    }
  });
  return count;
}

// --- PR-08: Personalized Dashboard Helpers ---

/**
 * Fetch open, approved RFx docs that match any of the given NAICS codes.
 * Falls back to a flat open list when no codes are provided.
 */
export async function getRecommendedRfx(
  naicsCodes: string[],
  maxResults = 5
): Promise<RfxDoc[]> {
  const q = query(
    collection(db, "rfx"),
    where("status", "==", "open"),
    where("adminApprovalStatus", "==", "approved"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  const snap = await getDocs(q);
  const all = snap.docs.map((d) => d.data() as RfxDoc);

  if (naicsCodes.length === 0) return all.slice(0, maxResults);

  // Prioritise RFxs whose NAICS codes overlap with the member's codes
  const matched: RfxDoc[] = [];
  const unmatched: RfxDoc[] = [];
  for (const rfx of all) {
    if (rfx.naicsCodes?.some((c) => naicsCodes.includes(c))) {
      matched.push(rfx);
    } else {
      unmatched.push(rfx);
    }
  }
  return [...matched, ...unmatched].slice(0, maxResults);
}

interface UserSuggestionEntry {
  rfxId: string;
  score: number;
  reasons?: string[];
}

interface UserSuggestionDoc {
  uid: string;
  suggestions: UserSuggestionEntry[];
  generatedAt: number;
  expiresAt: number;
  algorithmVersion?: string;
}

/**
 * Phase 6 helper: return RFx feed from precomputed userSuggestions/{uid}.
 * Falls back to NAICS-only recommendations if no cached suggestion document exists.
 */
export async function getRfxSuggestionsForUser(
  uid: string,
  naicsCodes: string[],
  maxResults = 24
): Promise<RfxDoc[]> {
  const suggestionSnap = await getDoc(doc(db, "userSuggestions", uid));
  if (!suggestionSnap.exists()) {
    return getRecommendedRfx(naicsCodes, maxResults);
  }

  const suggestionDoc = suggestionSnap.data() as UserSuggestionDoc;
  const now = Date.now();
  if (!suggestionDoc.suggestions?.length || (suggestionDoc.expiresAt && suggestionDoc.expiresAt < now)) {
    return getRecommendedRfx(naicsCodes, maxResults);
  }

  const rankedIds = suggestionDoc.suggestions
    .map((s) => s.rfxId)
    .filter(Boolean)
    .slice(0, maxResults);

  if (rankedIds.length === 0) {
    return getRecommendedRfx(naicsCodes, maxResults);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < rankedIds.length; i += 10) {
    chunks.push(rankedIds.slice(i, i + 10));
  }

  const rfxById = new Map<string, RfxDoc>();
  for (const idChunk of chunks) {
    const q = query(
      collection(db, "rfx"),
      where(documentId(), "in", idChunk),
      where("status", "==", "open"),
      where("adminApprovalStatus", "==", "approved")
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const rfx = d.data() as RfxDoc;
      rfxById.set(rfx.id, rfx);
    });
  }

  return rankedIds
    .map((id) => rfxById.get(id))
    .filter((rfx): rfx is RfxDoc => Boolean(rfx))
    .slice(0, maxResults);
}

/**
 * Fetch published profiles that share at least one NAICS code, excluding a
 * given uid (the current user). Returns up to `maxResults` profiles.
 */
export async function getSuggestedConnections(
  naicsCodes: string[],
  excludeUid: string,
  maxResults = 5
): Promise<ProfileDoc[]> {
  if (naicsCodes.length === 0) return [];
  const q = query(
    collection(db, "profiles"),
    where("published", "==", true)
  );
  const snap = await getDocs(q);
  const results: ProfileDoc[] = [];
  for (const d of snap.docs) {
    const p = d.data() as ProfileDoc;
    if (p.uid === excludeUid) continue;
    if (p.naicsCodes?.some((code) => naicsCodes.includes(code))) {
      results.push(p);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

/**
 * Count how many RFx responses the user has submitted (active bids).
 */
export async function getUserActiveBidCount(uid: string): Promise<number> {
  const q = query(
    collection(db, "rfxResponses"),
    where("respondentUid", "==", uid),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  return snap.size;
}

/**
 * Count how many responses have been received on the user's own RFxs.
 */
export async function getReceivedResponseCount(uid: string): Promise<number> {
  const q = query(
    collection(db, "rfxResponses"),
    where("rfxOwnerUid", "==", uid)
  );
  const snap = await getDocs(q);
  return snap.size;
}

// --- UserDoc helpers (PR-08) ---

export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function updateUserMembershipTrack(
  uid: string,
  track: MembershipTrack
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    membershipTrack: track,
    updatedAt: Date.now(),
  });
}

// --- RFx (PR-06) ---

export async function createRfxInFirestore(
  data: Omit<RfxDoc, "id" | "createdAt" | "responseCount">
): Promise<RfxDoc> {
  const rfxRef = doc(collection(db, "rfx"));
  const rfx: RfxDoc = {
    ...data,
    id: rfxRef.id,
    responseCount: 0,
    createdAt: Date.now(),
  };
  await setDoc(rfxRef, rfx);
  return rfx;
}

export async function getRfxFromFirestore(rfxId: string): Promise<RfxDoc | null> {
  const snap = await getDoc(doc(db, "rfx", rfxId));
  return snap.exists() ? (snap.data() as RfxDoc) : null;
}

export async function getOpenRfxListFromFirestore(
  maxResults = 50
): Promise<RfxDoc[]> {
  const q = query(
    collection(db, "rfx"),
    where("status", "==", "open"),
    where("adminApprovalStatus", "==", "approved"),
    orderBy("createdAt", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as RfxDoc);
}

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = "";
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngMin = mid;
      } else {
        idx = idx * 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }

    evenBit = !evenBit;
    if (++bit === 5) {
      geohash += GEOHASH_BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

function geohashPrecisionForZoom(zoom: number): number {
  if (zoom <= 7) return 3;
  if (zoom <= 9) return 4;
  if (zoom <= 11) return 5;
  return 6;
}

function geohashPrefixesForBounds(bounds: ViewportBounds): string[] {
  const precision = geohashPrecisionForZoom(bounds.zoom);
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;

  const points: Array<[number, number]> = [
    [bounds.north, bounds.west],
    [bounds.north, bounds.east],
    [bounds.south, bounds.west],
    [bounds.south, bounds.east],
    [centerLat, centerLng],
  ];

  const set = new Set<string>();
  points.forEach(([lat, lng]) => {
    set.add(encodeGeohash(lat, lng, precision));
  });

  return Array.from(set).slice(0, 8);
}

function pointInsideBounds(lat: number, lng: number, bounds: ViewportBounds): boolean {
  const withinLat = lat <= bounds.north && lat >= bounds.south;
  const withinLng = lng >= bounds.west && lng <= bounds.east;
  return withinLat && withinLng;
}

/**
 * Fetch open/approved RFx docs by viewport using geohash prefix range queries.
 * This is optimized for map pin rendering and keeps result sets bounded.
 */
export async function getOpenRfxByViewportGeohash(
  bounds: ViewportBounds,
  maxResults = 200
): Promise<RfxDoc[]> {
  const prefixes = geohashPrefixesForBounds(bounds);
  if (prefixes.length === 0) return [];

  const byId = new Map<string, RfxDoc>();
  for (const prefix of prefixes) {
    const q = query(
      collection(db, "rfx"),
      where("status", "==", "open"),
      where("adminApprovalStatus", "==", "approved"),
      orderBy("geo.geohash"),
      startAt(prefix),
      endAt(`${prefix}\uf8ff`),
      limit(Math.ceil(maxResults / Math.max(prefixes.length, 1)) + 20)
    );

    const snap = await getDocs(q);
    snap.docs.forEach((docSnap) => {
      const rfx = docSnap.data() as RfxDoc;
      const lat = rfx.geo?.lat;
      const lng = rfx.geo?.lng;
      if (typeof lat !== "number" || typeof lng !== "number") return;
      if (!pointInsideBounds(lat, lng, bounds)) return;
      byId.set(rfx.id, rfx);
    });
  }

  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, maxResults);
}

export async function getUserRfxListFromFirestore(
  uid: string,
  maxResults = 50
): Promise<RfxDoc[]> {
  const q = query(
    collection(db, "rfx"),
    where("createdBy", "==", uid),
    orderBy("createdAt", "desc"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as RfxDoc);
}

export async function getUserActiveRfxCount(uid: string): Promise<number> {
  const q = query(
    collection(db, "rfx"),
    where("createdBy", "==", uid),
    where("status", "==", "open")
  );
  const snap = await getDocs(q);
  return snap.size;
}

export async function updateRfxInFirestore(
  rfxId: string,
  data: Partial<RfxDoc>
): Promise<void> {
  await updateDoc(doc(db, "rfx", rfxId), { ...data, updatedAt: Date.now() });
}

// --- RFx Responses ---

export async function createRfxResponseInFirestore(
  data: Omit<RfxResponseDoc, "id" | "submittedAt" | "status">
): Promise<RfxResponseDoc> {
  const respRef = doc(collection(db, "rfxResponses"));
  const resp: RfxResponseDoc = {
    ...data,
    id: respRef.id,
    status: "pending",
    submittedAt: Date.now(),
  };
  await setDoc(respRef, resp);
  // Increment response count on the parent RFx
  await updateDoc(doc(db, "rfx", data.rfxId), { responseCount: increment(1) });
  return resp;
}

export async function getRfxResponsesFromFirestore(
  rfxId: string
): Promise<RfxResponseDoc[]> {
  const q = query(
    collection(db, "rfxResponses"),
    where("rfxId", "==", rfxId),
    orderBy("submittedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as RfxResponseDoc);
}

export function subscribeToRfxResponses(
  rfxId: string,
  callback: (responses: RfxResponseDoc[]) => void
): Unsubscribe {
  const q = query(
    collection(db, "rfxResponses"),
    where("rfxId", "==", rfxId),
    orderBy("submittedAt", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => d.data() as RfxResponseDoc));
    },
    (err) => {
      console.error("subscribeToRfxResponses error:", err);
    }
  );
}

export async function updateRfxResponseStatus(
  responseId: string,
  status: "accepted" | "declined",
  scores?: { criteriaScores: Record<string, number>; totalScore: number }
): Promise<void> {
  const data: Record<string, unknown> = { status };
  if (scores) {
    data.criteriaScores = scores.criteriaScores;
    data.totalScore = scores.totalScore;
  }
  await updateDoc(doc(db, "rfxResponses", responseId), data);
}

export async function getUserRfxResponsesFromFirestore(
  uid: string
): Promise<RfxResponseDoc[]> {
  const q = query(
    collection(db, "rfxResponses"),
    where("respondentUid", "==", uid),
    orderBy("submittedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as RfxResponseDoc);
}

// --- Payments Ledger (PR-09) ---

export interface PaymentLedgerFilters {
  provider?: PaymentProvider;
  status?: PaymentStatus;
  purpose?: PaymentPurpose;
  search?: string; // client-side filter on uid
}

export interface PaymentLedgerPage {
  payments: PaymentDoc[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Fetch payments for the admin ledger with optional filters and pagination.
 * Filters that Firestore can handle are applied server-side; the rest
 * are applied client-side.
 */
export async function getPaymentsLedger(
  filters: PaymentLedgerFilters = {},
  pageSize = 20,
  afterDoc?: QueryDocumentSnapshot<DocumentData> | null
): Promise<PaymentLedgerPage> {
  const col = collection(db, "payments");
  const constraints: Parameters<typeof query>[1][] = [];

  if (filters.provider) constraints.push(where("provider", "==", filters.provider));
  if (filters.status) constraints.push(where("status", "==", filters.status));
  if (filters.purpose) constraints.push(where("purpose", "==", filters.purpose));

  constraints.push(orderBy("createdAt", "desc"));
  if (afterDoc) constraints.push(startAfter(afterDoc));
  constraints.push(limit(pageSize + 1));

  const q = query(col, ...constraints);
  const snap = await getDocs(q);

  let payments = snap.docs.map((d) => d.data() as PaymentDoc);
  const rawDocs = snap.docs;

  // Client-side search filter
  if (filters.search) {
    const term = filters.search.toLowerCase();
    payments = payments.filter(
      (p) =>
        p.uid.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term) ||
        (p.purposeRefId?.toLowerCase().includes(term))
    );
  }

  const hasMore = rawDocs.length > pageSize;
  if (hasMore) {
    payments = payments.slice(0, pageSize);
  }

  return {
    payments,
    lastDoc: rawDocs.length > 0 ? rawDocs[Math.min(rawDocs.length - 1, pageSize - 1)] : null,
    hasMore,
  };
}

// --- Products (PR-11) ---

export async function getProducts(): Promise<ProductDoc[]> {
  const q = query(
    collection(db, "products"),
    where("active", "==", true),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ProductDoc);
}

export async function getAllProducts(): Promise<ProductDoc[]> {
  const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ProductDoc);
}

export async function getProduct(productId: string): Promise<ProductDoc | null> {
  const snap = await getDoc(doc(db, "products", productId));
  return snap.exists() ? (snap.data() as ProductDoc) : null;
}

export async function saveProduct(product: ProductDoc): Promise<void> {
  await setDoc(doc(db, "products", product.id), product);
}

export async function updateProductQBLink(
  productId: string,
  quickbooksPaymentLinkUrl: string
): Promise<void> {
  await updateDoc(doc(db, "products", productId), {
    quickbooksPaymentLinkUrl,
    updatedAt: Date.now(),
  });
}

// --- Payment Audit Trail (PR-11) ---

export async function getPaymentAuditTrail(
  paymentId: string
): Promise<PaymentAuditEntry[]> {
  const q = query(
    collection(db, "paymentAudit"),
    where("paymentId", "==", paymentId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as PaymentAuditEntry);
}

// --- Events (PR-15) ---

export interface EventFilters {
  format?: EventFormat;
  status?: EventStatus;
  upcoming?: boolean;
}

export async function getEvents(filters?: EventFilters): Promise<EventDoc[]> {
  const constraints: Parameters<typeof query>[1][] = [];

  if (filters?.status) {
    constraints.push(where("status", "==", filters.status));
  } else {
    constraints.push(where("status", "==", "published"));
  }

  if (filters?.format) {
    constraints.push(where("format", "==", filters.format));
  }

  if (filters?.upcoming) {
    constraints.push(where("startTime", ">=", Date.now()));
  }

  constraints.push(orderBy("startTime", "asc"));
  constraints.push(limit(50));

  const q = query(collection(db, "events"), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventDoc);
}

export async function getAllEvents(): Promise<EventDoc[]> {
  const q = query(collection(db, "events"), orderBy("startTime", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventDoc);
}

export async function getEvent(eventId: string): Promise<EventDoc | null> {
  const snap = await getDoc(doc(db, "events", eventId));
  return snap.exists() ? (snap.data() as EventDoc) : null;
}

export async function saveEvent(event: EventDoc): Promise<void> {
  await setDoc(doc(db, "events", event.id), event);
}

export async function updateEvent(
  eventId: string,
  data: Partial<EventDoc>
): Promise<void> {
  await updateDoc(doc(db, "events", eventId), { ...data, updatedAt: Date.now() });
}

export async function getEventRegistrations(
  eventId: string
): Promise<EventRegistrationDoc[]> {
  const q = query(
    collection(db, "events", eventId, "registrations"),
    orderBy("registeredAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventRegistrationDoc);
}

export async function getUserRegistration(
  eventId: string,
  uid: string
): Promise<EventRegistrationDoc | null> {
  const snap = await getDoc(doc(db, "events", eventId, "registrations", uid));
  return snap.exists() ? (snap.data() as EventRegistrationDoc) : null;
}

export async function registerForEvent(
  eventId: string,
  registration: EventRegistrationDoc
): Promise<void> {
  await setDoc(
    doc(db, "events", eventId, "registrations", registration.uid),
    registration
  );
  await updateDoc(doc(db, "events", eventId), {
    registrationCount: increment(1),
  });
}

export async function cancelRegistration(
  eventId: string,
  uid: string
): Promise<void> {
  await deleteDoc(doc(db, "events", eventId, "registrations", uid));
  await updateDoc(doc(db, "events", eventId), {
    registrationCount: increment(-1),
  });
}

export async function uploadEventMediaImage(
  entityType: "events" | "series",
  entityId: string,
  file: File
): Promise<EventMediaImage> {
  const storagePath = `event-media/${entityType}/${entityId}/${Date.now()}-${file.name}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file);
  const downloadUrl = await getDownloadURL(fileRef);
  return {
    storagePath,
    downloadUrl,
    alt: file.name,
  };
}

export async function getEventCampaigns(): Promise<EventCampaignDoc[]> {
  const q = query(collection(db, "eventCampaigns"), orderBy("createdAt", "desc"), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventCampaignDoc);
}

export async function saveEventCampaign(campaign: EventCampaignDoc): Promise<void> {
  await setDoc(doc(db, "eventCampaigns", campaign.id), campaign, { merge: true });
}

export async function getCampaignJobs(campaignId: string): Promise<CampaignJobDoc[]> {
  const q = query(
    collection(db, "campaignJobs"),
    where("campaignId", "==", campaignId),
    orderBy("scheduledFor", "asc"),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CampaignJobDoc);
}

export async function getEventShareKits(): Promise<EventShareKitDoc[]> {
  const q = query(collection(db, "eventShareKits"), orderBy("createdAt", "desc"), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventShareKitDoc);
}

export async function saveEventShareKit(shareKit: EventShareKitDoc): Promise<void> {
  await setDoc(doc(db, "eventShareKits", shareKit.id), shareKit, { merge: true });
}

export async function getSocialPosts(): Promise<SocialPostDoc[]> {
  const q = query(collection(db, "socialPosts"), orderBy("scheduledFor", "desc"), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as SocialPostDoc);
}

export async function saveSocialPost(post: SocialPostDoc): Promise<void> {
  await setDoc(doc(db, "socialPosts", post.id), post, { merge: true });
}

// --- Event Series ---

export async function getEventSeriesList(): Promise<EventSeriesDoc[]> {
  const q = query(
    collection(db, "eventSeries"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventSeriesDoc);
}

export async function getEventSeries(seriesId: string): Promise<EventSeriesDoc | null> {
  const snap = await getDoc(doc(db, "eventSeries", seriesId));
  return snap.exists() ? (snap.data() as EventSeriesDoc) : null;
}

export async function getSeriesOccurrences(seriesId: string): Promise<EventDoc[]> {
  const q = query(
    collection(db, "events"),
    where("seriesId", "==", seriesId),
    orderBy("startTime", "asc"),
    limit(200)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventDoc);
}

// --- Referrals (PR-16 & Monetization) ---

export async function getReferralPolicy(uid: string): Promise<ReferralPolicyDoc | null> {
  const snap = await getDoc(doc(db, "referralPolicies", uid));
  return snap.exists() ? (snap.data() as ReferralPolicyDoc) : null;
}

export async function saveReferralPolicy(policy: ReferralPolicyDoc): Promise<void> {
  await setDoc(doc(db, "referralPolicies", policy.uid), policy);
}

export async function getReferralsSent(uid: string): Promise<ReferralDoc[]> {
  const q = query(
    collection(db, "referrals"),
    where("referrerUid", "==", uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ReferralDoc);
}

export async function getReferralsSentThisMonthCount(uid: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const q = query(
    collection(db, "referrals"),
    where("referrerUid", "==", uid),
    where("createdAt", ">=", startOfMonth)
  );
  const snap = await getDocs(q);
  return snap.size;
}

export async function getReferralsReceived(email: string): Promise<ReferralDoc[]> {
  const q = query(
    collection(db, "referrals"),
    where("referredEmail", "==", email),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ReferralDoc);
}

export async function getProviderReferrals(uid: string): Promise<ReferralDoc[]> {
  const q = query(
    collection(db, "referrals"),
    where("providerUid", "==", uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ReferralDoc);
}

export async function createReferral(referral: ReferralDoc): Promise<void> {
  await setDoc(doc(db, "referrals", referral.id), referral);
}

export async function updateReferralStatus(
  referralId: string,
  status: ReferralStatus
): Promise<void> {
  await updateDoc(doc(db, "referrals", referralId), {
    status,
    updatedAt: Date.now(),
  });
}

export async function getReferralCount(uid: string): Promise<number> {
  const q = query(
    collection(db, "referrals"),
    where("referrerUid", "==", uid),
    where("status", "==", "converted")
  );
  const snap = await getDocs(q);
  return snap.size;
}

export async function getReferralLeaderboard(): Promise<{ uid: string; count: number; displayName?: string }[]> {
  const q = query(collection(db, "referrals"), where("status", "==", "converted"));
  const snap = await getDocs(q);
  const counts: Record<string, number> = {};
  snap.docs.forEach((d) => {
    const uid = (d.data() as ReferralDoc).referrerUid;
    counts[uid] = (counts[uid] || 0) + 1;
  });
  const sorted = Object.entries(counts)
    .map(([uid, count]) => ({ uid, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Resolve display names from user docs
  const results = await Promise.all(
    sorted.map(async (entry) => {
      try {
        const userSnap = await getDoc(doc(db, "users", entry.uid));
        const displayName = userSnap.exists() ? (userSnap.data().displayName as string) || undefined : undefined;
        return { ...entry, displayName };
      } catch {
        return entry;
      }
    })
  );
  return results;
}

// --- RFx Team Invites (PR-16) ---

export async function getTeamInvitesForRfx(
  rfxId: string
): Promise<RfxTeamInviteDoc[]> {
  const q = query(
    collection(db, "rfxTeamInvites"),
    where("rfxId", "==", rfxId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as RfxTeamInviteDoc);
}

export async function getTeamInvitesReceived(
  uid: string
): Promise<RfxTeamInviteDoc[]> {
  const q = query(
    collection(db, "rfxTeamInvites"),
    where("inviteeUid", "==", uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as RfxTeamInviteDoc);
}

export async function createTeamInvite(
  invite: RfxTeamInviteDoc
): Promise<void> {
  await setDoc(doc(db, "rfxTeamInvites", invite.id), invite);
}

export async function updateTeamInviteStatus(
  inviteId: string,
  status: "accepted" | "declined"
): Promise<void> {
  await updateDoc(doc(db, "rfxTeamInvites", inviteId), {
    status,
    updatedAt: Date.now(),
  });
}

// --- Organizations (PR-17) ---

export async function getOrg(orgId: string): Promise<OrgDoc | null> {
  const snap = await getDoc(doc(db, "orgs", orgId));
  return snap.exists() ? (snap.data() as OrgDoc) : null;
}

export async function getOrgBySlug(slug: string): Promise<OrgDoc | null> {
  const q = query(collection(db, "orgs"), where("slug", "==", slug), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : (snap.docs[0].data() as OrgDoc);
}

export async function getUserOrgs(uid: string): Promise<OrgMemberDoc[]> {
  const q = query(
    collection(db, "orgMembers"),
    where("uid", "==", uid),
    orderBy("joinedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as OrgMemberDoc);
}

export async function getOrgMembers(orgId: string): Promise<OrgMemberDoc[]> {
  const q = query(
    collection(db, "orgMembers"),
    where("orgId", "==", orgId),
    orderBy("joinedAt", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as OrgMemberDoc);
}

export async function saveOrg(org: OrgDoc): Promise<void> {
  await setDoc(doc(db, "orgs", org.id), org);
}

export async function updateOrg(
  orgId: string,
  data: Partial<OrgDoc>
): Promise<void> {
  await updateDoc(doc(db, "orgs", orgId), { ...data, updatedAt: Date.now() });
}

export async function addOrgMember(member: OrgMemberDoc): Promise<void> {
  await setDoc(doc(db, "orgMembers", member.id), member);
  await updateDoc(doc(db, "orgs", member.orgId), {
    seatsUsed: increment(1),
    updatedAt: Date.now(),
  });
}

export async function removeOrgMember(
  memberId: string,
  orgId: string
): Promise<void> {
  await deleteDoc(doc(db, "orgMembers", memberId));
  await updateDoc(doc(db, "orgs", orgId), {
    seatsUsed: increment(-1),
    updatedAt: Date.now(),
  });
}

export async function getOrgPayments(orgId: string): Promise<PaymentDoc[]> {
  const q = query(
    collection(db, "payments"),
    where("metadata.orgId", "==", orgId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as PaymentDoc);
}

// --- Notifications (PR-18) ---

export async function getNotifications(
  uid: string,
  maxCount = 50
): Promise<NotificationDoc[]> {
  const q = query(
    collection(db, "notifications"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(maxCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as NotificationDoc);
}

export async function getUnreadNotificationCount(
  uid: string
): Promise<number> {
  const q = query(
    collection(db, "notifications"),
    where("uid", "==", uid),
    where("read", "==", false)
  );
  const snap = await getDocs(q);
  return snap.size;
}

export function subscribeToUnreadCount(
  uid: string,
  callback: (count: number) => void
): Unsubscribe {
  const q = query(
    collection(db, "notifications"),
    where("uid", "==", uid),
    where("read", "==", false)
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.size);
    },
    (err) => {
      console.error("subscribeToUnreadCount error:", err);
      callback(0);
    }
  );
}

export async function markNotificationRead(
  notifId: string
): Promise<void> {
  await updateDoc(doc(db, "notifications", notifId), { read: true });
}

export async function markAllNotificationsRead(
  uid: string
): Promise<void> {
  const q = query(
    collection(db, "notifications"),
    where("uid", "==", uid),
    where("read", "==", false)
  );
  const snap = await getDocs(q);
  const promises = snap.docs.map((d) =>
    updateDoc(doc(db, "notifications", d.id), { read: true })
  );
  await Promise.all(promises);
}

// --- Bookstore ---

export async function getPublishedBooks(): Promise<BookDoc[]> {
  const q = query(
    collection(db, "books"),
    where("published", "==", true),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BookDoc);
}

export async function getBooksBySeries(seriesTitle: string): Promise<BookDoc[]> {
  const q = query(
    collection(db, "books"),
    where("seriesTitle", "==", seriesTitle)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as BookDoc)
    .filter((b) => b.published)
    .sort((a, b) => (a.seriesOrder ?? 999) - (b.seriesOrder ?? 999));
}

export async function getAllBooks(): Promise<BookDoc[]> {
  const q = query(collection(db, "books"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BookDoc);
}

export async function getBook(bookId: string): Promise<BookDoc | null> {
  const snap = await getDoc(doc(db, "books", bookId));
  return snap.exists() ? (snap.data() as BookDoc) : null;
}

export async function saveBook(book: BookDoc): Promise<void> {
  await setDoc(doc(db, "books", book.id), book);
}

export async function updateBook(
  bookId: string,
  data: Partial<BookDoc>
): Promise<void> {
  await updateDoc(doc(db, "books", bookId), { ...data, updatedAt: Date.now() });
}

export async function deleteBook(bookId: string): Promise<void> {
  await deleteDoc(doc(db, "books", bookId));
}

export async function trackAffiliateClick(
  click: BookAffiliateClickDoc
): Promise<void> {
  await setDoc(doc(db, "bookAffiliateClicks", click.id), click);
}

export async function createBookPurchase(
  purchase: BookPurchaseDoc
): Promise<void> {
  await setDoc(doc(db, "bookPurchases", purchase.id), purchase);
}

export async function getUserBookPurchases(
  userId: string
): Promise<BookPurchaseDoc[]> {
  const q = query(
    collection(db, "bookPurchases"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BookPurchaseDoc);
}

// --- Smart Access (Doors / Grants / Codes / Events) ---

export async function getDoors(): Promise<DoorDoc[]> {
  const snap = await getDocs(collection(db, "doors"));
  return snap.docs.map((d) => d.data() as DoorDoc);
}

export async function getDoor(doorId: string): Promise<DoorDoc | null> {
  const snap = await getDoc(doc(db, "doors", doorId));
  return snap.exists() ? (snap.data() as DoorDoc) : null;
}

export async function getAccessGrantsForUser(
  userId: string,
  limitCount = 20
): Promise<AccessGrantDoc[]> {
  const now = Date.now();
  const q = query(
    collection(db, "accessGrants"),
    where("userId", "==", userId),
    where("endsAt", ">", now - 60 * 60 * 1000),
    orderBy("endsAt", "asc"),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AccessGrantDoc);
}

export async function getActiveAccessGrants(limitCount = 100): Promise<AccessGrantDoc[]> {
  const now = Date.now();
  const q = query(
    collection(db, "accessGrants"),
    where("endsAt", ">", now),
    where("status", "in", ["pending", "active"]),
    orderBy("endsAt", "asc"),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AccessGrantDoc);
}

export async function getAccessCodesForGrant(grantId: string): Promise<AccessCodeDoc[]> {
  const q = query(
    collection(db, "accessCodes"),
    where("grantId", "==", grantId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AccessCodeDoc);
}

export async function getAccessEvents(
  filters: { doorId?: string; grantId?: string; limitCount?: number } = {}
): Promise<AccessEventDoc[]> {
  const constraints = [
    ...(filters.doorId ? [where("doorId", "==", filters.doorId)] : []),
    ...(filters.grantId ? [where("grantId", "==", filters.grantId)] : []),
    orderBy("createdAt", "desc"),
    limit(filters.limitCount ?? 100),
  ];
  const q = query(collection(db, "accessEvents"), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AccessEventDoc);
}

export function subscribeToAccessGrants(
  callback: (grants: AccessGrantDoc[]) => void
): Unsubscribe {
  const now = Date.now();
  const q = query(
    collection(db, "accessGrants"),
    where("endsAt", ">", now),
    where("status", "in", ["pending", "active"]),
    orderBy("endsAt", "asc"),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => d.data() as AccessGrantDoc));
  });
}
