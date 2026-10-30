import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_LAUNCH_AT,
  PUBLIC_LAUNCH_AT_ISO,
  isPublicLaunchReached,
} from "../../apps/web/src/lib/publicLaunch";

const LAUNCH_UTC = Date.UTC(2026, 10, 16, 13, 0, 0); // 2026-11-16T13:00:00Z
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("public launch gate (Coming Soon countdown)", () => {
  it("targets 8:00 AM New York time on Monday, November 16, 2026 (EST, UTC-5)", () => {
    expect(PUBLIC_LAUNCH_AT_ISO).toBe("2026-11-16T08:00:00-05:00");
    expect(PUBLIC_LAUNCH_AT).toBe(LAUNCH_UTC);
    expect(new Date(PUBLIC_LAUNCH_AT).toISOString()).toBe("2026-11-16T13:00:00.000Z");

    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(PUBLIC_LAUNCH_AT);
    expect(local).toBe("Monday, November 16, 2026 at 8:00 AM EST");
  });

  it("stays closed before the launch moment and opens exactly at it", () => {
    expect(isPublicLaunchReached(Date.UTC(2026, 10, 1, 13, 0, 0))).toBe(false); // old Nov 1 target
    expect(isPublicLaunchReached(Date.UTC(2026, 10, 16, 12, 0, 0))).toBe(false); // 8 AM UTC-4 would be wrong offset
    expect(isPublicLaunchReached(LAUNCH_UTC - 1)).toBe(false);
    expect(isPublicLaunchReached(LAUNCH_UTC)).toBe(true);
    expect(isPublicLaunchReached(LAUNCH_UTC + 1)).toBe(true);
  });

  it("keeps the countdown and the gate on the shared constant", () => {
    const countdown = read("apps/web/src/components/LaunchCountdown.tsx");
    const gate = read("apps/web/src/components/PublicSiteGate.tsx");
    for (const source of [countdown, gate]) {
      expect(source).toContain('from "@/lib/publicLaunch"');
      expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
    expect(gate).toContain("isPublicLaunchReached(Date.now())");
  });
});
