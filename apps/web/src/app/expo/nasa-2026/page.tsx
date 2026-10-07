"use client";

import { useEffect } from "react";
import { NASA_EXPO_EVENT } from "@/lib/expoNasaLead";

/**
 * Existing booth QR codes and Guided Access stay on this path.
 * The event is added to the query string and is not shown on the intake page.
 */
export default function NasaExpoIntakeAlias() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("event") && !params.get("event_id")) {
      params.set("event", NASA_EXPO_EVENT);
    }
    const query = params.toString();
    window.location.replace(query ? `/intake?${query}` : "/intake");
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#F2F6FF] px-6 text-center text-[#1B1B1B]">
      <p className="text-2xl font-semibold">Opening Accel Analysis intake…</p>
    </main>
  );
}
