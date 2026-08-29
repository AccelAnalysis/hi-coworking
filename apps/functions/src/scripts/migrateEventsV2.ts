import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "event";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const events = await db.collection("events").get();
  let eventUpdates = 0;
  let registrations = 0;
  let waitlistEntries = 0;

  for (const eventDoc of events.docs) {
    const event = eventDoc.data();
    const legacyRegs = await eventDoc.ref.collection("registrations").get();
    const legacyWaitlist = await eventDoc.ref.collection("waitlist").get();
    const activeQuantity = legacyRegs.docs.reduce((sum, doc) => {
      const reg = doc.data();
      return reg.status === "active" ? sum + Math.max(1, Number(reg.quantity || 1)) : sum;
    }, 0);

    const eventPatch = {
      slug: event.slug || `${slugify(String(event.title || "event"))}-${eventDoc.id.slice(-6).toLowerCase()}`,
      timezone: event.timezone || "America/New_York",
      confirmedQuantity: Number.isFinite(event.confirmedQuantity) ? event.confirmedQuantity : activeQuantity,
      heldQuantity: Number.isFinite(event.heldQuantity) ? event.heldQuantity : 0,
      registrationCount: Number.isFinite(event.registrationCount) ? event.registrationCount : activeQuantity,
      updatedAt: Date.now(),
    };

    if (apply) await eventDoc.ref.set(eventPatch, { merge: true });
    eventUpdates += 1;

    for (const legacyDoc of legacyRegs.docs) {
      const reg = legacyDoc.data();
      const registrationId = `legacy_${eventDoc.id}_${legacyDoc.id}`;
      const status = reg.status === "refunded" ? "REFUNDED" : reg.status === "cancelled" ? "CANCELLED" : "CONFIRMED";
      const row = {
        id: registrationId,
        eventId: eventDoc.id,
        uid: reg.uid || legacyDoc.id,
        displayName: reg.displayName || "",
        email: reg.email || "",
        ticketTypeId: reg.ticketTypeId || null,
        quantity: Math.max(1, Number(reg.quantity || 1)),
        publicUnitPriceCents: Math.max(0, Number(reg.amountPaidCents || 0) / Math.max(1, Number(reg.quantity || 1))),
        discountCents: 0,
        finalUnitPriceCents: Math.max(0, Number(reg.amountPaidCents || 0) / Math.max(1, Number(reg.quantity || 1))),
        amountPaidCents: Math.max(0, Number(reg.amountPaidCents || 0)),
        currency: event.currency || "usd",
        paymentId: reg.paymentId || null,
        status,
        attendanceStatus: reg.checkedInAt ? "CHECKED_IN" : "NOT_CHECKED_IN",
        checkedInQuantity: reg.checkedInAt ? Math.max(1, Number(reg.quantity || 1)) : 0,
        checkedInAt: reg.checkedInAt || null,
        source: "member",
        registeredAt: reg.registeredAt || Date.now(),
        migratedFrom: `events/${eventDoc.id}/registrations/${legacyDoc.id}`,
      };
      if (apply) await db.collection("eventRegistrations").doc(registrationId).set(row, { merge: true });
      registrations += 1;
    }

    for (const legacyDoc of legacyWaitlist.docs) {
      const entry = legacyDoc.data();
      const waitlistId = `legacy_${eventDoc.id}_${legacyDoc.id}`;
      const statusMap: Record<string, string> = {
        waiting: "WAITING",
        notified: "OFFERED",
        claimed: "CLAIMED",
        expired: "EXPIRED",
        removed: "REMOVED",
      };
      const row = {
        id: waitlistId,
        eventId: eventDoc.id,
        uid: entry.uid || legacyDoc.id,
        displayName: entry.displayName || "",
        email: entry.email || "",
        ticketTypeId: entry.ticketTypeId || null,
        quantity: Math.max(1, Number(entry.quantity || 1)),
        status: statusMap[entry.status] || "WAITING",
        joinedAt: entry.joinedAt || Date.now(),
        offeredAt: entry.notifiedAt || null,
        offerExpiresAt: entry.claimExpiresAt || null,
        migratedFrom: `events/${eventDoc.id}/waitlist/${legacyDoc.id}`,
      };
      if (apply) await db.collection("eventWaitlist").doc(waitlistId).set(row, { merge: true });
      waitlistEntries += 1;
    }
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", eventUpdates, registrations, waitlistEntries }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
