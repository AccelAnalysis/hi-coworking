import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: () => {}, warn: () => {}, error: () => {} }));

import {
  WEBHOOK_LEASE_MS,
  decideWebhookClaim,
  runIdempotentWebhook,
  type WebhookEventStore,
} from "../../apps/functions/src/payments/idempotency";
import { alreadyProvisionedByEvent } from "../../apps/functions/src/payments/stripeWebhook";
import type { WebhookEventDocData } from "../../apps/functions/src/payments/types";

/** In-memory webhookEvents collection with the same merge semantics as Firestore. */
function memoryStore() {
  const docs = new Map<string, WebhookEventDocData>();
  const store: WebhookEventStore = {
    async transact(eventId, mutate) {
      const existing = docs.get(eventId);
      const { patch, value } = mutate(existing ? { ...existing } : undefined);
      if (patch) docs.set(eventId, { ...(existing || {}), ...patch } as WebhookEventDocData);
      return value;
    },
  };
  return { docs, store };
}

/** Side effects keyed by deterministic IDs, like create() on Firestore docs. */
function sideEffects() {
  const written = new Map<string, number>();
  return {
    written,
    createOnce(id: string) {
      // create(): the first write wins; a repeat is ALREADY_EXISTS and a no-op.
      if (!written.has(id)) written.set(id, 1);
    },
  };
}

const T0 = 1_800_000_000_000;

describe("decideWebhookClaim", () => {
  it("claims a new event", () => {
    expect(decideWebhookClaim(undefined, T0)).toEqual({ outcome: "claim", attempt: 1 });
  });

  it("skips an event that already succeeded", () => {
    expect(decideWebhookClaim({ status: "success", attempts: 1 }, T0)).toEqual({ outcome: "duplicate" });
  });

  it("retries a failed event and counts the attempt", () => {
    expect(decideWebhookClaim({ status: "failed", attempts: 2 }, T0)).toEqual({ outcome: "claim", attempt: 3 });
  });

  it("reports a live lease as in progress", () => {
    expect(decideWebhookClaim({ status: "processing", attempts: 1, leaseExpiresAt: T0 + 1000 }, T0))
      .toEqual({ outcome: "in_progress", leaseExpiresAt: T0 + 1000 });
  });

  it("takes over an expired lease (crashed attempt)", () => {
    expect(decideWebhookClaim({ status: "processing", attempts: 1, leaseExpiresAt: T0 - 1 }, T0))
      .toEqual({ outcome: "claim", attempt: 2 });
  });

  describe("older docs written before the lease (no status)", () => {
    it("treats result success as done", () => {
      expect(decideWebhookClaim({ processedAt: T0 - 10, result: "success" }, T0)).toEqual({ outcome: "duplicate" });
    });

    it("retries a stored error", () => {
      expect(decideWebhookClaim({ processedAt: T0 - 10, result: "error: boom" }, T0))
        .toEqual({ outcome: "claim", attempt: 2 });
    });

    it("waits on a recent claim with no result, then takes it over", () => {
      expect(decideWebhookClaim({ processedAt: T0 - 10 }, T0).outcome).toBe("in_progress");
      expect(decideWebhookClaim({ processedAt: T0 - WEBHOOK_LEASE_MS - 1 }, T0))
        .toEqual({ outcome: "claim", attempt: 2 });
    });
  });
});

