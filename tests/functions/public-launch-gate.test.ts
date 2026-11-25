import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import {
  PUBLIC_LAUNCH_AT as WEB_PUBLIC_LAUNCH_AT,
  PUBLIC_LAUNCH_AT_ISO as WEB_PUBLIC_LAUNCH_AT_ISO,
  PUBLIC_LAUNCH_LOCKED_MESSAGE as WEB_PUBLIC_LAUNCH_LOCKED_MESSAGE,
  isComingSoonPubliclyActive as webIsComingSoonPubliclyActive,
  resolvePublicLaunchAt as webResolvePublicLaunchAt,
} from "../../apps/web/src/lib/publicLaunch";
import {
  PUBLIC_LAUNCH_AT,
  PUBLIC_LAUNCH_AT_ISO,
  PUBLIC_LAUNCH_LOCKED_MESSAGE,
  assertPublicLaunchOpen,
  isComingSoonPubliclyActive,
  isLaunchBypassRole,
  resolvePublicLaunchAt,
  type PublicLaunchGateDeps,
} from "../../apps/functions/src/publicLaunchGate";

const LAUNCH = PUBLIC_LAUNCH_AT;
const BEFORE = LAUNCH - 1;
const AFTER = LAUNCH;
const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

const gatedSettings = { comingSoonEnabled: true as const };
const openSettings = { comingSoonEnabled: false as const };

function deps(overrides: Partial<PublicLaunchGateDeps> & { now: number; role?: string | null }): PublicLaunchGateDeps {
  return {
    loadSettings: overrides.loadSettings ?? (async () => gatedSettings),
    loadUserRole: overrides.loadUserRole ?? (async () => overrides.role ?? null),
    now: overrides.now,
  };
}

async function expectLocked(auth: Parameters<typeof assertPublicLaunchOpen>[0], now = BEFORE, role: string | null = null) {
  await expect(assertPublicLaunchOpen(auth, deps({ now, role }))).rejects.toMatchObject({
    code: "failed-precondition",
    message: PUBLIC_LAUNCH_LOCKED_MESSAGE,
  });
}

