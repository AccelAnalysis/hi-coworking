import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore();

const SETUPS = "spaceSetups";
const ADDONS = "spaceAddOns";

type ServiceType = "DESK" | "CONFERENCE";

type SetupInput = {
  id?: string;
  layoutPath?: string;
  name?: string;
  serviceType?: ServiceType;
  resourceId?: string;
  capacity?: number;
  description?: string;
  arrangement?: string;
  addOnIds?: string[];
  published?: boolean;
};

type AddOnInput = {
  id?: string;
  name?: string;
  description?: string;
  priceCents?: number;
  stripePriceId?: string;
  serviceTypes?: ServiceType[];
  published?: boolean;
};

function requireAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const role = String(request.auth.token.role || "");
  if (role !== "admin" && role !== "master") throw new HttpsError("permission-denied", "Admin access is required.");
  return request.auth.uid;
}

function cleanId(value: string) {
  const next = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!next) throw new HttpsError("invalid-argument", "A valid identifier is required.");
  return next;
}

function publishedLayoutSummary(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const parts = doc.ref.path.split("/");
  const data = doc.data();
  return {
    layoutPath: doc.ref.path,
    layoutId: doc.id,
    locationId: parts[1] || "",
    floorId: parts[3] || "",
    name: String(data.name || "Published layout"),
    updatedAt: Number(data.updatedAt || 0),
    resourceIds: Array.from(new Set(
      Array.isArray(data.elements)
        ? data.elements.map((element: Record<string, unknown>) => String(element.resourceId || "")).filter(Boolean)
        : [],
    )),
  };
}

/**
 * Walk locations → floors → layouts with collection-scoped queries. A
 * collectionGroup("layouts") query needs a collection-group index that this
 * project does not have (and indexes are never deployed from a file here).
 */
async function publishedLayouts() {
  const locations = await db.collection("locations").get();
  const floorSnaps = await Promise.all(locations.docs.map((location) => location.ref.collection("floors").get()));
  const layoutSnaps = await Promise.all(
    floorSnaps.flatMap((floors) => floors.docs.map((floor) =>
      floor.ref.collection("layouts").where("status", "==", "PUBLISHED").get())),
  );
  return layoutSnaps.flatMap((snap) => snap.docs.map(publishedLayoutSummary));
}

/** What customers may see about a setup: no admin uids or audit fields. */
export function publicSetup(id: string, data: Record<string, unknown>) {
  return {
    id,
    name: String(data.name || ""),
    serviceType: data.serviceType === "DESK" ? "DESK" : "CONFERENCE",
    resourceId: String(data.resourceId || ""),
    layoutPath: String(data.layoutPath || ""),
    capacity: Number(data.capacity || 1),
    description: String(data.description || ""),
    arrangement: String(data.arrangement || ""),
    addOnIds: Array.isArray(data.addOnIds) ? data.addOnIds.map(String) : [],
  };
}

export function publicAddOn(id: string, data: Record<string, unknown>) {
  return {
    id,
    name: String(data.name || ""),
    description: String(data.description || ""),
    priceCents: Math.max(0, Math.round(Number(data.priceCents || 0))),
    serviceTypes: Array.isArray(data.serviceTypes) ? data.serviceTypes.map(String) : [],
  };
}

/** Stripe Price ids are optional; when set they must look like one. */
export function validStripePriceId(value: string) {
  return value === "" || /^price_[A-Za-z0-9]{6,}$/.test(value);
}

export const space_getPublishedCatalog = onCall(async () => {
  const [setupSnap, addOnSnap] = await Promise.all([
    db.collection(SETUPS).where("published", "==", true).get(),
    db.collection(ADDONS).where("published", "==", true).get(),
  ]);
  const setups = await Promise.all(setupSnap.docs.map(async (doc) => {
    const setup = publicSetup(doc.id, doc.data());
    // Hide a setup whose layout has since been unpublished or replaced.
    if (!setup.layoutPath.startsWith("locations/")) return null;
    const layout = await db.doc(setup.layoutPath).get();
    return layout.exists && layout.data()?.status === "PUBLISHED" ? setup : null;
  }));
  return {
    setups: setups.filter((setup): setup is ReturnType<typeof publicSetup> => setup !== null),
    addOns: addOnSnap.docs.map((doc) => publicAddOn(doc.id, doc.data())),
  };
});

