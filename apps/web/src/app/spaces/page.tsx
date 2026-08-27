"use client";

import BookingExperience from "@/components/BookingExperience";
import { PublicSiteGate } from "@/components/PublicSiteGate";

export default function SpacesPage() {
  return (
    <PublicSiteGate>
      <BookingExperience />
    </PublicSiteGate>
  );
}
