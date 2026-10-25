import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { emailHash } from "./providers/marketingPreferences";

if (admin.apps.length === 0) admin.initializeApp();

// Read-only admin views for one member's record (P1-5) and the consent and
// suppression list (P1-11). Served by callables so no Firestore rules change
// is needed: the Admin SDK reads, and every call checks role admin|master.
//
// Each response carries only what the admin UI renders. Consent wording,
// tokens, card data, Stripe objects and free-form audit details are left out.
// Queries are single-field equality only (no composite index needed) and are
// sorted in memory.

const AUDIT_FETCH_LIMIT = 200;
const AUDIT_RETURN_LIMIT = 100;
const LIST_LIMIT = 500;
const SAFE_DETAIL_KEY = /^(plan|fromPlan|toPlan|fromStatus|toStatus|reason|deltaCents|totalCents|creditCents|bookingId|paymentId|stripeSubscriptionId|effectiveAt)$/;

type Doc = Record<string, unknown>;

export type MemberAuditEntry = {
  id: string;
  source: "member-operation" | "payment" | "credit" | "role";
  action: string;
  actorUid: string | null;
  actorName: string | null;
  createdAt: number;
  summary: Record<string, string | number | boolean>;
};

export function requireAdminCaller(request: Pick<CallableRequest, "auth">): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const role = request.auth.token.role;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Only admins can view member records.");
  }
  return request.auth.uid;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** Keeps only allow-listed scalar keys, so names, emails and notes never leak through. */
export function safeSummary(details: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!details || typeof details !== "object") return out;
  for (const [key, value] of Object.entries(details as Doc)) {
    if (!SAFE_DETAIL_KEY.test(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.length <= 120) out[key] = value;
  }
  return out;
}

export function smsConsentView(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Doc;
  return {
    optIn: c.optIn === true,
    phone: str(c.phone),
    source: str(c.source),
    textVersion: str(c.textVersion),
    consentedAt: num(c.consentedAt),
    optedOutAt: num(c.optedOutAt),
    optOutReason: str(c.optOutReason),
    updatedAt: num(c.updatedAt),
  };
}

export function termsView(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Doc;
  return { version: str(t.version), source: str(t.source), acceptedAt: num(t.acceptedAt) };
}

function historyView(raw: unknown, keys: string[]) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Doc => Boolean(row) && typeof row === "object")
    .map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const key of keys) {
        const value = row[key];
        out[key] = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
      }
      return out;
    })
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 50);
}

export function memberAuditEntries(input: {
  memberOps: Doc[];
  payments: Doc[];
  credits: Doc[];
  roles: Doc[];
}): MemberAuditEntry[] {
  const rows: MemberAuditEntry[] = [];
  for (const d of input.memberOps) {
    rows.push({ id: String(d.id || ""), source: "member-operation", action: String(d.action || "update"), actorUid: str(d.adminUid), actorName: null, createdAt: num(d.createdAt) || 0, summary: safeSummary(d.details) });
  }
  for (const d of input.payments) {
    rows.push({ id: String(d.id || ""), source: "payment", action: String(d.action || "payment"), actorUid: str(d.performedBy), actorName: null, createdAt: num(d.createdAt) || 0, summary: safeSummary({ paymentId: d.paymentId, fromStatus: d.previousStatus, toStatus: d.newStatus }) });
  }
  for (const d of input.credits) {
    rows.push({ id: String(d.id || ""), source: "credit", action: "credit_adjustment", actorUid: str(d.performedBy), actorName: null, createdAt: num(d.createdAt) || 0, summary: safeSummary({ deltaCents: d.deltaCents, creditCents: d.afterCents, reason: d.reason }) });
  }
  for (const d of input.roles) {
    rows.push({ id: String(d.id || ""), source: "role", action: "role_change", actorUid: str(d.actorUid), actorName: null, createdAt: num(d.createdAt) || 0, summary: safeSummary({ fromStatus: d.fromRole ?? "none", toStatus: d.toRole }) });
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, AUDIT_RETURN_LIMIT);
}

