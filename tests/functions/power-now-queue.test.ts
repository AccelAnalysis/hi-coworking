import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POWER_NOW_SEND_ERROR } from "../../apps/functions/src/expo/powerNowModel";
import { decideLeadSubmitOutcome } from "../../apps/web/src/lib/expoLeadQueue";
import {
  POWER_NOW_POST_TIMEOUT_MS,
  POWER_NOW_QUEUED_MESSAGE,
  POWER_NOW_UNREACHABLE_ERROR,
  postPowerNow,
  type PowerNowSubmission,
} from "../../apps/web/src/lib/powerNowQueue";

const payload = {
  form: "power-now",
  path: "pitch",
  fullName: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "",
  businessName: "Analytical Engines",
  company: "",
  city: "Carrollton",
  state: "VA",
  businessStage: "idea_concept",
  opportunityType: "starting_a_new_business",
  businessStageOther: "",
  businessDescription: "Computes.",
  pitchTopic: "Engines",
  progress: "",
  heardAbout: "",
  heardAboutOther: "",
  offerType: "",
  offerDescription: "",
  approximateValue: "",
  website: "",
  consent: { email: true, sms: false, phone: false },
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmContent: "",
  referrerPath: "",
  submittedAt: "2026-10-18T23:02:46.000Z",
  clientSubmissionId: "11111111-1111-4111-8111-111111111111",
  expo_hp: "",
} as PowerNowSubmission;

function setOnline(online: boolean): void {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav) {
    Object.defineProperty(nav, "onLine", { value: online, configurable: true });
    return;
  }
  vi.stubGlobal("navigator", { onLine: online });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Power NOW submit outcome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setOnline(true);
  });

  it("queues only when the browser is offline, before any request", async () => {
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await postPowerNow(payload);

    expect(outcome).toEqual({ decision: "queue", error: "Offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves a 2xx body that accepted the pitch", async () => {
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true, accepted: true })));

    await expect(postPowerNow(payload)).resolves.toEqual({ decision: "saved", error: null });
  });

  it("rejects a 2xx body that did not accept the pitch", async () => {
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: false })));

    await expect(postPowerNow(payload)).resolves.toEqual({
      decision: "rejected",
      error: POWER_NOW_SEND_ERROR,
      fields: undefined,
    });
  });

  it("keeps validation and rate-limit responses on the form", async () => {
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, {
      ok: false,
      error: "Please add your business stage.",
      fields: { stage: "Please add your business stage." },
    })));

    await expect(postPowerNow(payload)).resolves.toEqual({
      decision: "rejected",
      error: "Please add your business stage.",
      fields: { stage: "Please add your business stage." },
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, {
      ok: false,
      error: "Please wait a few minutes and try again, or email hello@accelanalysis.com.",
    })));
    const limited = await postPowerNow(payload);
    expect(limited.decision).toBe("rejected");
    expect(limited.error).toContain("Please wait");
  });

  it("shows the server error for 404, 500, 502, and 503 instead of the offline queue", async () => {
    setOnline(true);
    for (const status of [404, 500, 502, 503, 504]) {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, {
        ok: false,
        error: POWER_NOW_SEND_ERROR,
      })));
      const outcome = await postPowerNow(payload);
      expect(outcome.decision).toBe("rejected");
      expect(outcome.error).toBe(POWER_NOW_SEND_ERROR);
      expect(outcome.error).not.toBe(POWER_NOW_QUEUED_MESSAGE);
    }
  });

  it("does not call a timeout, CORS failure, or other thrown fetch an offline save", async () => {
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }));

    const timedOut = await postPowerNow(payload);
    expect(timedOut).toEqual({ decision: "rejected", error: POWER_NOW_UNREACHABLE_ERROR });
    expect(timedOut.error).not.toContain("back online");
    expect(timedOut.error).not.toContain(POWER_NOW_QUEUED_MESSAGE);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const failed = await postPowerNow(payload);
    expect(failed.decision).toBe("rejected");
    expect(failed.error).toBe(POWER_NOW_UNREACHABLE_ERROR);
  });

  it("queues a thrown fetch when the browser goes offline during the request", async () => {
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => {
      setOnline(false);
      throw new TypeError("Failed to fetch");
    }));

    await expect(postPowerNow(payload)).resolves.toEqual({ decision: "queue", error: "Offline" });
  });

  it("waits longer than the function limit and leaves the booth queue rule alone", () => {
    const queue = readFileSync("apps/web/src/lib/powerNowQueue.ts", "utf8");
    const page = readFileSync("apps/web/src/app/power-now/PowerNowPage.tsx", "utf8");
    const handler = readFileSync("apps/functions/src/expo/submitNasaLead.ts", "utf8");

    expect(POWER_NOW_POST_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(queue).toContain("AbortSignal.timeout(POWER_NOW_POST_TIMEOUT_MS)");
    expect(queue).not.toContain("decideLeadSubmitOutcome");
    expect(handler).toContain("timeoutSeconds: 60");
    expect(page).toContain("We’ll send it when you’re back online. It isn’t on the list until it sends.");
    expect(page).toContain('if (outcome.decision === "queue")');
    expect(page).toContain("setFormError(outcome.error || POWER_NOW_SEND_ERROR)");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 502 })).toBe("queue");
    expect(decideLeadSubmitOutcome({ online: true, networkError: false, httpStatus: 503 })).toBe("queue");
  });
});
