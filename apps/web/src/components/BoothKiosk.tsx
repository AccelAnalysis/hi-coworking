"use client";

import { useEffect, useState } from "react";
import {
  boothAlreadyImmersive,
  boothFullscreenApiAvailable,
  boothHrefStaysInFlow,
  requestBoothFullscreen,
} from "@/lib/boothKiosk";

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

/** Keeps booth taps on the intake form and the NASA expo entry. */
export function BoothKioskGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const block = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
      const href = anchor.getAttribute("href");
      if (modified || !href || !boothHrefStaysInFlow(href, window.location.href)) {
        event.preventDefault();
      }
    };
    document.addEventListener("click", block, true);
    document.addEventListener("auxclick", block, true);
    return () => {
      document.removeEventListener("click", block, true);
      document.removeEventListener("auxclick", block, true);
    };
  }, []);

  return children;
}

export function BoothFullScreenButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      setVisible(boothFullscreenApiAvailable(root) && !immersiveNow());
    };
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    const standalone = window.matchMedia("(display-mode: standalone)");
    fullscreen.addEventListener("change", update);
    standalone.addEventListener("change", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
      fullscreen.removeEventListener("change", update);
      standalone.removeEventListener("change", update);
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => requestBoothFullscreen(document.documentElement)}
      className="min-h-11 shrink-0 rounded-full border-2 border-[#5E5E5E]/40 bg-white px-4 text-base font-semibold text-[#1B1B1B] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
    >
      Full screen
    </button>
  );
}
