"use client";

import { useId, useState, type ReactNode } from "react";
import {
  SEAT_TIERS,
  accessibleSeatName,
  visibleGuestRates,
  type SeatMapSpot,
} from "@hi/shared";
import { AmenityIcons, GuestRateBadges, catalogCopy } from "@/components/booking/DeskOptionList";

export type SeatAvailability = {
  resourceId: string;
  name: string;
  available: boolean;
};

type SeatVisualState = "available" | "unavailable" | "selected" | "staff";

function seatState(spot: SeatMapSpot, selectedResourceId?: string, available?: boolean): SeatVisualState {
  if (spot.staffOnly || !spot.bookable) return "staff";
  if (selectedResourceId === spot.resourceId) return "selected";
  if (available) return "available";
  return "unavailable";
}

function stateLabel(state: SeatVisualState) {
  if (state === "staff") return "Staff only, unavailable";
  if (state === "selected") return "Selected";
  if (state === "available") return "Available";
  return "Unavailable";
}

const STATE_CLASS: Record<SeatVisualState, string> = {
  available:
    "bg-white text-[#101D4B] ring-[#101D4B] hover:bg-[#EEF0F6]",
  selected:
    "bg-[#101D4B] text-white ring-[#101D4B]",
  unavailable:
    "cursor-not-allowed bg-[#EEF0F6] text-[#4A5585] ring-slate-300",
  staff:
    "cursor-not-allowed bg-[#EEF0F6] text-[#4A5585] ring-[#4A5585] [ring-style:dashed]",
};

/**
 * Built-in schematic of the Carrollton space, traced from the numbered D1–D7
 * plan (viewBox matches the 1024×709 reference). Used when no published
 * background image is available. The private office is drawn as architecture
 * only — it is not a seat.
 */
export function FloorPlanSchematic({ titleId }: { titleId: string }) {
  return (
    <svg
      viewBox="70 90 880 540"
      className="h-auto w-full"
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>Hi Coworking floor plan</title>
      <rect width="1024" height="709" fill="#ffffff" />
      {/* Main room */}
      <path
        d="M142 118 H635 V236 H245 V118 M635 118 H922 V200 H880 V118 M922 200 V500 H700 V430 H635 V570 H142 V430 H90 V330 H142 V118"
        fill="none"
      />
      <rect x="142" y="118" width="493" height="452" fill="#F5F6FA" stroke="#101D4B" strokeWidth="3" />
      {/* Right-hand private office, not bookable */}
      <rect x="635" y="118" width="287" height="382" fill="#ffffff" stroke="#101D4B" strokeWidth="3" />
      {/* Restrooms */}
      <rect x="245" y="118" width="218" height="118" fill="#ffffff" stroke="#101D4B" strokeWidth="2" />
      <line x1="354" y1="118" x2="354" y2="236" stroke="#101D4B" strokeWidth="2" />
      {/* Entry */}
      <rect x="90" y="330" width="52" height="100" fill="#F5F6FA" stroke="#101D4B" strokeWidth="2" />
      {/* Conference table */}
      <rect x="280" y="250" width="220" height="70" rx="12" fill="#ffffff" stroke="#101D4B" strokeWidth="2" />
      <text x="390" y="292" textAnchor="middle" fill="#101D4B" fontSize="14" fontFamily="DM Sans, sans-serif" fontWeight="650">
        Conference table
      </text>
      {/* Window desks along the south wall */}
      <rect x="270" y="500" width="80" height="55" rx="6" fill="none" stroke="#101D4B" strokeWidth="1.5" strokeDasharray="5 4" />
      <rect x="365" y="500" width="80" height="55" rx="6" fill="none" stroke="#101D4B" strokeWidth="1.5" strokeDasharray="5 4" />
      <rect x="455" y="500" width="80" height="55" rx="6" fill="none" stroke="#101D4B" strokeWidth="1.5" strokeDasharray="5 4" />
      <rect x="545" y="500" width="80" height="55" rx="6" fill="none" stroke="#101D4B" strokeWidth="1.5" strokeDasharray="5 4" />
      {/* Reception L-desk */}
      <path d="M160 400 h90 v90 h-40 v-50 h-50 z" fill="none" stroke="#101D4B" strokeWidth="2" />
      {/* Lounge along the partition */}
      <rect x="610" y="390" width="50" height="110" rx="8" fill="#ffffff" stroke="#101D4B" strokeWidth="1.5" />
      <text x="780" y="300" textAnchor="middle" fill="#4A5585" fontSize="13" fontFamily="DM Sans, sans-serif">
        Private office
      </text>
      <text x="665" y="455" textAnchor="middle" fill="#4A5585" fontSize="11" fontFamily="DM Sans, sans-serif">
        Lounge
      </text>
    </svg>
  );
}