export const space_adminGetCatalog = onCall(async (request) => {
  requireAdmin(request);
  const [layouts, setupSnap, addOnSnap] = await Promise.all([
    publishedLayouts(),
    db.collection(SETUPS).get(),
    db.collection(ADDONS).get(),
  ]);
  return {
    publishedLayouts: layouts,
    setups: setupSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    addOns: addOnSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});

/**
 * Fields an add-on write sets. A new add-on gets defaults for anything the
 * caller left out; an existing one keeps every field the caller did not send,
 * so re-adding "Coffee" from the create form (or retrying that call) updates
 * the price without wiping its description or Stripe price.
 */
export function addOnWrite(
  existing: Record<string, unknown> | undefined,
  input: AddOnInput,
  name: string,
  uid: string,
  now: number,
) {
  const write: Record<string, unknown> = { name, updatedAt: now, updatedBy: uid };
  const has = (key: keyof AddOnInput) => input[key] !== undefined;
  if (!existing || has("description")) write.description = String(input.description || "").trim().slice(0, 1000);
  if (!existing || has("priceCents")) write.priceCents = Math.max(0, Math.round(Number(input.priceCents || 0)));
  if (!existing || has("stripePriceId")) write.stripePriceId = String(input.stripePriceId || "").trim();
  if (!existing || has("serviceTypes")) {
    const serviceTypes = Array.from(new Set((input.serviceTypes || []).filter((value): value is ServiceType => value === "DESK" || value === "CONFERENCE")));
    write.serviceTypes = serviceTypes.length > 0 ? serviceTypes : ["CONFERENCE"];
  }
  if (!existing || has("published")) write.published = input.published !== false;
  if (!existing) write.createdAt = now;
  return write;
}

/**
 * A setup save keeps the setup's current visibility unless the caller says
 * otherwise (re-saving a hidden setup must not publish it), and sets
 * createdAt only once.
 */
export function setupWrite(
  existing: Record<string, unknown> | undefined,
  payload: Record<string, unknown>,
  published: boolean | undefined,
  now: number,
) {
  const write: Record<string, unknown> = { ...payload };
  if (published !== undefined) write.published = published;
  else if (!existing) write.published = true;
  if (!existing) write.createdAt = now;
  return write;
}

export const space_adminUpsertSetup = onCall(async (request) => {
  const uid = requireAdmin(request);
  const input = request.data as SetupInput;
  const layoutPath = String(input.layoutPath || "").trim();
  const name = String(input.name || "").trim();
  const serviceType = input.serviceType;
  const resourceId = String(input.resourceId || "").trim();
  if (!layoutPath.startsWith("locations/") || !layoutPath.includes("/layouts/")) {
    throw new HttpsError("invalid-argument", "Choose a published layout.");
  }
  if (!name || (serviceType !== "DESK" && serviceType !== "CONFERENCE") || !resourceId) {
    throw new HttpsError("invalid-argument", "Name, service type, and resource are required.");
  }
  if (input.published !== undefined && typeof input.published !== "boolean") {
    throw new HttpsError("invalid-argument", "published must be true or false.");
  }
  const parts = layoutPath.split("/");
  const layoutRef = db.doc(layoutPath);
  const addOnIds = Array.from(new Set((input.addOnIds || []).map(String).map((value) => value.trim()).filter(Boolean)));
  // One transaction: the layout check, the create-or-update decision and the
  // write see the same state, so a retried or double-clicked save writes one
  // setup and cannot land on a layout that was unpublished in between.
  return db.runTransaction(async (tx) => {
    const layoutSnap = await tx.get(layoutRef);
    if (!layoutSnap.exists || layoutSnap.data()?.status !== "PUBLISHED") {
      throw new HttpsError("failed-precondition", "Only a currently published layout can be offered to customers.");
    }
    const layoutResources = publishedLayoutSummary(layoutSnap as FirebaseFirestore.QueryDocumentSnapshot).resourceIds;
    if (!layoutResources.includes(resourceId)) {
      throw new HttpsError("invalid-argument", "Choose a resource that is placed on this layout.");
    }
    const id = cleanId(String(input.id || `${parts[1]}-${parts[3]}-${layoutSnap.id}-${resourceId}`));
    const ref = db.collection(SETUPS).doc(id);
    const existing = await tx.get(ref);
    const now = Date.now();
    const payload = {
      id,
      layoutPath,
      layoutId: layoutSnap.id,
      locationId: parts[1] || "",
      floorId: parts[3] || "",
      name,
      serviceType,
      resourceId,
      capacity: Math.max(1, Math.min(100, Math.round(Number(input.capacity || 1)))),
      description: String(input.description || "").trim().slice(0, 1000),
      arrangement: String(input.arrangement || "").trim().slice(0, 120),
      addOnIds,
      updatedAt: now,
      updatedBy: uid,
    };
    const write = setupWrite(existing.exists ? existing.data() : undefined, payload, input.published, now);
    tx.set(ref, write, { merge: true });
    return { ...(existing.data() || {}), ...write };
  });
});

export const space_adminUpsertAddOn = onCall(async (request) => {
  const uid = requireAdmin(request);
  const input = request.data as AddOnInput;
  const name = String(input.name || "").trim();
  if (!name) throw new HttpsError("invalid-argument", "Add-on name is required.");
  const id = cleanId(String(input.id || name));
  const stripePriceId = String(input.stripePriceId || "").trim();
  if (!validStripePriceId(stripePriceId)) {
    throw new HttpsError("invalid-argument", "A Stripe price ID starts with price_. Leave it blank if this add-on isn't sold online.");
  }
  const ref = db.collection(ADDONS).doc(id);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const write = addOnWrite(existing.exists ? existing.data() : undefined, input, name, uid, Date.now());
    tx.set(ref, write, { merge: true });
    return { id, ...(existing.data() || {}), ...write };
  });
});

export const space_adminSetSetupPublished = onCall(async (request) => {
  const uid = requireAdmin(request);
  const { setupId, published } = request.data as { setupId?: string; published?: boolean };
  if (!setupId || typeof published !== "boolean") throw new HttpsError("invalid-argument", "setupId and published are required.");
  const ref = db.collection(SETUPS).doc(cleanId(setupId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Setup not found.");
    const data = snap.data() || {};
    // A retry of the same change is a no-op rather than a second audit write.
    if (data.published === published) return { success: true, setupId, published, changed: false };
    if (published) {
      const layoutPath = String(data.layoutPath || "");
      const layout = layoutPath.startsWith("locations/") ? await tx.get(db.doc(layoutPath)) : null;
      if (!layout?.exists || layout.data()?.status !== "PUBLISHED") {
        throw new HttpsError("failed-precondition", "This setup's floor plan is no longer published. Choose a published layout before showing it to customers.");
      }
    }
    tx.set(ref, { published, updatedAt: Date.now(), updatedBy: uid }, { merge: true });
    return { success: true, setupId, published, changed: true };
  });
});
