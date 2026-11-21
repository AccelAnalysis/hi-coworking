"use client";

import { ArrowUpDown, Laptop, Monitor, AppWindow } from "lucide-react";
import {
  SEAT_AMENITY_LABELS,
  SEAT_TIERS,
  accessibleSeatName,
  getSeatByResourceId,
  visibleGuestRates,
  visibleMemberOverage,
  type SeatAmenity,
  type SeatCatalogEntry,
} from "@hi/shared";

export type DeskListOption = {
  resourceId: string;
  name: string;
  available: boolean;
  staffOnly?: boolean;
};

const AMENITY_ICON: Record<SeatAmenity, typeof Monitor> = {
  "sit-stand": ArrowUpDown,
  "monitor-dock": Monitor,
  window: AppWindow,
};

export function AmenityIcons({
  amenities,
  inverted = false,
}: {
  amenities: readonly SeatAmenity[];
  inverted?: boolean;
}) {
  if (amenities.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Amenities">
      {amenities.map((amenity) => {
        const Icon = AMENITY_ICON[amenity];
        return (
          <li key={amenity}>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                inverted ? "bg-white/15 text-white" : "bg-[#EEF0F6] text-[#101D4B]"
              }`}
              title={SEAT_AMENITY_LABELS[amenity]}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{SEAT_AMENITY_LABELS[amenity]}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GuestRateBadges({
  resourceId,
  inverted = false,
}: {
  resourceId: string;
  inverted?: boolean;
}) {
  const rates = visibleGuestRates(resourceId);
  const overage = visibleMemberOverage(resourceId);
  const parts: string[] = [];
  if (rates.halfDay) parts.push(`${rates.halfDay} half day`);
  if (rates.day) parts.push(`${rates.day} day`);
  if (rates.hourly) parts.push(`${rates.hourly}/hr`);
  if (parts.length === 0 && !overage) return null;
  return (
    <p className={`mt-1 text-sm ${inverted ? "text-white" : "text-[#4A5585]"}`}>
      {parts.join(" · ")}
      {overage ? ` · Member overage ${overage}/hr` : null}
    </p>
  );
}

function statusLabel(option: DeskListOption) {
  if (option.staffOnly) return "Staff only";
  return option.available ? "Available" : "Unavailable";
}

export function catalogCopy(resourceId: string, fallbackName: string): {
  title: string;
  seat?: SeatCatalogEntry;
  accessibleName: string;
} {
  const seat = getSeatByResourceId(resourceId);
  if (!seat) {
    return { title: fallbackName, accessibleName: fallbackName };
  }
  return {
    title: `${seat.displayId} · ${SEAT_TIERS[seat.tierId].name}`,
    seat,
    accessibleName: accessibleSeatName(resourceId),
  };
}

export function DeskOptionList({
  options,
  selectedResourceId,
  loadingQuote,
  showCatalogDetails,
  onSelect,
}: {
  options: DeskListOption[];
  selectedResourceId?: string;
  loadingQuote?: boolean;
  showCatalogDetails?: boolean;
  onSelect: (option: DeskListOption) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((option) => {
        const selected = selectedResourceId === option.resourceId;
        const selectable = option.available && !option.staffOnly && !loadingQuote;
        const copy = catalogCopy(option.resourceId, option.name);
        const title = showCatalogDetails ? copy.title : option.name;
        const accessible = showCatalogDetails
          ? `${copy.accessibleName}, ${statusLabel(option)}`
          : `${option.name}, ${statusLabel(option)}`;
        return (
          <button
            key={option.resourceId}
            type="button"
            disabled={!selectable}
            aria-pressed={selected}
            aria-label={accessible}
            onClick={() => onSelect(option)}
            className={`min-h-32 rounded-2xl p-4 text-left ring-1 transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${
              selected
                ? "bg-[#101D4B] text-white ring-[#101D4B]"
                : selectable
                  ? "bg-white text-[#101D4B] ring-slate-200 hover:ring-[#101D4B]"
                  : "cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                  selected ? "bg-white/15 text-white" : "bg-[#EEF0F6] text-[#101D4B]"
                }`}
              >
                <Laptop className="h-4 w-4" aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide">{statusLabel(option)}</span>
            </div>
            <p className="mt-4 font-semibold">{title}</p>
            {showCatalogDetails && copy.seat ? (
              <>
                <GuestRateBadges resourceId={option.resourceId} inverted={selected} />
                <AmenityIcons amenities={copy.seat.amenities} inverted={selected} />
              </>
            ) : (
              <p className={`mt-1 text-sm ${selected ? "text-slate-300" : "text-slate-500"}`}>
                Same desk for the full stay
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
