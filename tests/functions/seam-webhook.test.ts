import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Firestore, secrets and logger so the real access_seamWebhook runs.
const h = vi.hoisted(() => {
  type Doc = Record<string, unknown>;
  const docs = new Map<string, Doc>();
  const secrets: Record<string, string> = {};
  const logs: unknown[][] = [];
  const checkIns: unknown[] = [];
  let autoId = 0;

  function ref(collection: string, id: string) {
    const path = `${collection}/${id}`;
    return {
      id,
      path,
      async get() {
        const data = docs.get(path);
        return { id, exists: !!data, data: () => (data ? { ...data } : undefined), ref: ref(collection, id) };
      },
      async set(data: Doc, opts?: { merge?: boolean }) {
        docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...data } : { ...data });
      },
      async update(data: Doc) {
        if (!docs.has(path)) throw new Error("not found");
        docs.set(path, { ...docs.get(path), ...data });
      },
    };
  }
  function query(collection: string, filters: Array<[string, unknown]>) {
    return {
      where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]]),
      limit: () => query(collection, filters),
      async get() {
        const found = [...docs.entries()]
          .filter(([path, data]) => path.startsWith(`${collection}/`) && filters.every(([f, v]) => data[f] === v))
          .map(([path, data]) => {
            const id = path.slice(collection.length + 1);
            return { id, data: () => ({ ...data }), ref: ref(collection, id) };
          });
        return { empty: found.length === 0, docs: found };
      },
    };
  }
  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => ref(name, id ?? `auto${++autoId}`),
      where: (field: string, op: string, value: unknown) => query(name, []).where(field, op, value),
    }),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn({
        get: (r: ReturnType<typeof ref>) => r.get(),
        set: (r: ReturnType<typeof ref>, data: Doc, opts?: { merge?: boolean }) => r.set(data, opts),
      });
    },
  };
  return { docs, secrets, logs, checkIns, db };
});

// apps/functions pins its own firebase-admin (nested in node_modules), so mock that copy.
vi.mock("../../apps/functions/node_modules/firebase-admin", () => ({ firestore: () => h.db }));
vi.mock("firebase-admin", () => ({ firestore: () => h.db }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => h.logs.push(args),
  warn: (...args: unknown[]) => h.logs.push(args),
  error: (...args: unknown[]) => h.logs.push(args),
}));
vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({ name, value: () => h.secrets[name] ?? "" }),
}));
vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  onRequest: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock("../../apps/functions/src/frontDeskKiosk/functions", () => ({
  checkInFromDoorUnlock: async (input: unknown) => {
    h.checkIns.push(input);
  },
}));

import { access_seamWebhook } from "../../apps/functions/src/access";
import { signSeamPayload, verifySeamWebhook } from "../../apps/functions/src/accessCodes/seamWebhook";
import { seamErrorType } from "../../apps/functions/src/providers/seamProvider";

const SECRET = `whsec_${Buffer.from("test-seam-webhook-secret-32-bytes").toString("base64")}`;
const OTHER = `whsec_${Buffer.from("some-other-secret-value-xxxxxxx").toString("base64")}`;

type Res = { statusCode: number; body: unknown };
async function call(rawBody: string | undefined, headers: Record<string, string>, method = "POST"): Promise<Res> {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const req = { method, headers, rawBody: rawBody === undefined ? undefined : Buffer.from(rawBody), body: {} };
  await (access_seamWebhook as unknown as (q: unknown, r: unknown) => Promise<void>)(req, res);
  return { statusCode: res.statusCode, body: res.body };
}

function signed(body: string, opts: { id?: string; ts?: number; secret?: string; sigs?: (s: string) => string } = {}) {
  const id = opts.id ?? "msg_1";
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = signSeamPayload(opts.secret ?? SECRET, id, ts, body);
  return {
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": opts.sigs ? opts.sigs(sig) : `v1,${sig}`,
    "content-type": "application/json",
  };
}

