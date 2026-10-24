import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import {
  ONE_CLICK_POST_VALUE,
  SUPPRESSIONS_COLLECTION,
  UNSUBSCRIBE_TOKENS_COLLECTION,
  applyUnsubscribeToken,
  emailHash,
  ensureUnsubscribeTokens,
  filterMarketingRecipients,
  isWellFormedToken,
  listUnsubscribeHeaders,
  loadSuppressedHashes,
  newUnsubscribeToken,
  unsubscribeUrl,
} from "../../apps/functions/src/providers/marketingPreferences";
import { buildCampaignEmailMessages } from "../../apps/functions/src/campaignJobs";
import { renderEmailHtml } from "../../apps/functions/src/providers/campaignRenderer";
import { handleUnsubscribeRequest } from "../../apps/functions/src/marketingUnsubscribe";
import { ResendEmailProvider } from "../../apps/functions/src/providers/emailProvider";

// Minimal in-memory Firestore with the calls these helpers use.
type Doc = Record<string, unknown>;
function fakeDb(seed: Record<string, Record<string, Doc>> = {}) {
  const data = new Map<string, Map<string, Doc>>();
  for (const [name, docs] of Object.entries(seed)) data.set(name, new Map(Object.entries(docs)));
  const col = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };
  const snap = (name: string, id: string) => {
    const value = col(name).get(id);
    return { id, exists: value !== undefined, ref: docRef(name, id), data: () => value, get: (f: string) => value?.[f] };
  };
  function docRef(name: string, id: string) {
    return { id, path: `${name}/${id}`, name, get: async () => snap(name, id) };
  }
  const write = (ref: { name: string; id: string }, value: Doc, merge: boolean) => {
    const prev = col(ref.name).get(ref.id);
    col(ref.name).set(ref.id, merge && prev ? { ...prev, ...value } : { ...value });
  };
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
      where: (field: string, _op: string, value: unknown) => {
        const run = async () => {
          const docs = [...col(name).entries()].filter(([, d]) => d[field] === value).map(([id]) => snap(name, id));
          return { empty: docs.length === 0, docs };
        };
        return { get: run, limit: () => ({ get: run }) };
      },
    }),
    getAll: async (...refs: Array<{ name: string; id: string }>) => refs.map((r) => snap(r.name, r.id)),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: { name: string; id: string }, value: Doc, opts?: { merge?: boolean }) => ops.push(() => write(ref, value, Boolean(opts?.merge))),
        update: (ref: { name: string; id: string }, value: Doc) => ops.push(() => {
          if (!col(ref.name).has(ref.id)) throw new Error("not-found");
          write(ref, value, true);
        }),
        commit: async () => ops.forEach((op) => op()),
      };
    },
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, data, col };
}

describe("campaign email recipient filter", () => {
  it("skips marketingOptOut, doNotContact, suppressed, invalid and duplicate addresses", () => {
    const suppressed = new Set([emailHash("gone@example.com")]);
    const { allowed, skipped } = filterMarketingRecipients(
      [
        { uid: "a", email: " Ok@Example.com " },
        { uid: "b", email: "out@example.com", marketingOptOut: true },
        { uid: "c", email: "dnc@example.com", doNotContact: true },
        { uid: "d", email: "GONE@example.com" },
        { uid: "e", email: "not-an-email" },
        { uid: "f", email: "ok@example.com" },
      ],
      suppressed,
    );
    expect(allowed.map((r) => r.uid)).toEqual(["a"]);
    expect(allowed[0].email).toBe("ok@example.com");
    expect(allowed[0].emailHash).toBe(emailHash("ok@example.com"));
    expect(skipped).toBe(5);
  });

  it("reads suppressions in nurtureSuppressions by the nurture email hash", async () => {
    const hash = emailHash("x@example.com");
    const { db } = fakeDb({ [SUPPRESSIONS_COLLECTION]: { [hash]: { reason: "unsubscribe" } } });
    const result = await loadSuppressedHashes(db, [hash, emailHash("y@example.com"), hash]);
    expect([...result]).toEqual([hash]);
    // Same normalization and hash as nurture.ts.
    const nurture = readFileSync("apps/functions/src/nurture.ts", "utf8");
    expect(nurture).toContain('const SUPPRESSIONS = "nurtureSuppressions"');
    expect(nurture).toMatch(/createHash\("sha256"\)/);
  });
});

