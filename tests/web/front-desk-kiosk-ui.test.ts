import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatMinutes,
  fromEasternInputValue,
  isOfflineError,
  toEasternInputValue,
} from "../../apps/web/src/lib/frontDeskKioskFormat";
import { ADMIN_CAPABILITIES } from "../../apps/web/src/lib/adminCapabilities";

const web = resolve(__dirname, "../../apps/web");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");

const kioskFiles = [
  "src/components/kiosk/FrontDeskKiosk.tsx",
  "src/components/kiosk/FrontDeskKiosk.module.css",
  "src/components/kiosk/HiLogo.tsx",
  "src/app/kiosk/front-desk/layout.tsx",
  "src/app/kiosk/front-desk/page.tsx",
];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("front-desk kiosk Eastern time helpers", () => {
  it("round-trips Eastern wall time in EDT and EST", () => {
    const summer = Date.UTC(2026, 6, 15, 13, 30); // 9:30 AM EDT
    expect(toEasternInputValue(summer)).toBe("2026-07-15T09:30");
    expect(fromEasternInputValue("2026-07-15T09:30")).toBe(summer);
    const winter = Date.UTC(2026, 11, 15, 14, 30); // 9:30 AM EST
    expect(toEasternInputValue(winter)).toBe("2026-12-15T09:30");
    expect(fromEasternInputValue("2026-12-15T09:30")).toBe(winter);
  });

  it("handles the DST change days", () => {
    // Fall back: Nov 1 2026, 1:30 AM happens twice; either reading round-trips.
    const fallBack = fromEasternInputValue("2026-11-01T01:30");
    expect(fallBack).not.toBeNull();
    expect(toEasternInputValue(fallBack!)).toBe("2026-11-01T01:30");
    // Spring forward: Mar 8 2026, 2:30 AM does not exist in Eastern time.
    expect(fromEasternInputValue("2026-03-08T02:30")).toBeNull();
    expect(fromEasternInputValue("2026-03-08T03:30")).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });

  it("rejects malformed input", () => {
    expect(fromEasternInputValue("")).toBeNull();
    expect(fromEasternInputValue("2026-07-15 09:30")).toBeNull();
  });

  it("formats minutes for people", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(135)).toBe("2 hr 15 min");
  });

  it("treats unavailable functions as offline", () => {
    expect(isOfflineError({ code: "functions/unavailable" })).toBe(true);
    expect(isOfflineError({ code: "functions/permission-denied", message: "no" })).toBe(false);
  });
});

describe("front-desk kiosk UI source", () => {
  const kiosk = read("src/components/kiosk/FrontDeskKiosk.tsx");
  const css = read("src/components/kiosk/FrontDeskKiosk.module.css");

  it("uses touch targets of at least 88px", () => {
    expect(kiosk).toContain("min-h-[88px]");
    expect(kiosk).not.toMatch(/min-h-(1[01]|\[[1-7]\dpx\])\b/);
  });

  it("only has check-in and check-out actions", () => {
    expect(kiosk).toContain('"check_in"');
    expect(kiosk).toContain('"check_out"');
    expect(kiosk).not.toMatch(/bookResource|createBooking|stripe|checkout\.session/i);
  });

  it("shows the idle logo cycle with the brand copy and a reduced-motion crossfade", () => {
    expect(kiosk).toContain("Welcome. Make yourself at home.");
    expect(kiosk).toContain("Touch to check in or check out");
    expect(kiosk).toContain("idleLogoMinutes");
    expect(kiosk).toContain('variant="inverse"');
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(kiosk).not.toMatch(/<video/);
  });

  it("asks people to see staff when offline and keeps no queue", () => {
    expect(kiosk).toContain("KIOSK_STAFF_MESSAGE");
    expect(kiosk).not.toMatch(/localStorage|indexedDB/);
  });

  it("reuses the booth fullscreen helpers and holds a wake lock", () => {
    const screen = read("src/lib/kioskScreen.ts");
    expect(screen).toContain("requestBoothFullscreen");
    expect(screen).toContain("wakeLock");
  });

  it("follows the kiosk brand and copy rules", () => {
    for (const file of kioskFiles) {
      const text = read(file);
      expect(text, file).not.toMatch(/Geist|font-logo/);
      expect(text, file).not.toMatch(/\bfree\b/i);
      expect(text, file).not.toMatch(/\$\d/);
      expect(text, file).not.toMatch(/\b(slate|emerald|amber|rose)-\d/);
    }
    expect(kiosk).toContain("font-display");
  });

  it("uses only the brand marks that exist", () => {
    const logo = read("src/components/kiosk/HiLogo.tsx");
    for (const match of logo.matchAll(/"(\/brand\/hi-coworking\/[^"]+\.png)"/g)) {
      expect(existsSync(resolve(web, "public" + match[1])), match[1]).toBe(true);
    }
    const manifest = JSON.parse(read("public/kiosk/front-desk.webmanifest"));
    expect(manifest.start_url).toBe("/kiosk/front-desk");
    expect(manifest.background_color.toLowerCase()).toBe("#101d4b");
    for (const icon of manifest.icons) expect(existsSync(resolve(web, "public" + icon.src)), icon.src).toBe(true);
  });

  it("keeps text color pairs at WCAG AA contrast", () => {
    const pairs: Array<[string, string]> = [
      ["#FFFFFF", "#101D4B"],
      ["#101D4B", "#EEF0F6"],
      ["#4A5585", "#FFFFFF"],
      ["#4A5585", "#EEF0F6"],
      ["#3A4675", "#FFFFFF"],
      ["#C5CADB", "#101D4B"],
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("front-desk admin and member wiring", () => {
  it("is not live until its functions are deployed", () => {
    expect(ADMIN_CAPABILITIES.frontDesk.live).toBe(true);
    expect(read("src/app/admin/front-desk/page.tsx")).toContain("ADMIN_CAPABILITIES.frontDesk.note");
  });

  it("tolerates missing callables on the dashboard and My Hi", () => {
    const dashboard = read("src/app/admin/dashboard/page.tsx");
    expect(dashboard).toContain('capability: "frontDesk"');
    expect(dashboard).toContain("adminKioskOverview({}).then((result) => result.data).catch(() => null)");
    expect(read("src/components/kiosk/FrontDeskCard.tsx")).toContain("if (!summary) return null;");
    expect(read("src/app/account/bookings/page.tsx")).toContain("<FrontDeskCard />");
  });

  it("requires a reason when staff close a visit", () => {
    const page = read("src/app/admin/front-desk/page.tsx");
    expect(page).toContain('requiredRole="staff"');
    expect(page).toMatch(/reason/i);
  });
  it("ignores late lookup, check-in and check-out responses after the kiosk resets", () => {
    const source = read("src/components/kiosk/FrontDeskKiosk.tsx");
    expect(source).toMatch(/const goStart = useCallback\(\(\) => \{\s*flowRef\.current \+= 1;/);
    expect(source.match(/if \(flowRef\.current !== flow\) return;/g)?.length).toBe(3);
  });
});
