import { layoutCoversBooking } from "./bookingLayoutRules";
import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import type { BookingChoice } from "./bookingFlexShared";
import { CONFERENCE_ROOM_MAX_CAPACITY } from "./payments/stripeConfig";

export type CatalogSelection = { setupId?: string; addOnIds?: string[]; attendeeCount?: number };
export type BookingCatalogSnapshot = {
  setup: { id: string; name: string; capacity: number; resourceId: string; serviceType: string; layoutPath: string } | null;
  addOns: Array<{ id: string; name: string; priceCents: number }>;
  addOnTotalCents: number;
  attendeeCount: number;
};

type ReadDocument = (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);

/** Resolve only server-published records. The transaction caller re-reads them at hold creation. */
export async function loadBookingCatalog(
  choice: BookingChoice,
  selection: CatalogSelection = {},
  read: ReadDocument = (ref) => ref.get(),
  window?: { start: number; end: number },
  readQuery: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot> = (query) => query.get(),
): Promise<BookingCatalogSnapshot> {
  const attendeeCount = selection.attendeeCount ?? 1;
  if (!Number.isInteger(attendeeCount) || attendeeCount < 1) throw new HttpsError("invalid-argument", "Choose a valid attendee count.");
  if (selection.addOnIds !== undefined && (!Array.isArray(selection.addOnIds) || selection.addOnIds.length > 20 || !selection.addOnIds.every(validId))) {
    throw new HttpsError("invalid-argument", "Choose valid add-ons.");
  }
  const addOnIds = [...new Set(selection.addOnIds || [])];
  const maximumCapacity = choice.resourceType === "SEAT" ? 1 : CONFERENCE_ROOM_MAX_CAPACITY;
  if (!selection.setupId) {
    if (addOnIds.length) throw new HttpsError("failed-precondition", "Choose a published setup before adding extras.");
    if (attendeeCount > maximumCapacity) throw new HttpsError("failed-precondition", "That attendee count exceeds this space's capacity.");
    return { setup: null, addOns: [], addOnTotalCents: 0, attendeeCount };
  }
  if (!validId(selection.setupId)) throw new HttpsError("invalid-argument", "Choose a valid setup.");
  if (choice.kind !== "single") throw new HttpsError("failed-precondition", "A setup cannot be combined with a desk-change booking.");
  const db = admin.firestore();
  const setup = (await read(db.collection("spaceSetups").doc(selection.setupId))).data();
  const serviceType = choice.resourceType === "SEAT" ? "DESK" : "CONFERENCE";
  if (!setup || setup.published !== true || setup.resourceId !== choice.resourceId || setup.serviceType !== serviceType) {
    throw new HttpsError("failed-precondition", "That setup is not currently available for this space.");
  }
  if (typeof setup.layoutPath !== "string" || !/^locations\/[^/]+\/floors\/[^/]+\/layouts\/[^/]+$/.test(setup.layoutPath)) {
    throw new HttpsError("failed-precondition", "That setup does not have a valid published layout.");
  }
  const layout = (await read(db.doc(setup.layoutPath))).data();
  if (layout?.status !== "PUBLISHED" || !Array.isArray(layout.elements)
    || !layout.elements.some((element: { resourceId?: string }) => element.resourceId === choice.resourceId)) {
    throw new HttpsError("failed-precondition", "The setup's resource is no longer in its published layout.");
  }
  if (window) {
    const layoutCollection = setup.layoutPath.split("/").slice(0, -1).join("/");
    const layouts = await readQuery(db.collection(layoutCollection).where("status", "==", "PUBLISHED"));
    const candidates = layouts.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    if (!layoutCoversBooking(candidates, setup.layoutPath.split("/").slice(-1)[0], window.start, window.end)) {
      throw new HttpsError("failed-precondition", "This setup is not effective for the entire selected time. Choose another setup or time and request a new quote.");
    }
  }
  if (!Number.isInteger(setup.capacity) || setup.capacity < 1) throw new HttpsError("failed-precondition", "Setup capacity needs configuration.");
  const capacity = Math.min(setup.capacity, maximumCapacity);
  if (attendeeCount > capacity) throw new HttpsError("failed-precondition", "That attendee count exceeds this setup's capacity.");
  const addOns = await Promise.all(addOnIds.map(async (id) => {
    if (!Array.isArray(setup.addOnIds) || !setup.addOnIds.includes(id)) throw new HttpsError("failed-precondition", "That add-on is not offered with this setup.");
    const addon = (await read(db.collection("spaceAddOns").doc(id))).data();
    if (!addon || addon.published !== true || !Array.isArray(addon.serviceTypes) || !addon.serviceTypes.includes(serviceType)) {
      throw new HttpsError("failed-precondition", "That add-on is not currently available for this setup.");
    }
    if (!Number.isSafeInteger(addon.priceCents) || addon.priceCents < 0) throw new HttpsError("failed-precondition", "Add-on pricing needs configuration.");
    return { id, name: String(addon.name || id), priceCents: addon.priceCents };
  }));
  const addOnTotalCents = addOns.reduce((sum, addon) => sum + addon.priceCents, 0);
  if (!Number.isSafeInteger(addOnTotalCents)) throw new HttpsError("failed-precondition", "Add-on pricing exceeds the supported amount.");
  return {
    setup: { id: selection.setupId, name: String(setup.name || selection.setupId), capacity,
      resourceId: choice.resourceId, serviceType, layoutPath: setup.layoutPath },
    addOns, addOnTotalCents, attendeeCount,
  };
}

/** Paid setup/add-on snapshots cannot silently migrate or change price during rescheduling. */
export async function assertCatalogReschedule(
  booking: Partial<BookingCatalogSnapshot> & { resourceId: string; resourceName?: string },
  start: number,
  end: number,
  read?: ReadDocument,
  readQuery?: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>,
): Promise<void> {
  if (!booking.setup && !booking.addOns?.length && !booking.addOnTotalCents) return;
  const message = "This setup or its add-ons require a new quote before rescheduling. Contact staff to preserve your paid booking and charges.";
  if (!booking.setup) throw new HttpsError("failed-precondition", message);
  try {
    const current = await loadBookingCatalog({ kind: "single", resourceId: booking.resourceId,
      resourceName: booking.resourceName || booking.resourceId,
      resourceType: booking.resourceId.startsWith("mode-") ? "MODE" : "SEAT" }, {
      setupId: booking.setup.id, addOnIds: booking.addOns?.map((addon) => addon.id), attendeeCount: booking.attendeeCount,
    }, read, { start, end }, readQuery);
    if (current.setup?.layoutPath !== booking.setup.layoutPath
      || current.addOnTotalCents !== (booking.addOnTotalCents || 0)
      || current.addOns.length !== (booking.addOns || []).length
      || current.addOns.some((addon) => !booking.addOns?.some((paid) => paid.id === addon.id && paid.priceCents === addon.priceCents))) {
      throw new HttpsError("failed-precondition", message);
    }
  } catch {
    throw new HttpsError("failed-precondition", message);
  }
}