describe("unsubscribe tokens and links", () => {
  it("creates one random token per address and reuses it afterwards", async () => {
    const { db, col } = fakeDb();
    const recipients = [{ uid: "u1", email: "a@example.com", emailHash: emailHash("a@example.com") }];
    const first = await ensureUnsubscribeTokens(db, recipients, 10);
    const token = first.get(recipients[0].emailHash)!;
    expect(isWellFormedToken(token)).toBe(true);
    expect(col(UNSUBSCRIBE_TOKENS_COLLECTION).get(recipients[0].emailHash)).toMatchObject({ token, uid: "u1", email: "a@example.com" });
    const second = await ensureUnsubscribeTokens(db, recipients, 20);
    expect(second.get(recipients[0].emailHash)).toBe(token);
    expect(newUnsubscribeToken()).not.toBe(newUnsubscribeToken());
  });

  it("builds an https one-click URL and RFC 8058 headers", () => {
    const token = "a".repeat(48);
    expect(unsubscribeUrl(token, { GCLOUD_PROJECT: "hi-coworking-plat" })).toBe(
      `https://us-central1-hi-coworking-plat.cloudfunctions.net/marketing_unsubscribe?t=${token}`,
    );
    expect(unsubscribeUrl(token, { HI_COWORKING_UNSUBSCRIBE_URL: "https://hi-coworking.com/u" })).toBe(`https://hi-coworking.com/u?t=${token}`);
    expect(unsubscribeUrl(token, { HI_COWORKING_UNSUBSCRIBE_URL: "http://insecure/u", GCLOUD_PROJECT: "p" })).toMatch(/^https:\/\/us-central1-p\./);
    expect(listUnsubscribeHeaders("https://x/u?t=1")).toEqual({
      "List-Unsubscribe": "<https://x/u?t=1>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(ONE_CLICK_POST_VALUE).toBe("List-Unsubscribe=One-Click");
  });
});

describe("campaign email messages", () => {
  const env = { GCLOUD_PROJECT: "hi-coworking-plat" };
  it("adds the footer link and List-Unsubscribe headers per recipient, and never sends without a token", () => {
    const a = { uid: "a", email: "a@example.com", emailHash: emailHash("a@example.com"), displayName: "Ann" };
    const b = { uid: "b", email: "b@example.com", emailHash: emailHash("b@example.com") };
    const tokenA = "b".repeat(48);
    const messages = buildCampaignEmailMessages("announce", { eventTitle: "Demo Day" }, [a, b], new Map([[a.emailHash, tokenA]]), env);
    expect(messages).toHaveLength(1);
    const url = `https://us-central1-hi-coworking-plat.cloudfunctions.net/marketing_unsubscribe?t=${tokenA}`;
    expect(messages[0].to).toBe("a@example.com");
    expect(messages[0].headers).toEqual({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(messages[0].html).toContain(`<a href="${url}" style="color:#6366f1;">Unsubscribe</a>`);
    expect(messages[0].html).toContain("Hey Ann");
  });

  it("escapes the unsubscribe URL in the footer and omits it when absent", () => {
    expect(renderEmailHtml("reminder", { unsubscribeUrl: 'https://x/?a=1&b="2"' })).toContain('href="https://x/?a=1&amp;b=&quot;2&quot;"');
    expect(renderEmailHtml("reminder", {})).not.toContain("Unsubscribe");
  });

  it("routes every campaign email through the opt-out filter", () => {
    const source = readFileSync("apps/functions/src/campaignJobs.ts", "utf8");
    expect(source).toContain("prepareCampaignEmails(recipients, claimed.type, ctx, now)");
    expect(source).not.toMatch(/recipients\.filter\(\(r\) => r\.email\)/);
    const resolver = readFileSync("apps/functions/src/providers/recipientResolver.ts", "utf8");
    expect(resolver.match(/marketingOptOut: (?:data|userData)\.marketingOptOut/g)).toHaveLength(2);
    expect(resolver.match(/doNotContact: (?:data|userData)\.doNotContact/g)).toHaveLength(2);
  });

  it("passes List-Unsubscribe headers through to Resend", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ data: [{ id: "1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new ResendEmailProvider("test-key", { fetchImpl, env: {} });
    await provider.sendBatch([{ to: "a@example.com", subject: "s", html: "h", headers: listUnsubscribeHeaders("https://x/u?t=1") }]);
    const sent = JSON.parse(String(calls[0].body));
    expect(sent[0].headers).toEqual({ "List-Unsubscribe": "<https://x/u?t=1>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    await provider.sendBatch([{ to: "a@example.com", subject: "s", html: "h" }]);
    expect(JSON.parse(String(calls[1].body))[0]).not.toHaveProperty("headers");
  });
});

describe("marketing_unsubscribe endpoint", () => {
  const token = "c".repeat(48);

  it("GET shows a confirmation form and changes nothing", async () => {
    const apply = vi.fn();
    const result = await handleUnsubscribeRequest({ method: "GET", token }, apply);
    expect(result.status).toBe(200);
    expect(result.html).toContain('<form method="post"');
    expect(result.html).toContain(`action="?t=${token}"`);
    expect(apply).not.toHaveBeenCalled();
  });

  it("POST (one-click) unsubscribes; bad tokens and methods are rejected", async () => {
    const apply = vi.fn(async () => "unsubscribed" as const);
    expect((await handleUnsubscribeRequest({ method: "POST", token }, apply)).status).toBe(200);
    expect(apply).toHaveBeenCalledWith(token);
    expect((await handleUnsubscribeRequest({ method: "POST", token: "<script>" }, apply)).status).toBe(404);
    expect((await handleUnsubscribeRequest({ method: "GET", token: undefined }, apply)).status).toBe(404);
    expect((await handleUnsubscribeRequest({ method: "POST", token }, async () => "not-found")).status).toBe(404);
    expect((await handleUnsubscribeRequest({ method: "DELETE", token }, apply)).status).toBe(405);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("applies the opt-out to suppressions, nurture enrollments and the member record", async () => {
    const hash = emailHash("m@example.com");
    const { db, col } = fakeDb({
      [UNSUBSCRIBE_TOKENS_COLLECTION]: { [hash]: { token, emailHash: hash, email: "m@example.com", uid: "u1" } },
      nurtureEnrollments: { e1: { emailHash: hash, status: "ACTIVE" }, e2: { emailHash: "other", status: "ACTIVE" } },
      users: { u1: { email: "m@example.com" } },
    });
    expect(await applyUnsubscribeToken(db, token, 99)).toBe("unsubscribed");
    expect(col(SUPPRESSIONS_COLLECTION).get(hash)).toMatchObject({ reason: "unsubscribe", source: "event-campaign", email: "m@example.com" });
    expect(col("nurtureEnrollments").get("e1")).toMatchObject({ status: "SUPPRESSED" });
    expect(col("nurtureEnrollments").get("e2")).toMatchObject({ status: "ACTIVE" });
    expect(col("users").get("u1")).toMatchObject({ marketingOptOut: true, updatedAt: 99 });
    // Idempotent, and an unknown token does nothing.
    expect(await applyUnsubscribeToken(db, token, 100)).toBe("unsubscribed");
    expect(await applyUnsubscribeToken(db, "d".repeat(48), 100)).toBe("not-found");
  });

  it("does not create a member record for a deleted account", async () => {
    const hash = emailHash("n@example.com");
    const { db, col } = fakeDb({ [UNSUBSCRIBE_TOKENS_COLLECTION]: { [hash]: { token, emailHash: hash, email: "n@example.com", uid: "gone" } } });
    expect(await applyUnsubscribeToken(db, token, 1)).toBe("unsubscribed");
    expect(col("users").has("gone")).toBe(false);
    expect(col(SUPPRESSIONS_COLLECTION).has(hash)).toBe(true);
  });
});
