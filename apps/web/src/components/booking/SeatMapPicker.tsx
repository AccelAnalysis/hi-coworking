"use client";

import { useId, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import {
  ARCHITECTURAL_PRIVATE_OFFICE,
  PRIVATE_OFFICE_RESOURCE_ID,
  SEAT_MAP_VIEWBOX,
  SEAT_TIERS,
  formatUsdCents,
  accessibleSeatName,
  isPrivateOfficeResource,
  seatMapPercentToPoint,
  visibleGuestRates,
  type SeatMapSpot,
} from "@hi/shared";
import { AmenityIcons, GuestRateBadges, catalogCopy } from "@/components/booking/DeskOptionList";
import { ArchitecturalFloorPlan, type PlanOfficeState, type PlanSeatState } from "@/components/booking/ArchitecturalFloorPlan";
import { SEAT_HIT_TARGET_CSS, SEAT_MAP_MIN_WIDTH_PX } from "@/lib/seatMapGeometry";

export type SeatAvailability = {
  resourceId: string;
  name: string;
  available: boolean;
};

type SeatVisualState = PlanSeatState;

function seatState(spot: SeatMapSpot, selectedResourceId?: string, available?: boolean): SeatVisualState {
  if (spot.staffOnly || !spot.bookable) return "staff";
  if (selectedResourceId === spot.resourceId) return "selected";
  if (available) return "available";
  return "unavailable";
}

function stateLabel(state: SeatVisualState) {
  if (state === "staff") return "Staff only, not bookable";
  if (state === "selected") return "Selected";
  if (state === "available") return "Available";
  return "Unavailable";
}

/** Visible badge styles for the published-background path (HTML badges over an uploaded image). */
const IMAGE_BADGE_CLASS: Record<SeatVisualState, string> = {
  available: "bg-white text-[#101D4B] border-[#101D4B]",
  selected: "bg-[#101D4B] text-white border-[#101D4B]",
  unavailable: "bg-slate-100 text-slate-500 border-slate-300",
  staff: "bg-slate-100 text-slate-600 border-slate-500 border-dashed",
};

const NAVY_FOCUS =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#101D4B]";

export function SeatMapPicker({
  spots,
  backgroundUrl,
  availability,
  selectedResourceId,
  loadingQuote,
  summary,
  list,
  onSelectSeat,
  officeOffered: officeOfferedHint = false,
}: {
  spots: SeatMapSpot[];
  backgroundUrl?: string;
  availability: SeatAvailability[];
  selectedResourceId?: string;
  loadingQuote?: boolean;
  summary?: ReactNode;
  list: ReactNode;
  onSelectSeat: (resourceId: string) => void;
  officeOffered?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const tabMapId = useId();
  const tabListId = useId();
  const panelMapId = useId();
  const panelListId = useId();
  const [view, setView] = useState<"map" | "list">("map");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const availableIds = new Set(
    availability.filter((item) => item.available).map((item) => item.resourceId),
  );
  const officeInAvailability = availability.some((item) => item.resourceId === PRIVATE_OFFICE_RESOURCE_ID);
  const officeOffered = officeInAvailability || (availability.length === 0 && officeOfferedHint);
  const officeState: PlanOfficeState = !officeOffered
    ? "unoffered"
    : selectedResourceId === PRIVATE_OFFICE_RESOURCE_ID
      ? "selected"
      : availableIds.has(PRIVATE_OFFICE_RESOURCE_ID)
        ? "available"
        : "unavailable";
  const seats = spots.map((spot) => {
    const point = seatMapPercentToPoint(spot);
    return {
      spot,
      state: seatState(spot, selectedResourceId, availableIds.has(spot.resourceId)),
      x: point.x,
      y: point.y,
    };
  });

  return (
    <div className="text-[#101D4B]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <h2 className="font-display text-xl font-semibold text-[#101D4B] sm:text-2xl">{officeOffered ? "3. Choose a desk or the private office" : "3. Choose a desk"}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {officeOffered
              ? "Pick a desk or the right-hand private office for the full stay. Booking the office leaves D1 unsold; D2–D6 stay available. Up to 4 hours never costs more than the half-day price, and longer stays never more than the day price."
              : "Pick a desk for the full stay. Up to 4 hours never costs more than the half-day price, and longer stays never more than the day price."}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Space picker view"
          className="inline-flex items-center self-start rounded-full border border-slate-200 bg-slate-100 p-1"
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
          {(["map", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              id={mode === "map" ? tabMapId : tabListId}
              aria-controls={mode === "map" ? panelMapId : panelListId}
              aria-selected={view === mode}
              tabIndex={view === mode ? 0 : -1}
              onClick={() => setView(mode)}
              className={`min-h-11 min-w-16 rounded-full px-5 text-sm font-semibold transition-colors ${NAVY_FOCUS} ${
                view === mode ? "bg-[#101D4B] text-white shadow-xs" : "text-slate-600 hover:text-[#101D4B]"
              }`}
            >
              {mode === "map" ? "Map" : "List"}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-5 mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-600" aria-label="Map legend">
        <li className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-[#101D4B] bg-white" aria-hidden="true" />
          Available
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-full bg-[#101D4B]" aria-hidden="true" />
          Selected
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-slate-300 bg-slate-100" aria-hidden="true" />
          Unavailable
        </li>
        <li className="flex items-center gap-1.5">
          <Settings className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
          Staff only
        </li>
      </ul>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <div hidden={view !== "map"} id={panelMapId} role="tabpanel" aria-labelledby={tabMapId}>
            <div className="w-full overflow-x-auto overflow-y-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-5">
              <div className="relative" style={{ minWidth: SEAT_MAP_MIN_WIDTH_PX }} data-seat-map-canvas>
                {backgroundUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={backgroundUrl} alt="Hi Coworking floor plan" className="block h-auto w-full select-none" />
                ) : (
                  <ArchitecturalFloorPlan
                    titleId={titleId}
                    descId={descId}
                    highlightedId={hoveredId ?? focusedId}
                    officeState={officeState}
                    seats={seats.map(({ spot, state, x, y }) => ({
                      resourceId: spot.resourceId,
                      displayId: spot.displayId,
                      x,
                      y,
                      state,
                    }))}
                  />
                )}
                {officeOffered ? (
                  <PrivateOfficeHitTarget
                    state={officeState === "unoffered" ? "unavailable" : officeState}
                    available={availableIds.has(PRIVATE_OFFICE_RESOURCE_ID)}
                    selected={selectedResourceId === PRIVATE_OFFICE_RESOURCE_ID}
                    loadingQuote={loadingQuote}
                    blockedReason={officeBlockReason(availability)}
                    onSelect={() => onSelectSeat(PRIVATE_OFFICE_RESOURCE_ID)}
                    onHover={setHoveredId}
                    onFocus={setFocusedId}
                  />
                ) : null}
                {seats.map(({ spot, state }) => {
                  const selectable = state === "available" && !loadingQuote;
                  const rates = visibleGuestRates(spot.resourceId);
                  const rateHint = state === "staff" ? "" : rates.day ? `${rates.day} day` : rates.halfDay ? `${rates.halfDay} half day` : "";
                  const label = `${accessibleSeatName(spot.resourceId)}, ${stateLabel(state)}${rateHint ? `, ${rateHint}` : ""}`;
                  return (
                    <button
                      key={spot.resourceId}
                      type="button"
                      disabled={!selectable}
                      aria-pressed={state === "selected"}
                      aria-label={label}
                      onClick={() => onSelectSeat(spot.resourceId)}
                      onPointerEnter={() => setHoveredId(spot.resourceId)}
                      onPointerLeave={() => setHoveredId((current) => (current === spot.resourceId ? null : current))}
                      onFocus={() => setFocusedId(spot.resourceId)}
                      onBlur={() => setFocusedId((current) => (current === spot.resourceId ? null : current))}
                      data-resource={spot.resourceId}
                      data-seat-hit-target
                      style={{
                        left: `${spot.cx}%`,
                        top: `${spot.cy}%`,
                        width: SEAT_HIT_TARGET_CSS,
                        minWidth: 44,
                        minHeight: 44,
                      }}
                      className={`absolute z-10 flex aspect-square min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full bg-transparent ${NAVY_FOCUS} ${
                        selectable ? "cursor-pointer" : "cursor-not-allowed"
                      }`}
                    >
                      {backgroundUrl ? (
                        <span
                          aria-hidden="true"
                          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${IMAGE_BADGE_CLASS[state]}`}
                        >
                          {spot.displayId}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-600 sm:hidden">
              Swipe the plan sideways to see the lounge and the bookable private office.
            </p>
          </div>

          <div hidden={view !== "list"} id={panelListId} role="tabpanel" aria-labelledby={tabListId}>
            {list}
          </div>
        </div>

        <aside
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs lg:sticky lg:top-6 lg:col-span-4"
          aria-label="Selected space"
        >
          <SeatSummary
            spots={spots}
            selectedResourceId={selectedResourceId}
            availableIds={availableIds}
            officeOffered={officeOffered}
            summary={summary}
          />
        </aside>
      </div>
    </div>
  );
}

function SeatSummary({
  spots,
  selectedResourceId,
  availableIds,
  officeOffered,
  summary,
}: {
  spots: SeatMapSpot[];
  selectedResourceId?: string;
  availableIds: Set<string>;
  officeOffered: boolean;
  summary?: ReactNode;
}) {
  const selected = spots.find((spot) => spot.resourceId === selectedResourceId);
  if (selectedResourceId && isPrivateOfficeResource(selectedResourceId)) {
    const available = availableIds.has(PRIVATE_OFFICE_RESOURCE_ID);
    const rates = visibleGuestRates(PRIVATE_OFFICE_RESOURCE_ID);
    return (
      <div>
        <div aria-live="polite">
          <p className="text-xs font-medium text-slate-500">Selected room</p>
          <h3 className="font-display mt-1 text-xl font-semibold text-[#101D4B]">Private Office</h3>
        </div>
        <p className="mt-1 text-sm text-slate-600">Right-hand room for signings, notary, and closed-door work.</p>
        <p className="mt-3 text-xs font-semibold text-slate-800">{available ? "Available" : "Unavailable"}</p>
        <p className="mt-1 text-sm text-[#4A5585]">{[rates.halfDay ? `${rates.halfDay} half day` : null, rates.day ? `${rates.day} day` : null, rates.hourly ? `${rates.hourly}/hr` : null].filter(Boolean).join(" · ")}</p>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Weekday full days are offered. This room does not use membership desk hours. Booking it leaves D1 unsold; D2–D6 stay available.
        </p>
        {summary ? <div className="mt-5 border-t border-slate-100 pt-5">{summary}</div> : null}
      </div>
    );
  }
  if (!selected) {
    const availableCount = spots.filter((spot) => spot.bookable && availableIds.has(spot.resourceId)).length;
    return (
      <div aria-live="polite">
        <p className="text-xs font-medium text-slate-500">Selected space</p>
        <h3 className="font-display mt-1 text-xl font-semibold text-[#101D4B]">{officeOffered ? "Choose a desk or the private office" : "Choose a desk"}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {availableCount} available desk{availableCount === 1 ? "" : "s"} for this time. D7 is the reception desk and stays staff-only.{officeOffered ? " The private office is booked on its own and leaves D1 unsold." : ""}
        </p>
      </div>
    );
  }

  const copy = catalogCopy(selected.resourceId, selected.name);
  const state = seatState(selected, selectedResourceId, availableIds.has(selected.resourceId));
  const tier = SEAT_TIERS[selected.tierId];
  return (
    <div>
      <div aria-live="polite">
        <p className="text-xs font-medium text-slate-500">Selected desk</p>
        <h3 className="font-display mt-1 text-xl font-semibold text-[#101D4B]">{copy.title}</h3>
      </div>
      {tier.shortLabel !== tier.name ? <p className="mt-1 text-sm text-slate-600">{tier.shortLabel}</p> : null}
      <p className="mt-3 text-xs font-semibold text-slate-800">{stateLabel(state)}</p>
      <GuestRateBadges resourceId={selected.resourceId} />
      {copy.seat ? <AmenityIcons amenities={copy.seat.amenities} /> : null}
      <p className="mt-4 text-xs leading-5 text-slate-500" data-testid="seat-membership-coverage">
        {selected.tierId === "equipped"
          ? `Included in Coworking Plus hours. Coworking Member pays ${formatUsdCents(tier.memberOverageHourlyCents)}/hr here.`
          : "Included in Coworking Member and Coworking Plus hours."}
      </p>
      {summary ? <div className="mt-5 border-t border-slate-100 pt-5">{summary}</div> : null}
    </div>
  );
}

function officeBlockReason(availability: SeatAvailability[]) {
  const office = availability.find((item) => item.resourceId === PRIVATE_OFFICE_RESOURCE_ID);
  if (!office || office.available) return null;
  const desk1 = availability.find((item) => item.resourceId === "seat-1");
  const conference = availability.find((item) => item.resourceId === "mode-conference");
  if (conference && !conference.available) return "Unavailable because the conference room is in use.";
  if (desk1 && !desk1.available) return "Unavailable because D1 is booked for this time.";
  return "Unavailable for this time.";
}

function privateOfficeBoxPercent() {
  const { x, y, width, height } = ARCHITECTURAL_PRIVATE_OFFICE;
  return {
    left: ((x - SEAT_MAP_VIEWBOX.x) / SEAT_MAP_VIEWBOX.width) * 100,
    top: ((y - SEAT_MAP_VIEWBOX.y) / SEAT_MAP_VIEWBOX.height) * 100,
    width: (width / SEAT_MAP_VIEWBOX.width) * 100,
    height: (height / SEAT_MAP_VIEWBOX.height) * 100,
  };
}

function PrivateOfficeHitTarget({
  state,
  available,
  selected,
  loadingQuote,
  blockedReason,
  onSelect,
  onHover,
  onFocus,
}: {
  state: SeatVisualState;
  available: boolean;
  selected: boolean;
  loadingQuote?: boolean;
  blockedReason: string | null;
  onSelect: () => void;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
}) {
  const box = privateOfficeBoxPercent();
  const selectable = available && !loadingQuote && state !== "staff";
  const rates = visibleGuestRates(PRIVATE_OFFICE_RESOURCE_ID);
  const label = [
    "Private Office",
    stateLabel(state),
    rates.hourly && rates.halfDay && rates.day ? `${rates.hourly}/hr, ${rates.halfDay} half day, ${rates.day} day` : "",
    !available && blockedReason ? blockedReason : "",
  ].filter(Boolean).join(", ");
  return (
    <button
      type="button"
      disabled={!selectable}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
      onPointerEnter={() => onHover(PRIVATE_OFFICE_RESOURCE_ID)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onFocus(PRIVATE_OFFICE_RESOURCE_ID)}
      onBlur={() => onFocus(null)}
      data-resource={PRIVATE_OFFICE_RESOURCE_ID}
      data-office-hit-target
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      }}
      className={`absolute z-10 min-h-11 min-w-11 touch-manipulation rounded-xl bg-transparent ${NAVY_FOCUS} ${
        selectable ? "cursor-pointer" : "cursor-not-allowed"
      }`}
    />
  );
}
