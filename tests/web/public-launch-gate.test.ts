import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_LAUNCH_AT,
  PUBLIC_LAUNCH_AT_ISO,
  PUBLIC_LAUNCH_LOCKED_MESSAGE,
  isPublicLaunchReached,
} from "../../apps/web/src/lib/publicLaunch";

const LAUNCH_UTC = Date.UTC(2026, 10, 30, 13, 0, 0); // 2026-11-30T13:00:00Z
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("public launch gate (Coming Soon countdown)", () => {
  it("targets 8:00 AM New York time on Monday, November 30, 2026 (EST, UTC-5)", () => {
    expect(PUBLIC_LAUNCH_AT_ISO).toBe("2026-11-30T08:00:00-05:00");
    expect(PUBLIC_LAUNCH_AT).toBe(LAUNCH_UTC);
    expect(new Date(PUBLIC_LAUNCH_AT).toISOString()).toBe("2026-11-30T13:00:00.000Z");

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
    expect(local).toBe("Monday, November 30, 2026 at 8:00 AM EST");
  });

  it("stays closed before the launch moment and opens exactly at it", () => {
    expect(isPublicLaunchReached(Date.UTC(2026, 10, 1, 13, 0, 0))).toBe(false); // old Nov 1 target
    expect(isPublicLaunchReached(Date.UTC(2026, 10, 16, 13, 0, 0))).toBe(false); // old Nov 16 target
    expect(isPublicLaunchReached(Date.UTC(2026, 10, 30, 12, 0, 0))).toBe(false); // 8 AM UTC-4 would be wrong offset
    expect(isPublicLaunchReached(LAUNCH_UTC - 1)).toBe(false);
    expect(isPublicLaunchReached(LAUNCH_UTC)).toBe(true);
    expect(isPublicLaunchReached(LAUNCH_UTC + 1)).toBe(true);
  });

  it("keeps the countdown and the gate on the shared helpers", () => {
    const countdown = read("apps/web/src/components/LaunchCountdown.tsx");
    const gate = read("apps/web/src/components/PublicSiteGate.tsx");
    for (const source of [countdown, gate]) {
      expect(source).toContain('from "@/lib/publicLaunch"');
      expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
    expect(gate).toContain("isComingSoonPubliclyActive(settings, now)");
    expect(gate).toContain("resolvePublicLaunchAt(settings.launchAt)");
    expect(gate).toContain("<LaunchCountdown launchAt={effectiveLaunchAt} />");
    expect(countdown).toContain("launchAt = PUBLIC_LAUNCH_AT");
  });
});

describe("pre-launch PublicSiteGate coverage", () => {
  const gated = [
    "apps/web/src/app/book/page.tsx",
    "apps/web/src/app/register/page.tsx",
    "apps/web/src/app/events/page.tsx",
    "apps/web/src/app/events/detail/page.tsx",
    "apps/web/src/app/events/waitlist/page.tsx",
    "apps/web/src/app/bookstore/page.tsx",
    "apps/web/src/app/bookstore/[id]/page.tsx",
    "apps/web/src/app/bookstore/item/page.tsx",
    "apps/web/src/app/bookstore/order/page.tsx",
    "apps/web/src/app/spaces/page.tsx",
  ];

  const open = [
    "apps/web/src/app/login/page.tsx",
    "apps/web/src/app/my-hi/page.tsx",
    "apps/web/src/app/book/complete/page.tsx",
    "apps/web/src/app/events/complete/page.tsx",
  ];

  it("wraps book, register, events, and bookstore purchase routes", () => {
    for (const file of gated) {
      const source = read(file);
      expect(source, file).toContain("PublicSiteGate");
      expect(source, file).toContain("<PublicSiteGate>");
    }
  });

  it("leaves login, my-hi, and checkout return pages open", () => {
    for (const file of open) {
      expect(read(file), file).not.toContain("PublicSiteGate");
    }
  });

  it("shows the server launch message on checkout errors", () => {
    expect(PUBLIC_LAUNCH_LOCKED_MESSAGE).toBe("Booking opens Monday, November 30 at 8 AM");
    const booking = read("apps/web/src/components/BookingExperienceWithDeskChange.tsx");
    const register = read("apps/web/src/app/register/page.tsx");
    const pricing = read("apps/web/src/app/pricing/page.tsx");
    const events = read("apps/web/src/components/events/EventRegistrationPanel.tsx");
    const bookstore = read("apps/web/src/app/bookstore/item/BookstoreItemClient.tsx");
    for (const source of [booking, register, pricing, events, bookstore]) {
      expect(source).toContain("callableErrorMessage");
    }
  });
});
