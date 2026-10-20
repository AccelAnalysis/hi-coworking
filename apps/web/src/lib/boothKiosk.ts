import type { Metadata } from "next";
import { NASA_EXPO_EVENT } from "./expoNasaLead";

export const BOOTH_MANIFEST_PATH = "/expo/accel-analysis.webmanifest";
export const BOOTH_APPLE_TOUCH_ICON = "/expo/apple-touch-icon.png";
export const BOOTH_START_PATH = `/intake?event=${NASA_EXPO_EVENT}`;

/**
 * Scope is the site root because /expo/nasa-2026 and /intake do not share a
 * longer prefix, and the booth redirect has to stay inside the installed app.
 * Clicks are still limited to those two paths.
 */
export const BOOTH_MANIFEST = {
  name: "Accel Analysis",
  short_name: "Accel Analysis",
  description: "Tell Accel Analysis how we should follow up with you.",
  id: BOOTH_START_PATH,
  start_url: BOOTH_START_PATH,
  scope: "/",
  display_override: ["fullscreen"],
  display: "standalone",
  background_color: "#F2F6FF",
  theme_color: "#F2F6FF",
  lang: "en",
  icons: [
    { src: "/expo/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/expo/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: BOOTH_APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png", purpose: "any" },
  ],
} as const;

export const boothKioskMetadata = {
  manifest: BOOTH_MANIFEST_PATH,
  appleWebApp: {
    capable: true,
    title: "Accel Analysis",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: BOOTH_APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }],
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
} satisfies Metadata;

export type BoothFullscreenTarget = {
  requestFullscreen?: () => void | Promise<void>;
  webkitRequestFullscreen?: () => void;
};

export function boothFullscreenApiAvailable(element: BoothFullscreenTarget): boolean {
  return typeof element.requestFullscreen === "function" || typeof element.webkitRequestFullscreen === "function";
}

export function requestBoothFullscreen(element: BoothFullscreenTarget): void {
  if (typeof element.requestFullscreen === "function") {
    void Promise.resolve(element.requestFullscreen()).catch(() => {});
    return;
  }
  if (typeof element.webkitRequestFullscreen === "function") {
    element.webkitRequestFullscreen();
  }
}

export function boothAlreadyImmersive(input: {
  standalone: boolean;
  displayModeFullscreen: boolean;
  displayModeStandalone: boolean;
  fullscreenElement: boolean;
}): boolean {
  return input.standalone || input.displayModeFullscreen || input.displayModeStandalone || input.fullscreenElement;
}

export function boothHrefStaysInFlow(href: string, pageUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return false;
  }
  const page = new URL(pageUrl);
  if (url.origin !== page.origin) return false;
  const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return path === "/intake" || path === "/expo/nasa-2026";
}
