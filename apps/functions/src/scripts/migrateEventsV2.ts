import { createHash, randomBytes } from "node:crypto";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "event";
}

function mapStatus(value: unknown) {
  if (value === "refunded") return "REFUNDED";
  if (value === "cancelled") return "CANCELLED";
  return "CONFIRMED";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const events = await db.collection("events").get();
  let registrationWrites = 0;
  let waitlistWrites = 0;
  let eventWrites = 0;
  const anomalies: string[] = [];

  console.log(`Events v2 migration ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Scanning ${events.size} event documents...`);

  for (const eventDoc of events.docs) {
    const event = eventDoc.data();
    const [registrations, waitlist] = await Promise.all([
      eventDoc.ref.collection("registrations").get(),
      eventDoc.ref.collection("waitlist").get(),
    ]);

    let derivedConfirmedQuantity = 0;
    for (const registrationDoc of registrations.docs) {
      const registration = registrationDoc.data();
      const quantity = Math.max(1, Math.round(Number(registration.quantity || 1)));
      const status = mapStatus(registration.status);
      if (status === "CONFIRMED") derivedConfirmedQuantity += quantity;
      const id = `legacy_${eventDoc.id}_${registrationDoc.id}`;
      const email = String(registration.email || "").trim().toLowerCase();
      if (!email) anomalies.push(`${eventDoc.id}/${registrationDoc.id}: registration has no email`);
      const amountPaidCents = Math.max(0, Math.round(Number(registration.amountPaidCents || 0)));
      const unitPriceCents = Math.round(amountPaidCents / quantity);
      const payload = {
        id,
        eventId: eventDoc.id,
        uid: registration.uid || registrationDoc.id,
        displayName: registration.displayName || "Member",
        email: email || `${registrationDoc.id}@invalid.local`,
        ticketTypeId: registration.ticketTypeId || null,
        quantity,
        publicUnitPriceCents: unitPriceCents,
        discountCents: 0,
        finalUnitPriceCents: unitPriceCents,
        amountPaidCents,
        currency: String(event.currency || "usd").toLowerCase(),
        paymentId: registration.paymentId || null,
        status,
        attendanceStatus: registration.checkedInAt ? "CHECKED_IN" : "NOT_CHECKED_IN",
        checkedInQuantity: registration.checkedInAt ? quantity : 0,
        checkedInAt: registration.checkedInAt || null,
        source: "member",
        manageSecretHash: hash(randomBytes(24).toString("hex")),
        registeredAt: Number(registration.registeredAt || event.createdAt || Date.now()),
        migratedFrom: `events/${eventDoc.id}/registrations/${registrationDoc.id}`,
        migratedAt: Date.now(),
      };
      if (apply) await db.collection("eventRegistrations").doc(id).set(payload, { merge: true });
      registrationWrites += 1;
    }

    const legacyRegistrationCount = Math.max(0, Math.round(Number(event.registrationCount || 0)));
    const confirmedQuantity = registrations.empty ? legacyRegistrationCount : derivedConfirmedQuantity;
    if (!registrations.empty && legacyRegistrationCount !== derivedConfirmedQuantity) {
      anomalies.push(
        `${eventDoc.id}: legacy registrationCount=${legacyRegistrationCount}, derived active quantity=${derivedConfirmedQuantity}; using derived quantity`,
      );
    }

    for (const waitlistDoc of waitlist.docs) {
      const entry = waitlistDoc.data();
      const id = `legacy_${eventDoc.id}_${waitlistDoc.id}`;
      const statusMap: Record<string, string> = {
        waiting: "WAITING",
        notified: "OFFERED",
        claimed: "CLAIMED",
        expired: "EXPIRED",
        removed: "REMOVED",
      };
      const payload = {
        id,
        eventId: eventDoc.id,
        uid: entry.uid || waitlistDoc.id,
        displayName: entry.displayName || "Member",
        email: String(entry.email || "").trim().toLowerCase() || `${waitlistDoc.id}@invalid.local`,
        quantity: 1,
        joinedAt: Number(entry.joinedAt || event.createdAt || Date.now()),
        status: statusMap[String(entry.status || "waiting")] || "WAITING",
        manageSecretHash: hash(randomBytes(24).toString("hex")),
        migratedFrom: `events/${eventDoc.id}/waitlist/${waitlistDoc.id}`,
        migratedAt: Date.now(),
      };
      if (apply) await db.collection("eventWaitlist").doc(id).set(payload, { merge: true });
      waitlistWrites += 1;
    }

    const existingSlug = typeof event.slug === "string" && event.slug.trim() ? event.slug.trim() : null;
    const slug = existingSlug || `${slugify(String(event.title || "event"))}-${eventDoc.id.slice(-5).toLowerCase()}`;
    const update = {
      slug,
      timezone: event.timezone || "America/New_York",
      confirmedQuantity,
      registrationCount: confirmedQuantity,
      heldQuantity: Math.max(0, Number(event.heldQuantity || 0)),
      ticketTypes: Array.isArray(event.ticketTypes)
        ? event.ticketTypes.map((ticket: Record<string, unknown>) => ({ ...ticket, heldCount: Math.max(0, Number(ticket.heldCount || 0)) }))
        : [],
      refundCutoffHours: Number.isFinite(Number(event.refundCutoffHours)) ? Number(event.refundCutoffHours) : 24,
      reminders: event.reminders || {
        confirmation: true,
        reminder24h: true,
        reminder1h: true,
        followUp: false,
      },
      eventFlowVersion: 2,
      migratedAt: Date.now(),
    };
    if (apply) await eventDoc.ref.set(update, { merge: true });
    eventWrites += 1;
  }

  console.log(JSON.stringify({
    apply,
    eventsScanned: events.size,
    eventWrites,
    registrationWrites,
    waitlistWrites,
    anomalyCount: anomalies.length,
    anomalies: anomalies.slice(0, 50),
  }, null, 2));

  if (!apply) console.log("Dry run only. Re-run with --apply after reviewing the counts and anomalies.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
