/**
 * Admin-only callables that let /admin/leads show booth and Power NOW leads
 * (Firestore intakeLeads) next to the web leads. intakeLeads rules deny every
 * client read and write; these run with the Admin SDK after a role check.
 *
 * Deploy with firebase.lead-admin.json and
 * --only functions:leadsAdmin_listIntake,functions:leadsAdmin_setIntakeNotes.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  INTAKE_LIST_LIMIT,
  isAdminRole,
  parseNotesUpdate,
  sortIntakeRows,
  toIntakeAdminRow,
} from "./leadAdminModel";

const INTAKE_LEADS = "intakeLeads";

function db() {
  // Lazy: index.ts calls initializeApp() unguarded when main.ts loads it.
  if (admin.apps.length === 0) admin.initializeApp();
  return admin.firestore();
}

function requireAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  if (!isAdminRole(request.auth.token.role)) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

export const leadsAdmin_listIntake = onCall({ region: "us-central1" }, async (request) => {
  requireAdmin(request);
  const snap = await db().collection(INTAKE_LEADS).limit(INTAKE_LIST_LIMIT).get();
  const rows = sortIntakeRows(snap.docs.map((doc) => toIntakeAdminRow(doc.id, doc.data() as Record<string, unknown>)));
  return { rows, truncated: snap.size >= INTAKE_LIST_LIMIT };
});

export const leadsAdmin_setIntakeNotes = onCall({ region: "us-central1" }, async (request) => {
  const uid = requireAdmin(request);
  const parsed = parseNotesUpdate(request.data);
  if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
  const ref = db().collection(INTAKE_LEADS).doc(parsed.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Lead not found.");
  await ref.update({
    adminNotes: parsed.notes,
    adminNotesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    adminNotesUpdatedBy: uid,
  });
  logger.info("intake lead notes updated", { leadId: parsed.id, length: parsed.notes.length });
  return { ok: true };
});
