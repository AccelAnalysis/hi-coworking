"use client";

import BookingExperience from "@/components/BookingExperience";
import { PublicSiteGate } from "@/components/PublicSiteGate";

export default function BookPage() {
  return (
    <PublicSiteGate>
      <BookingExperience />
    </PublicSiteGate>
  );
}
