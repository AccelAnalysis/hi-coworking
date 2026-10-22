import { describe, expect, it, vi } from "vitest";
import { createVerificationController } from "../../apps/web/src/lib/emailVerification";

describe("explicit verification requests (no live email)", () => {
  it("does not send on initialization or for an already verified user", async () => {
    const send = vi.fn();
    const controller = createVerificationController({ isVerified: () => true, send });
    expect(send).not.toHaveBeenCalled();
    expect((await controller.request()).message).toContain("already verified");
    expect(send).not.toHaveBeenCalled();
  });
  it("allows only one explicit request per cooldown, including concurrent clicks", async () => {
    let now = 1000;
    const send = vi.fn().mockResolvedValue(undefined);
    const controller = createVerificationController({ isVerified: () => false, send, now: () => now });
    const results = await Promise.all([controller.request(), controller.request()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results[0].message).toContain("requested");
    expect(results[1].ok).toBe(false);
    now += 60_001;
    await controller.request();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("honors a persisted cooldown and surfaces provider throttling without claiming success", async () => {
    let now = 1000;
    const send = vi.fn().mockRejectedValue({ code: "auth/too-many-requests" });
    const controller = createVerificationController({ isVerified: () => false, send, now: () => now, retryAt: 2000 });
    await controller.request();
    expect(send).not.toHaveBeenCalled();
    now = 3000;
    const result = await controller.request();
    expect(result.ok).toBe(false);
    expect(result.retryAt).toBe(now + 300000);
    expect(result.message).toContain("Too many requests");
  });
  it("handles errors without blocking booking access or claiming delivery", async () => {
    const controller = createVerificationController({ isVerified: () => false, send: vi.fn().mockRejectedValue(new Error("offline")) });
    const result = await controller.request();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("could not request");
  });
});