const unlock = JSON.stringify({ event_type: "lock.unlocked", event_id: "evt_1", device_id: "dev_1", access_code_id: "code_1" });
const accessWrites = () => [...h.docs.keys()].filter((k) => /^(accessEvents|doors|accessCodes|accessGrants)\//.test(k) && !k.startsWith("doors/door1") && !k.startsWith("accessCodes/c1") && !k.startsWith("accessGrants/g1"));

beforeEach(() => {
  h.docs.clear();
  h.logs.length = 0;
  h.checkIns.length = 0;
  h.secrets.SEAM_WEBHOOK_SECRET = SECRET;
  h.docs.set("doors/door1", { seamDeviceId: "dev_1" });
  h.docs.set("accessCodes/c1", { seamCodeId: "code_1", grantId: "g1", doorId: "door1" });
  h.docs.set("accessGrants/g1", { bookingId: "b1", userId: "member-1" });
});

describe("Seam webhook (Svix) verification", () => {
  it("accepts a valid signature and a verified door unlock checks the member in", async () => {
    const res = await call(unlock, signed(unlock));
    expect(res).toEqual({ statusCode: 200, body: { ok: true } });
    expect(h.checkIns).toEqual([expect.objectContaining({ uid: "member-1", doorId: "door1", eventKey: "evt_1" })]);
    expect(accessWrites()).toHaveLength(1); // one door_unlocked access event
  });

  it("rejects a tampered body", async () => {
    const headers = signed(unlock);
    const tampered = unlock.replace("dev_1", "dev_2");
    expect((await call(tampered, headers)).statusCode).toBe(401);
    expect(h.checkIns).toEqual([]);
    expect(accessWrites()).toEqual([]);
  });

  it("rejects a signature made with the wrong secret", async () => {
    expect((await call(unlock, signed(unlock, { secret: OTHER }))).statusCode).toBe(401);
    expect(h.checkIns).toEqual([]);
  });

  it("rejects a stale or future timestamp (5 minute tolerance)", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await call(unlock, signed(unlock, { ts: now - 6 * 60 }))).statusCode).toBe(401);
    expect((await call(unlock, signed(unlock, { ts: now + 6 * 60 }))).statusCode).toBe(401);
    expect((await call(unlock, signed(unlock, { ts: now - 4 * 60, id: "msg_ok" }))).statusCode).toBe(200);
  });

  it("rejects missing headers and unsigned requests, processing nothing", async () => {
    expect((await call(unlock, { "content-type": "application/json" })).statusCode).toBe(401);
    for (const drop of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const headers: Record<string, string> = signed(unlock);
      delete headers[drop];
      expect((await call(unlock, headers)).statusCode).toBe(401);
    }
    // The old seam-signature header no longer opens anything.
    expect((await call(unlock, { "seam-signature": "abc" })).statusCode).toBe(401);
    expect((await call("{}", {})).statusCode).toBe(401);
    expect(h.checkIns).toEqual([]);
    expect(accessWrites()).toEqual([]);
  });

  it("fails closed without a secret", async () => {
    const headers = signed(unlock);
    h.secrets.SEAM_WEBHOOK_SECRET = "";
    expect((await call(unlock, headers)).statusCode).toBe(401);
    expect(h.checkIns).toEqual([]);
  });

  it("accepts any matching v1 signature in a space-separated list", async () => {
    const bogus = Buffer.alloc(32, 7).toString("base64");
    const res = await call(unlock, signed(unlock, { sigs: (s) => `v2,${s} v1,${bogus} v1,${s}` }));
    expect(res.statusCode).toBe(200);
    expect((await call(unlock, signed(unlock, { id: "msg_2", sigs: () => `v1,${bogus} v1a,x` }))).statusCode).toBe(401);
  });

  it("ignores a replayed svix-id", async () => {
    const headers = signed(unlock);
    expect((await call(unlock, headers)).statusCode).toBe(200);
    const replay = await call(unlock, headers);
    expect(replay).toEqual({ statusCode: 200, body: { ok: true, duplicate: true } });
    expect(h.checkIns).toHaveLength(1);
    expect(accessWrites()).toHaveLength(1);
  });

  it("rejects non-POST and a signed non-JSON body", async () => {
    expect((await call(undefined, {}, "GET")).statusCode).toBe(405);
    const bad = "not json";
    expect((await call(bad, signed(bad, { id: "msg_bad" }))).statusCode).toBe(400);
  });

  it("logs only the event type and outcome, never the body", async () => {
    await call(unlock, signed(unlock));
    await call(unlock, {});
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain("dev_1");
    expect(logged).not.toContain("code_1");
    expect(logged).not.toContain("evt_1");
    expect(logged).toContain("lock.unlocked");
    expect(logged).toContain("processed");
    expect(logged).toContain("rejected");
  });

  it("verifier is pure and checks the raw bytes", () => {
    const now = Math.floor(Date.now() / 1000);
    const headers = signed(unlock, { ts: now });
    expect(verifySeamWebhook({ headers, rawBody: Buffer.from(unlock), secret: SECRET, nowSeconds: now })).toEqual({ ok: true, id: "msg_1" });
    expect(verifySeamWebhook({ headers, rawBody: Buffer.from(`${unlock} `), secret: SECRET, nowSeconds: now }).ok).toBe(false);
    expect(verifySeamWebhook({ headers, rawBody: undefined, secret: SECRET, nowSeconds: now }).ok).toBe(false);
  });
});

describe("Seam errors and code names carry no response body or member name", () => {
  it("keeps only Seam's error type", () => {
    expect(seamErrorType('{"error":{"type":"invalid_input","message":"code 123456 for a member"}}')).toBe("invalid_input");
    expect(seamErrorType("<html>oops</html>")).toBeNull();
  });

  it("source never logs or rethrows the Seam body and names codes by booking only", () => {
    const provider = readFileSync("apps/functions/src/providers/seamProvider.ts", "utf8");
    expect(provider).not.toMatch(/body: text/);
    expect(provider).not.toMatch(/\$\{text\}/);
    expect(provider).not.toMatch(/validateSeamSignature/);
    const access = readFileSync("apps/functions/src/access.ts", "utf8");
    expect(access).not.toMatch(/seam-signature/);
    expect(access).not.toMatch(/JSON\.stringify\(req\.body\)/);
    expect(access).not.toMatch(/userName\.split/);
    expect(access).toMatch(/`HiCo-\$\{bookingId\.slice\(-6\)\}`/);
  });
});
