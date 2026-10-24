import { createHash, randomBytes } from "node:crypto";

/**
 * Marketing email opt-out for event campaign mail.
 *
 * Marketing email stays opt-out. This module reuses the nurture follow-up
 * suppression model (nurture.ts): an unsubscribe writes
 * nurtureSuppressions/{sha256(email)} and, for members, sets
 * users/{uid}.marketingOptOut = true. Campaign sends skip anyone with
 * marketingOptOut, doNotContact, or a suppression record, so one unsubscribe
 * stops both nurture and campaign mail.
 *
 * Each address gets one random 192-bit token, stored server-side in
 * marketingUnsubscribeTokens/{emailHash}. The token is the only thing in the
 * link; it can't be guessed or derived from the address.
 */
export const SUPPRESSIONS_COLLECTION = "nurtureSuppressions";
export const UNSUBSCRIBE_TOKENS_COLLECTION = "marketingUnsubscribeTokens";
export const UNSUBSCRIBE_FUNCTION_NAME = "marketing_unsubscribe";
export const ONE_CLICK_POST_VALUE = "List-Unsubscribe=One-Click";

/** Same normalization and hash as nurture.ts, so suppressions line up. */
export function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function newUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{48}$/.test(token);
}

/** True when a member's own record says no marketing mail. */
export function userBlocksMarketing(user: { marketingOptOut?: unknown; doNotContact?: unknown } | undefined | null): boolean {
  return Boolean(user?.marketingOptOut || user?.doNotContact);
}

/**
 * Public HTTPS URL of the unsubscribe endpoint. HI_COWORKING_UNSUBSCRIBE_URL
 * overrides it (for example a Hosting rewrite); otherwise it is the
 * function's cloudfunctions.net URL in us-central1.
 */
export function unsubscribeBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HI_COWORKING_UNSUBSCRIBE_URL?.trim();
  if (override && /^https:\/\//.test(override)) return override;
  const project = env.GCLOUD_PROJECT || env.GCP_PROJECT || "hi-coworking-plat";
  return `https://us-central1-${project}.cloudfunctions.net/${UNSUBSCRIBE_FUNCTION_NAME}`;
}

export function unsubscribeUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${unsubscribeBaseUrl(env)}?t=${encodeURIComponent(token)}`;
}

/**
 * RFC 2369 / RFC 8058 headers. The HTTPS URL accepts a POST with the body
 * "List-Unsubscribe=One-Click" and unsubscribes without any login or page.
 * No mailto: is listed because no mailbox processes unsubscribe mail
 * automatically.
 */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": ONE_CLICK_POST_VALUE,
  };
}

export type MarketingCandidate = {
  uid?: string;
  email?: string;
  marketingOptOut?: unknown;
  doNotContact?: unknown;
};

/**
 * Keeps recipients with a valid address who have not opted out, are not
 * marked do-not-contact, and are not in the suppression list. Also drops
 * duplicate addresses so nobody gets the same campaign twice.
 */
export function filterMarketingRecipients<T extends MarketingCandidate>(
  recipients: T[],
  suppressedHashes: Set<string>,
): { allowed: Array<T & { email: string; emailHash: string }>; skipped: number } {
  const allowed: Array<T & { email: string; emailHash: string }> = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    if (!isValidEmail(email)) {
      skipped += 1;
      continue;
    }
    const hash = emailHash(email);
    if (seen.has(hash) || userBlocksMarketing(recipient) || suppressedHashes.has(hash)) {
      skipped += 1;
      continue;
    }
    seen.add(hash);
    allowed.push({ ...recipient, email, emailHash: hash });
  }
  return { allowed, skipped };
}

type Db = FirebaseFirestore.Firestore;

/** Hashes of the given addresses that are in nurtureSuppressions. */
export async function loadSuppressedHashes(db: Db, hashes: string[]): Promise<Set<string>> {
  const unique = [...new Set(hashes)];
  const suppressed = new Set<string>();
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((hash) => db.collection(SUPPRESSIONS_COLLECTION).doc(hash));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) if (snap.exists) suppressed.add(snap.id);
  }
  return suppressed;
}

/** One stable token per address; creates the ones that are missing. */
export async function ensureUnsubscribeTokens(
  db: Db,
  recipients: Array<{ uid?: string; email: string; emailHash: string }>,
  now: number,
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  for (let i = 0; i < recipients.length; i += 300) {
    const chunk = recipients.slice(i, i + 300);
    if (chunk.length === 0) continue;
    const snaps = await db.getAll(...chunk.map((r) => db.collection(UNSUBSCRIBE_TOKENS_COLLECTION).doc(r.emailHash)));
    const batch = db.batch();
    let writes = 0;
    chunk.forEach((recipient, index) => {
      const existing = snaps[index].exists ? snaps[index].get("token") : undefined;
      if (isWellFormedToken(existing)) {
        tokens.set(recipient.emailHash, existing);
        return;
      }
      const token = newUnsubscribeToken();
      tokens.set(recipient.emailHash, token);
      batch.set(snaps[index].ref, {
        token,
        emailHash: recipient.emailHash,
        email: recipient.email,
        ...(recipient.uid ? { uid: recipient.uid } : {}),
        createdAt: now,
      });
      writes += 1;
    });
    if (writes > 0) await batch.commit();
  }
  return tokens;
}

export type UnsubscribeResult = "unsubscribed" | "not-found";

/**
 * Applies an unsubscribe token: suppresses the address (nurture + campaign
 * mail), stops active nurture enrollments for it, and sets
 * users/{uid}.marketingOptOut for members. Idempotent.
 */
export async function applyUnsubscribeToken(db: Db, token: string, now: number): Promise<UnsubscribeResult> {
  if (!isWellFormedToken(token)) return "not-found";
  const match = await db.collection(UNSUBSCRIBE_TOKENS_COLLECTION).where("token", "==", token).limit(1).get();
  if (match.empty) return "not-found";
  const data = match.docs[0].data() as { emailHash?: string; email?: string; uid?: string };
  const hash = data.emailHash || match.docs[0].id;
  const batch = db.batch();
  batch.set(db.collection(SUPPRESSIONS_COLLECTION).doc(hash), {
    emailHash: hash,
    ...(data.email ? { email: data.email } : {}),
    reason: "unsubscribe",
    source: "event-campaign",
    createdAt: now,
  }, { merge: true });
  const enrollments = await db.collection("nurtureEnrollments").where("emailHash", "==", hash).get();
  for (const doc of enrollments.docs) batch.set(doc.ref, { status: "SUPPRESSED", updatedAt: now }, { merge: true });
  if (data.uid) {
    const userRef = db.collection("users").doc(data.uid);
    if ((await userRef.get()).exists) batch.update(userRef, { marketingOptOut: true, updatedAt: now });
  }
  batch.set(match.docs[0].ref, { lastUsedAt: now }, { merge: true });
  await batch.commit();
  return "unsubscribed";
}
