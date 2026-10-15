"use client";

import { useEffect } from "react";
import { NASA_EXPO_EVENT } from "@/lib/expoNasaLead";

/**
 * Old booth TV address. Jessica now lives at /kiosk/jessica.
 * Event query params are forwarded for analytics and are not rendered.
 */
export default function NasaExpoKioskAlias() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("event") && !params.get("event_id")) {
      params.set("event", NASA_EXPO_EVENT);
    }
    const query = params.toString();
    window.location.replace(query ? `/kiosk/jessica?${query}` : "/kiosk/jessica");
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#00072E] px-6 text-center text-white">
      <p className="text-2xl font-semibold">Opening Jessica…</p>
    </main>
  );
}
