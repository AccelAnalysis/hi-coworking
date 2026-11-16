import { describe, expect, it } from "vitest";
import {
  PUBLIC_LAUNCH_AT,
  isComingSoonPubliclyActive,
  nextMondayEightAmEt,
  publicSiteModeView,
  resolvePublicLaunchAt,
  zonedDateTimeToUtcMs,
} from "../../apps/web/src/lib/publicLaunch";

const LAUNCH_UTC = Date.UTC(2026, 10, 30, 13, 0, 0);

describe("effective public launch time", () => {
  it("uses the compiled default when no override is stored", () => {
    expect(resolvePublicLaunchAt(undefined)).toBe(PUBLIC_LAUNCH_AT);
    expect(resolvePublicLaunchAt(null)).toBe(PUBLIC_LAUNCH_AT);
    expect(resolvePublicLaunchAt(0)).toBe(PUBLIC_LAUNCH_AT);
  });

  it("uses a stored launchAt override", () => {
    const override = Date.UTC(2026, 11, 14, 13, 0, 0);
    expect(resolvePublicLaunchAt(override)).toBe(override);
  });

  it("converts America/New_York wall times, including EST and EDT", () => {
    expect(new Date(zonedDateTimeToUtcMs("2026-11-30", "08:00")!).toISOString()).toBe("2026-11-30T13:00:00.000Z");
    expect(new Date(zonedDateTimeToUtcMs("2026-03-09", "08:00")!).toISOString()).toBe("2026-03-09T12:00:00.000Z");
  });

  it("picks the next Monday 8:00 AM ET after now", () => {
    // Monday Nov 16, 2026 10:00 AM ET is after 8:00, so the next Monday is Nov 23.
    const afterEight = zonedDateTimeToUtcMs("2026-11-16", "10:00")!;
    const next = nextMondayEightAmEt(afterEight);
    expect(next).toEqual({ date: "2026-11-23", time: "08:00", at: zonedDateTimeToUtcMs("2026-11-23", "08:00") });
    expect(next.at).toBeGreaterThan(afterEight);

    // Monday Nov 16, 2026 7:00 AM ET is before 8:00, so use that morning.
    const beforeEight = zonedDateTimeToUtcMs("2026-11-16", "07:00")!;
    const sameMorning = nextMondayEightAmEt(beforeEight);
    expect(sameMorning.date).toBe("2026-11-16");
    expect(sameMorning.at).toBe(LAUNCH_UTC - 14 * 86_400_000); // Nov 16 8:00 AM ET
    expect(sameMorning.at).toBeGreaterThan(beforeEight);
  });
});

describe("coming soon public activity", () => {
  it("stays off when the flag is off, even before the launch date", () => {
    expect(isComingSoonPubliclyActive({ comingSoonEnabled: false }, LAUNCH_UTC - 1)).toBe(false);
  });

  it("is on only when the flag is on and the launch moment has not arrived", () => {
    const settings = { comingSoonEnabled: true };
    expect(isComingSoonPubliclyActive(settings, LAUNCH_UTC - 1)).toBe(true);
    expect(isComingSoonPubliclyActive(settings, LAUNCH_UTC)).toBe(false);
  });

  it("can be turned back on after the compiled date by setting a future launchAt", () => {
    const now = LAUNCH_UTC + 1;
    expect(isComingSoonPubliclyActive({ comingSoonEnabled: true }, now)).toBe(false);
    const relaunch = Date.UTC(2026, 11, 14, 13, 0, 0);
    expect(isComingSoonPubliclyActive({ comingSoonEnabled: true, launchAt: relaunch }, now)).toBe(true);
    expect(isComingSoonPubliclyActive({ comingSoonEnabled: true, launchAt: relaunch }, relaunch)).toBe(false);
  });
});

describe("admin public site mode card", () => {
  it("shows Coming Soon and Open site when the gate is actually on", () => {
    const view = publicSiteModeView({ comingSoonEnabled: true }, LAUNCH_UTC - 1);
    expect(view.isGated).toBe(true);
    expect(view.buttonLabel).toBe("Open site to public…");
    expect(view.statusText).toContain("Coming Soon page");
    expect(view.requiresNewLaunchAt).toBe(false);
  });

  it("shows the site is public and Return to Coming Soon when the date has passed but the flag is still on", () => {
    const view = publicSiteModeView({ comingSoonEnabled: true }, LAUNCH_UTC + 1);
    expect(view.isGated).toBe(false);
    expect(view.buttonLabel).toBe("Return to Coming Soon…");
    expect(view.statusText).toContain("already passed");
    expect(view.requiresNewLaunchAt).toBe(true);
    expect(view.confirmTitle).toBe("Return the site to Coming Soon?");
  });

  it("shows the site is public when the flag is off", () => {
    const view = publicSiteModeView({ comingSoonEnabled: false }, LAUNCH_UTC - 1);
    expect(view.isGated).toBe(false);
    expect(view.buttonLabel).toBe("Return to Coming Soon…");
    expect(view.statusText).toBe("The public site is open to everyone.");
    expect(view.requiresNewLaunchAt).toBe(false);
  });

  it("requires a new date to return to Coming Soon if the opening time has already passed", () => {
    const view = publicSiteModeView({ comingSoonEnabled: false }, LAUNCH_UTC + 1);
    expect(view.buttonLabel).toBe("Return to Coming Soon…");
    expect(view.requiresNewLaunchAt).toBe(true);
  });
});
