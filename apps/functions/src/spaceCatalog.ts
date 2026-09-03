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

async function publishedLayouts() {
  const snap = await db.collectionGroup("layouts").where("status", "==", "PUBLISHED").get();
  return snap.docs.map(publishedLayoutSummary);
}

export const space_getPublishedCatalog = onCall(async () => {
  const [setupSnap, addOnSnap] = await Promise.all([
    db.collection(SETUPS).where("published", "==", true).get(),
    db.collection(ADDONS).where("published", "==", true).get(),
  ]);
  return {
    setups: setupSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    addOns: addOnSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
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
  const layoutRef = db.doc(layoutPath);
  const layoutSnap = await layoutRef.get();
  if (!layoutSnap.exists || layoutSnap.data()?.status !== "PUBLISHED") {
    throw new HttpsError("failed-precondition", "Only a currently published layout can be offered to customers.");
  }
  const parts = layoutPath.split("/");
  const id = cleanId(String(input.id || `${parts[1]}-${parts[3]}-${layoutSnap.id}-${resourceId}`));
  const now = Date.now();
  const addOnIds = Array.from(new Set((input.addOnIds || []).map(String).map((value) => value.trim()).filter(Boolean)));
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
    published: input.published !== false,
    updatedAt: now,
    updatedBy: uid,
  };
  await db.collection(SETUPS).doc(id).set({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return payload;
});

export const space_adminUpsertAddOn = onCall(async (request) => {
  const uid = requireAdmin(request);
  const input = request.data as AddOnInput;
  const name = String(input.name || "").trim();
  if (!name) throw new HttpsError("invalid-argument", "Add-on name is required.");
  const id = cleanId(String(input.id || name));
  const priceCents = Math.max(0, Math.round(Number(input.priceCents || 0)));
  const serviceTypes = Array.from(new Set((input.serviceTypes || []).filter((value): value is ServiceType => value === "DESK" || value === "CONFERENCE")));
  if (serviceTypes.length === 0) serviceTypes.push("CONFERENCE");
  const payload = {
    id,
    name,
    description: String(input.description || "").trim().slice(0, 1000),
    priceCents,
    stripePriceId: String(input.stripePriceId || "").trim(),
    serviceTypes,
    published: input.published !== false,
    updatedAt: Date.now(),
    updatedBy: uid,
  };
  await db.collection(ADDONS).doc(id).set(payload, { merge: true });
  return payload;
});

export const space_adminSetSetupPublished = onCall(async (request) => {
  const uid = requireAdmin(request);
  const { setupId, published } = request.data as { setupId?: string; published?: boolean };
  if (!setupId || typeof published !== "boolean") throw new HttpsError("invalid-argument", "setupId and published are required.");
  const ref = db.collection(SETUPS).doc(cleanId(setupId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Setup not found.");
  await ref.set({ published, updatedAt: Date.now(), updatedBy: uid }, { merge: true });
  return { success: true, setupId, published };
});
