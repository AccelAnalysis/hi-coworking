/**
 * Server-side companion to PublicSiteGate.
 *
 * The launch rule is a MIRROR of apps/web/src/lib/publicLaunch.ts
 * (isComingSoonPubliclyActive / resolvePublicLaunchAt). Keep the ISO
 * default and the predicate in sync; tests assert they match.
 *
 * Staff / admin / master are exempt, same as the public site gate:
 * custom claims first, then the users doc.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

/** MIRROR of apps/web/src/lib/publicLaunch.ts → PUBLIC_LAUNCH_AT_ISO */
export const PUBLIC_LAUNCH_AT_ISO = "2026-11-30T08:00:00-05:00";

export const PUBLIC_LAUNCH_AT = Date.parse(PUBLIC_LAUNCH_AT_ISO);

/** Shown when a pre-launch checkout or registration callable is refused. */
export const PUBLIC_LAUNCH_LOCKED_MESSAGE = "Booking opens Monday, November 30 at 8 AM";

export type PublicLaunchSettings = {
  comingSoonEnabled: boolean;
  launchAt?: number | null;
};

export function resolvePublicLaunchAt(launchAt?: number | null): number {
  if (typeof launchAt === "number" && Number.isFinite(launchAt) && launchAt > 0) {
    return launchAt;
  }
  return PUBLIC_LAUNCH_AT;
}

export function isPublicLaunchReached(now: number, launchAt: number = PUBLIC_LAUNCH_AT): boolean {
  return now >= launchAt;
}

/** True when signed-out visitors should see Coming Soon. Staff bypass is separate. */
export function isComingSoonPubliclyActive(settings: PublicLaunchSettings, now: number): boolean {
  if (!settings.comingSoonEnabled) return false;
  return !isPublicLaunchReached(now, resolvePublicLaunchAt(settings.launchAt));
}

export const LAUNCH_BYPASS_ROLES = ["staff", "admin", "master"] as const;

export type LaunchAuth = {
  uid?: string;
  token?: Record<string, unknown>;
} | null | undefined;

export type PublicLaunchGateDeps = {
  loadSettings: () => Promise<PublicLaunchSettings>;
  loadUserRole: (uid: string) => Promise<string | null>;
  now?: number;
};

export function isLaunchBypassRole(role: string | null | undefined): boolean {
  return role === "staff" || role === "admin" || role === "master";
}

export function roleFromAuthToken(auth: LaunchAuth): string | null {
  const role = auth?.token?.role;
  return typeof role === "string" ? role : null;
}

export function defaultPublicLaunchGateDeps(): PublicLaunchGateDeps {
  return {
    loadSettings: loadPublicLaunchSettings,
    loadUserRole,
  };
}

export async function loadPublicLaunchSettings(): Promise<PublicLaunchSettings> {
  const snap = await admin.firestore().collection("siteSettings").doc("public").get();
  const data = snap.data() || {};
  const launchAt = data.launchAt;
  return {
    comingSoonEnabled: data.comingSoonEnabled === true,
    launchAt: typeof launchAt === "number" && Number.isFinite(launchAt) ? launchAt : null,
  };
}

export async function loadUserRole(uid: string): Promise<string | null> {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  const role = snap.data()?.role;
  return typeof role === "string" ? role : null;
}

export async function assertPublicLaunchOpen(
  auth: LaunchAuth,
  deps: PublicLaunchGateDeps = defaultPublicLaunchGateDeps(),
): Promise<void> {
  if (isLaunchBypassRole(roleFromAuthToken(auth))) return;

  const uid = typeof auth?.uid === "string" && auth.uid ? auth.uid : "";
  if (uid && isLaunchBypassRole(await deps.loadUserRole(uid))) return;

  const settings = await deps.loadSettings();
  const now = typeof deps.now === "number" ? deps.now : Date.now();
  if (isComingSoonPubliclyActive(settings, now)) {
    throw new HttpsError("failed-precondition", PUBLIC_LAUNCH_LOCKED_MESSAGE);
  }
}
