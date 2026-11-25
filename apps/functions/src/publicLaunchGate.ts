/**
 * Server-side companion to PublicSiteGate.
 *
 * Uses the same rule as isComingSoonPubliclyActive() and the same
 * staff / admin / master exemption as the public site gate (custom
 * claims first, then the users doc).
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import {
  isComingSoonPubliclyActive,
  PUBLIC_LAUNCH_LOCKED_MESSAGE,
  type PublicLaunchSettings,
} from "../../web/src/lib/publicLaunch";

export { PUBLIC_LAUNCH_LOCKED_MESSAGE };

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