describe("pre-launch checkout lock", () => {
  it("blocks a guest before launch when Coming Soon is on", async () => {
    await expectLocked(null);
    await expectLocked(undefined);
    await expectLocked({ uid: "member-1", token: { role: "member" } });
  });

  it("allows staff, admin, and master before launch via custom claims", async () => {
    for (const role of ["staff", "admin", "master"] as const) {
      expect(isLaunchBypassRole(role)).toBe(true);
      await expect(
        assertPublicLaunchOpen({ uid: `${role}-1`, token: { role } }, deps({ now: BEFORE })),
      ).resolves.toBeUndefined();
    }
  });

  it("allows staff before launch via the users doc when claims have no role", async () => {
    await expect(
      assertPublicLaunchOpen(
        { uid: "staff-doc", token: {} },
        deps({ now: BEFORE, role: "staff" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("does not treat a member as exempt", async () => {
    await expectLocked({ uid: "member-2", token: { role: "member" } }, BEFORE, "member");
  });

  it("allows everyone after the effective launch time", async () => {
    await expect(assertPublicLaunchOpen(null, deps({ now: AFTER }))).resolves.toBeUndefined();
    await expect(
      assertPublicLaunchOpen({ uid: "member-3", token: { role: "member" } }, deps({ now: AFTER })),
    ).resolves.toBeUndefined();
  });

  it("is open when the Coming Soon flag is off, even before launch", async () => {
    await expect(
      assertPublicLaunchOpen(null, deps({ now: BEFORE, loadSettings: async () => openSettings })),
    ).resolves.toBeUndefined();
  });

  it("honors a later launchAt override", async () => {
    const relaunch = LAUNCH + 7 * 24 * 60 * 60 * 1000;
    await expect(
      assertPublicLaunchOpen(
        null,
        deps({
          now: AFTER,
          loadSettings: async () => ({ comingSoonEnabled: true, launchAt: relaunch }),
        }),
      ),
    ).rejects.toBeInstanceOf(HttpsError);
  });

  it("uses the shared public message", () => {
    expect(PUBLIC_LAUNCH_LOCKED_MESSAGE).toBe("Booking opens Monday, November 30 at 8 AM");
  });

  it("stays in sync with the web Coming Soon helpers", () => {
    expect(PUBLIC_LAUNCH_AT_ISO).toBe(WEB_PUBLIC_LAUNCH_AT_ISO);
    expect(PUBLIC_LAUNCH_AT).toBe(WEB_PUBLIC_LAUNCH_AT);
    expect(PUBLIC_LAUNCH_LOCKED_MESSAGE).toBe(WEB_PUBLIC_LAUNCH_LOCKED_MESSAGE);
    const before = PUBLIC_LAUNCH_AT - 1;
    const settingsOn = { comingSoonEnabled: true };
    const settingsOff = { comingSoonEnabled: false };
    const override = PUBLIC_LAUNCH_AT + 86_400_000;
    expect(isComingSoonPubliclyActive(settingsOn, before)).toBe(webIsComingSoonPubliclyActive(settingsOn, before));
    expect(isComingSoonPubliclyActive(settingsOn, PUBLIC_LAUNCH_AT)).toBe(webIsComingSoonPubliclyActive(settingsOn, PUBLIC_LAUNCH_AT));
    expect(isComingSoonPubliclyActive(settingsOff, before)).toBe(webIsComingSoonPubliclyActive(settingsOff, before));
    expect(resolvePublicLaunchAt(override)).toBe(webResolvePublicLaunchAt(override));
    expect(isComingSoonPubliclyActive({ comingSoonEnabled: true, launchAt: override }, PUBLIC_LAUNCH_AT))
      .toBe(webIsComingSoonPubliclyActive({ comingSoonEnabled: true, launchAt: override }, PUBLIC_LAUNCH_AT));
  });
});

describe("pre-launch checkout lock wiring", () => {
  const checkoutFiles = [
    "apps/functions/src/bookingFlexTransaction.ts",
    "apps/functions/src/index.ts",
    "apps/functions/src/eventsV2/publicRegistration.ts",
    "apps/functions/src/bookstoreCommerce.ts",
    "apps/functions/src/bookstore.ts",
  ];

  it("calls the shared guard at the start of each checkout callable", () => {
    const booking = read("apps/functions/src/bookingFlexTransaction.ts");
    const membership = read("apps/functions/src/index.ts");
    const events = read("apps/functions/src/eventsV2/publicRegistration.ts");
    const bookstoreLive = read("apps/functions/src/bookstoreCommerce.ts");
    const bookstoreLegacy = read("apps/functions/src/bookstore.ts");

    expect(booking).toMatch(/export const booking_beginCheckout[\s\S]{0,400}await assertPublicLaunchOpen\(request\.auth\)/);
    expect(membership).toMatch(/export const stripe_createCheckoutSession[\s\S]{0,400}await assertPublicLaunchOpen\(request\.auth\)/);
    expect(events).toMatch(/export const events_v2BeginRegistration[\s\S]{0,400}await assertPublicLaunchOpen\(request\.auth\)/);
    expect(bookstoreLive).toMatch(/export const bookstore_createCheckoutSession[\s\S]{0,400}await assertPublicLaunchOpen\(request\.auth\)/);
    expect(bookstoreLegacy).toMatch(/export const bookstore_createCheckoutSession[\s\S]{0,400}await assertPublicLaunchOpen\(request\.auth\)/);
    for (const file of checkoutFiles) {
      expect(read(file)).toContain("assertPublicLaunchOpen");
    }
  });

  it("leaves availability and quote callables open so the staff UI still works", () => {
    const source = read("apps/functions/src/bookingFlexPublic.ts");
    expect(source).not.toContain("assertPublicLaunchOpen");
    expect(source).toContain("export const booking_getAvailability");
    expect(source).toContain("export const booking_createQuote");
  });
});