function docs(snap: FirebaseFirestore.QuerySnapshot): Doc[] {
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export const admin_memberRecordGet = onCall(async (request) => {
  requireAdminCaller(request);
  const uid = str((request.data as Doc | undefined)?.uid);
  if (!uid || uid.length > 128 || uid.includes("/")) throw new HttpsError("invalid-argument", "A member id is required.");
  const db = admin.firestore();
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("not-found", "No member has that id.");
  const user = snap.data() as Doc;

  const [memberOps, credits, roles, paymentSnap] = await Promise.all([
    db.collection("memberOperationAudit").where("memberUid", "==", uid).limit(AUDIT_FETCH_LIMIT).get(),
    db.collection("accountCreditAdjustments").where("userId", "==", uid).limit(AUDIT_FETCH_LIMIT).get(),
    db.collection("roleAudit").where("targetUid", "==", uid).limit(AUDIT_FETCH_LIMIT).get(),
    db.collection("payments").where("uid", "==", uid).limit(AUDIT_FETCH_LIMIT).get(),
  ]);
  const paymentIds = paymentSnap.docs.map((doc) => doc.id);
  const paymentAudit: Doc[] = [];
  for (let i = 0; i < paymentIds.length; i += 30) {
    const chunk = paymentIds.slice(i, i + 30);
    paymentAudit.push(...docs(await db.collection("paymentAudit").where("paymentId", "in", chunk).limit(AUDIT_FETCH_LIMIT).get()));
  }

  const audit = memberAuditEntries({ memberOps: docs(memberOps), payments: paymentAudit, credits: docs(credits), roles: docs(roles) });
  const actorIds = [...new Set(audit.map((row) => row.actorUid).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const actors = await db.getAll(...actorIds.map((id) => db.collection("users").doc(id)));
    for (const actor of actors) {
      const name = str(actor.data()?.displayName);
      if (name) names.set(actor.id, name);
    }
  }
  for (const row of audit) row.actorName = row.actorUid ? names.get(row.actorUid) ?? null : null;

  const email = str(user.email);
  const suppression = email ? await db.collection("nurtureSuppressions").doc(emailHash(email)).get() : null;
  const suppressionData = suppression?.exists ? (suppression.data() as Doc) : null;

  return {
    member: {
      uid,
      displayName: str(user.displayName),
      email,
      phone: str(user.phone),
      role: str(user.role),
      plan: str(user.plan),
      membershipStatus: str(user.membershipStatus),
      expiresAt: num(user.expiresAt),
      createdAt: num(user.createdAt),
      stripeCustomerId: str(user.stripeCustomerId),
      stripeSubscriptionId: str(user.stripeSubscriptionId),
      membershipCancellationPending: user.membershipCancellationPending === true,
      accountCreditCents: num(user.accountCreditCents) ?? 0,
    },
    consent: {
      sms: smsConsentView(user.smsConsent),
      smsHistory: historyView(user.smsConsentHistory, ["optIn", "source", "textVersion", "at"]),
      terms: termsView(user.termsAcceptance),
      termsHistory: historyView(user.termsAcceptanceHistory, ["version", "source", "at"]),
      email: {
        marketingOptOut: user.marketingOptOut === true,
        doNotContact: user.doNotContact === true,
        suppressed: Boolean(suppressionData),
        suppressionReason: suppressionData ? str(suppressionData.reason) : null,
        suppressedAt: suppressionData ? num(suppressionData.createdAt) : null,
      },
    },
    audit,
  };
});

export const CONSENT_FILTERS = ["sms-opted-in", "sms-opted-out", "email-opted-out", "do-not-contact", "suppressed"] as const;
export type ConsentFilter = (typeof CONSENT_FILTERS)[number];

export type ConsentRow = {
  uid: string | null;
  displayName: string | null;
  email: string | null;
  smsOptIn: boolean | null;
  smsUpdatedAt: number | null;
  smsOptOutReason: string | null;
  marketingOptOut: boolean;
  doNotContact: boolean;
  suppressionReason: string | null;
  updatedAt: number | null;
};

export function consentRowFromUser(id: string, user: Doc): ConsentRow {
  const sms = smsConsentView(user.smsConsent);
  return {
    uid: id,
    displayName: str(user.displayName),
    email: str(user.email),
    smsOptIn: sms ? sms.optIn : null,
    smsUpdatedAt: sms ? sms.updatedAt ?? sms.optedOutAt ?? sms.consentedAt : null,
    smsOptOutReason: sms ? sms.optOutReason : null,
    marketingOptOut: user.marketingOptOut === true,
    doNotContact: user.doNotContact === true,
    suppressionReason: null,
    updatedAt: num(user.updatedAt),
  };
}

export const admin_consentList = onCall(async (request) => {
  requireAdminCaller(request);
  const filter = String((request.data as Doc | undefined)?.filter || "") as ConsentFilter;
  if (!CONSENT_FILTERS.includes(filter)) throw new HttpsError("invalid-argument", "Unknown consent filter.");
  const db = admin.firestore();
  if (filter === "suppressed") {
    const snap = await db.collection("nurtureSuppressions").limit(LIST_LIMIT).get();
    const rows: ConsentRow[] = snap.docs.map((doc) => {
      const d = doc.data() as Doc;
      return { uid: null, displayName: null, email: str(d.email), smsOptIn: null, smsUpdatedAt: null, smsOptOutReason: null, marketingOptOut: true, doNotContact: false, suppressionReason: str(d.reason) || "unsubscribe", updatedAt: num(d.createdAt) };
    });
    rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { filter, rows, truncated: snap.size >= LIST_LIMIT };
  }
  const users = db.collection("users");
  const query =
    filter === "sms-opted-in" ? users.where("smsConsent.optIn", "==", true)
    : filter === "sms-opted-out" ? users.where("smsConsent.optIn", "==", false)
    : filter === "email-opted-out" ? users.where("marketingOptOut", "==", true)
    : users.where("doNotContact", "==", true);
  const snap = await query.limit(LIST_LIMIT).get();
  const rows = snap.docs.map((doc) => consentRowFromUser(doc.id, doc.data() as Doc));
  rows.sort((a, b) => (b.smsUpdatedAt || b.updatedAt || 0) - (a.smsUpdatedAt || a.updatedAt || 0));
  return { filter, rows, truncated: snap.size >= LIST_LIMIT };
});