export function SeatMapPicker({
  spots,
  backgroundUrl,
  availability,
  selectedResourceId,
  loadingQuote,
  summary,
  list,
  onSelectSeat,
}: {
  spots: SeatMapSpot[];
  backgroundUrl?: string;
  availability: SeatAvailability[];
  selectedResourceId?: string;
  loadingQuote?: boolean;
  summary?: ReactNode;
  list: ReactNode;
  onSelectSeat: (resourceId: string) => void;
}) {
  const titleId = useId();
  const tabMapId = useId();
  const tabListId = useId();
  const panelMapId = useId();
  const panelListId = useId();
  const [view, setView] = useState<"map" | "list">("map");
  const availableIds = new Set(
    availability.filter((item) => item.available).map((item) => item.resourceId),
  );

  return (
    <div className="text-[#101D4B]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl font-semibold text-[#101D4B] sm:text-2xl">3. Choose your desk</h2>
          <p className="mt-1 text-sm leading-6 text-[#4A5585]">
            Pick a specific desk for the full stay. Planned seat rates are shown as a guide; checkout still uses the current hourly rate until pricing is updated.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Desk picker view"
          className="flex rounded-full bg-[#EEF0F6] p-1"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = view === "map" ? "list" : "map";
            setView(next);
            const target = event.currentTarget.querySelector<HTMLButtonElement>(
              next === "map" ? '[aria-controls="' + panelMapId + '"]' : '[aria-controls="' + panelListId + '"]',
            );
            target?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id={tabMapId}
            aria-controls={panelMapId}
            aria-selected={view === "map"}
            tabIndex={view === "map" ? 0 : -1}
            onClick={() => setView("map")}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${
              view === "map" ? "bg-[#101D4B] text-white" : "text-[#101D4B]"
            }`}
          >
            Map
          </button>
          <button
            type="button"
            role="tab"
            id={tabListId}
            aria-controls={panelListId}
            aria-selected={view === "list"}
            tabIndex={view === "list" ? 0 : -1}
            onClick={() => setView("list")}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${
              view === "list" ? "bg-[#101D4B] text-white" : "text-[#101D4B]"
            }`}
          >
            List
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-xs font-medium text-[#4A5585]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-white ring-2 ring-[#101D4B]" /> Available</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-[#101D4B]" /> Selected</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-[#EEF0F6] ring-2 ring-slate-300" /> Unavailable</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-[#4A5585] bg-[#EEF0F6]" /> Staff only</span>
      </div>

      <div hidden={view !== "map"} id={panelMapId} role="tabpanel" aria-labelledby={tabMapId} className="mt-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)] lg:items-start">
          <div className="relative overflow-visible rounded-3xl bg-white px-1 pb-7 pt-2 ring-1 ring-slate-200">
            {backgroundUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={backgroundUrl}
                alt=""
                className="h-auto w-full select-none"
              />
            ) : (
              <FloorPlanSchematic titleId={titleId} />
            )}
            {spots.map((spot) => {
              const state = seatState(spot, selectedResourceId, availableIds.has(spot.resourceId));
              const selectable = state === "available" && !loadingQuote;
              const rates = visibleGuestRates(spot.resourceId);
              const rateHint = rates.day ? `${rates.day} day` : rates.halfDay ? `${rates.halfDay} half day` : "";
              const label = `${accessibleSeatName(spot.resourceId)}, ${stateLabel(state)}${rateHint ? `, ${rateHint}` : ""}`;
              return (
                <button
                  key={spot.resourceId}
                  type="button"
                  disabled={!selectable}
                  aria-pressed={state === "selected"}
                  aria-label={label}
                  onClick={() => onSelectSeat(spot.resourceId)}
                  data-resource={spot.resourceId}
                  style={{ left: `${spot.cx}%`, top: `${spot.cy}%` }}
                  className={`absolute z-10 flex min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-2.5 text-sm font-semibold ring-2 transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${STATE_CLASS[state]}`}
                >
                  {spot.displayId}
                </button>
              );
            })}
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <SeatSummary
              spots={spots}
              selectedResourceId={selectedResourceId}
              availableIds={availableIds}
              summary={summary}
            />
          </div>
        </div>
      </div>

      <div hidden={view !== "list"} id={panelListId} role="tabpanel" aria-labelledby={tabListId} className="mt-5">
        {list}
        {summary ? <div className="mt-6">{summary}</div> : null}
      </div>
    </div>
  );
}

function SeatSummary({
  spots,
  selectedResourceId,
  availableIds,
  summary,
}: {
  spots: SeatMapSpot[];
  selectedResourceId?: string;
  availableIds: Set<string>;
  summary?: ReactNode;
}) {
  const selected = spots.find((spot) => spot.resourceId === selectedResourceId);
  if (!selected) {
    const availableCount = spots.filter((spot) => spot.bookable && availableIds.has(spot.resourceId)).length;
    return (
      <div>
        <p className="text-sm font-medium text-[#4A5585]">Selected desk</p>
        <h3 className="font-display mt-2 text-xl font-semibold text-[#101D4B]">Choose a desk on the map</h3>
        <p className="mt-2 text-sm leading-6 text-[#4A5585]">
          {availableCount} available desk{availableCount === 1 ? "" : "s"} for this time. D7 is the reception desk and stays staff-only.
        </p>
      </div>
    );
  }

  const copy = catalogCopy(selected.resourceId, selected.name);
  const state = seatState(selected, selectedResourceId, availableIds.has(selected.resourceId));
  return (
    <div>
      <p className="text-sm font-medium text-[#4A5585]">Selected desk</p>
      <h3 className="font-display mt-2 text-xl font-semibold text-[#101D4B]">{copy.title}</h3>
      <p className="mt-1 text-sm text-[#4A5585]">{stateLabel(state)}</p>
      <GuestRateBadges resourceId={selected.resourceId} />
      {copy.seat ? <AmenityIcons amenities={copy.seat.amenities} /> : null}
      {SEAT_TIERS[selected.tierId].memberOverageHourlyCents == null && selected.tierId === "equipped" ? (
        <p className="mt-2 text-xs leading-5 text-[#4A5585]">
          Member overage for Equipped desks is not set yet, so no member premium is shown.
        </p>
      ) : null}
      {summary ? <div className="mt-5 border-t border-slate-200 pt-4">{summary}</div> : null}
    </div>
  );
}