describe("runIdempotentWebhook", () => {
  it("marks success only after processing completes", async () => {
    const { docs, store } = memoryStore();
    let statusDuringProcessing: string | undefined;
    const run = await runIdempotentWebhook("evt_1", "stripe", async () => {
      statusDuringProcessing = docs.get("evt_1")?.status;
    }, { store, now: () => T0 });

    expect(run).toEqual({ outcome: "processed", attempt: 1 });
    expect(statusDuringProcessing).toBe("processing");
    expect(docs.get("evt_1")).toMatchObject({ status: "success", result: "success", attempts: 1, leaseToken: null });
  });

  it("re-processes a retry after a partial failure, and each side effect lands once", async () => {
    const { docs, store } = memoryStore();
    const effects = sideEffects();
    let failSecondStep = true;
    const process = async () => {
      effects.createOnce("payments/pay_1:paid"); // step 1 succeeds every time
      if (failSecondStep) throw new Error("Firestore unavailable");
      effects.createOnce("bookPurchases/purchase_evt_2_book_1"); // step 2
    };

    const first = await runIdempotentWebhook("evt_2", "stripe", process, { store, now: () => T0 });
    expect(first.outcome).toBe("failed");
    expect(docs.get("evt_2")).toMatchObject({ status: "failed", lastError: "Firestore unavailable", attempts: 1 });
    expect(effects.written.has("bookPurchases/purchase_evt_2_book_1")).toBe(false);

    // Stripe's retry: previously skipped as "already processed"; now processed.
    failSecondStep = false;
    const retry = await runIdempotentWebhook("evt_2", "stripe", process, { store, now: () => T0 + 60_000 });
    expect(retry).toEqual({ outcome: "processed", attempt: 2 });
    expect(docs.get("evt_2")).toMatchObject({ status: "success", attempts: 2 });
    expect(effects.written.get("payments/pay_1:paid")).toBe(1);
    expect(effects.written.get("bookPurchases/purchase_evt_2_book_1")).toBe(1);

    // A later duplicate delivery is skipped without running anything.
    const processAgain = vi.fn(process);
    const dup = await runIdempotentWebhook("evt_2", "stripe", processAgain, { store, now: () => T0 + 120_000 });
    expect(dup).toEqual({ outcome: "duplicate" });
    expect(processAgain).not.toHaveBeenCalled();
  });

  it("tells a concurrent delivery the event is in progress", async () => {
    const { store } = memoryStore();
    let concurrent: unknown;
    await runIdempotentWebhook("evt_3", "stripe", async () => {
      concurrent = await runIdempotentWebhook("evt_3", "stripe", async () => {
        throw new Error("must not run");
      }, { store, now: () => T0 + 5 });
    }, { store, now: () => T0 });
    expect(concurrent).toEqual({ outcome: "in_progress" });
  });

  it("lets a later delivery take over a crashed attempt, and the stale attempt cannot overwrite it", async () => {
    const { docs, store } = memoryStore();
    let clock = T0;
    let staleResult: unknown;
    // Attempt 1 hangs past its lease; attempt 2 takes over and succeeds.
    staleResult = await runIdempotentWebhook("evt_4", "stripe", async () => {
      clock = T0 + WEBHOOK_LEASE_MS + 1;
      const takeover = await runIdempotentWebhook("evt_4", "stripe", async () => {}, { store, now: () => clock });
      expect(takeover).toEqual({ outcome: "processed", attempt: 2 });
      throw new Error("stale attempt failed late");
    }, { store, now: () => clock });

    expect(staleResult).toMatchObject({ outcome: "failed", attempt: 1 });
    expect(docs.get("evt_4")).toMatchObject({ status: "success", attempts: 2 });
  });

  it("stores long errors truncated", async () => {
    const { docs, store } = memoryStore();
    await runIdempotentWebhook("evt_5", "stripe", async () => {
      throw new Error("x".repeat(2000));
    }, { store, now: () => T0 });
    expect(docs.get("evt_5")?.lastError?.length).toBe(500);
  });
});

describe("membership provisioning once per event", () => {
  it("skips only the event that already provisioned the member", () => {
    expect(alreadyProvisionedByEvent({ membershipProvisionEventId: "evt_a" }, "evt_a")).toBe(true);
    expect(alreadyProvisionedByEvent({ membershipProvisionEventId: "evt_a" }, "evt_b")).toBe(false);
    expect(alreadyProvisionedByEvent(undefined, "evt_a")).toBe(false);
    expect(alreadyProvisionedByEvent({}, "")).toBe(false);
  });
});

describe("stripe_webhook source contract", () => {
  const source = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");

  it("uses the lease, not the mark-before-processing check", () => {
    expect(source).toContain("runIdempotentWebhook(");
    expect(source).not.toContain("ensureIdempotent(");
    expect(source).not.toContain("markWebhookResult(");
  });

  it("returns non-2xx for in-progress and failed events so Stripe retries", () => {
    expect(source).toMatch(/in_progress[\s\S]*status: 409/);
    expect(source).toMatch(/failed[\s\S]*status: 500/);
  });

  it("creates deterministic purchase and vendor-table docs once", () => {
    expect(source).toContain('createOnce(getDb().collection("bookPurchases").doc(purchaseId)');
    expect(source).toContain("createOnce(vendorTableRef");
    expect(source).not.toMatch(/bookPurchases"\)\.doc\(purchaseId\)\.set\(/);
  });
});
