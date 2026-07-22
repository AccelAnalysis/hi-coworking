"use client";

import { Building2, MapPin, ShieldCheck } from "lucide-react";
import type { PublicOrganizationProjection } from "@/lib/firestore";
import { isValidLatitude, isValidLongitude } from "../map/geojson";

export function ExchangeOrganizationCard({
  organization,
  selected,
  compact = false,
  onSelect,
}: {
  organization: PublicOrganizationProjection;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const publicLocation = [organization.city, organization.state].filter(Boolean).join(", ");
  const markerAvailable = !organization.homeBased
    && !organization.privacySuppressed
    && organization.coordinatePublicationApproved === true
    && isValidLatitude(organization.latitude)
    && isValidLongitude(organization.longitude);

  return (
    <button
      type="button"
      data-exchange-entity="organization"
      data-exchange-id={organization.id}
      aria-pressed={selected}
      onClick={onSelect}
      className={`w-full rounded-2xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-violet-500 ${
        selected
          ? "border-violet-400 bg-violet-50 shadow-md"
          : "border-white/80 bg-white/68 hover:bg-white/90"
      } ${compact ? "text-xs" : "text-sm"}`}
    >
      <span className="flex items-start gap-2.5">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="line-clamp-2 block text-slate-950">{organization.name}</strong>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {publicLocation || "Public location not listed"}
            </span>
            {organization.verificationStatus === "verified" ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified
              </span>
            ) : null}
          </span>
          {!markerAvailable ? (
            <span className="mt-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
              List only · no permitted marker coordinates
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
