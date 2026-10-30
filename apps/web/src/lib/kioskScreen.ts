"use client";

import { useEffect } from "react";
import { boothAlreadyImmersive, requestBoothFullscreen } from "./boothKiosk";

/**
 * Keeps the front-desk kiosk awake and fullscreen. Reuses the booth kiosk
 * fullscreen helpers (lib/boothKiosk.ts) and the Jessica kiosk wake-lock
 * pattern (booth/JessicaKiosk.tsx): a screen wake lock re-requested whenever
 * the page becomes visible again, and fullscreen on the first touch because
 * browsers need a gesture. On an iPad in Guided Access the Home Screen web app
 * is already fullscreen, so both calls are best-effort.
 */
function immersiveNow(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const webkit = document as Document & { webkitFullscreenElement?: Element | null };
  return boothAlreadyImmersive({
    standalone: nav.standalone === true,
    displayModeFullscreen: window.matchMedia("(display-mode: fullscreen)").matches,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    fullscreenElement: Boolean(document.fullscreenElement || webkit.webkitFullscreenElement),
  });
}

export function useKioskScreen(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock?.request("screen");
        if (cancelled) {
          await next?.release();
          return;
        }
        lock = next ?? null;
      } catch {
        // Not supported or not allowed; set Auto-Lock to Never on the iPad.
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    const onGesture = () => {
      if (!immersiveNow()) requestBoothFullscreen(document.documentElement);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", onGesture, { once: true });
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onGesture);
      void lock?.release();
    };
  }, [enabled]);
}
