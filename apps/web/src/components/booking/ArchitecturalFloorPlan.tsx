import { Settings } from "lucide-react";
import { SEAT_MAP_VIEWBOX, type SeatDisplayId } from "@hi/shared";
import { SEAT_BADGE_RADIUS, SEAT_HALO_RADIUS } from "@/lib/seatMapGeometry";

/**
 * Built-in architectural plan of the Carrollton space (42' x 25'), ported
 * from Jonathan's reference picker (21 Nov 2026) and checked against the
 * numbered D1–D7 plan. Where the two disagree the numbered plan wins: two
 * window units on the main-room south wall, the storefront door swinging out
 * into the recessed porch, and the lounge set slightly lower along the
 * dividing wall. The lounge stays a room only. The private office is a
 * bookable room; its hit target is layered on top by SeatMapPicker.
 *
 * Seat badges are drawn here so they scale with the plan. The interactive
 * hit areas are HTML buttons layered on top by SeatMapPicker.
 */

export type PlanSeatState = "available" | "unavailable" | "selected" | "staff";
export type PlanOfficeState = PlanSeatState | "unoffered";

export type PlanSeat = {
  resourceId: string;
  displayId: SeatDisplayId;
  x: number;
  y: number;
  state: PlanSeatState;
};

const NAVY = "#101D4B";
const LINE = "#475569";
const WALL = "#1E293B";
const SOFT = "#94A3B8";
const VIEWBOX = `${SEAT_MAP_VIEWBOX.x} ${SEAT_MAP_VIEWBOX.y} ${SEAT_MAP_VIEWBOX.width} ${SEAT_MAP_VIEWBOX.height}`;

/** Top-down office chair. */
export function ArchitecturalChair({
  x,
  y,
  angle = 0,
  dashed = false,
}: {
  x: number;
  y: number;
  angle?: number;
  dashed?: boolean;
}) {
  const dash = dashed ? "3 2" : undefined;
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angle})`}>
      <rect x="-11" y="-11" width="22" height="20" rx="4" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" strokeDasharray={dash} />
      <path d="M -11 8 Q 0 14 11 8" fill="none" stroke={LINE} strokeWidth="2.2" strokeLinecap="round" strokeDasharray={dash} />
      <line x1="-13" y1="-5" x2="-13" y2="5" stroke={LINE} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="-5" x2="13" y2="5" stroke={LINE} strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

function DoorSwing({ leaf, arc, width = 2 }: { leaf: [number, number, number, number]; arc: string; width?: number }) {
  return (
    <g>
      <line x1={leaf[0]} y1={leaf[1]} x2={leaf[2]} y2={leaf[3]} stroke={WALL} strokeWidth={width} />
      <path d={arc} fill="none" stroke={SOFT} strokeWidth="1.2" strokeDasharray="3 2" />
    </g>
  );
}

function SeatBadge({ seat, highlighted }: { seat: PlanSeat; highlighted: boolean }) {
  const { state } = seat;
  let fill = "#FFFFFF";
  let stroke = NAVY;
  let text = NAVY;
  let strokeWidth = 2;
  let dash: string | undefined;
  if (state === "selected") {
    fill = NAVY;
    text = "#FFFFFF";
  } else if (state === "unavailable") {
    fill = "#F1F5F9";
    stroke = "#CBD5E1";
    text = "#64748B";
    strokeWidth = 1.75;
  } else if (state === "staff") {
    fill = "#F1F5F9";
    stroke = "#64748B";
    text = LINE;
    strokeWidth = 1.75;
    dash = "3 2";
  }
  const showHalo = state === "selected" || (highlighted && state === "available");
  return (
    <g transform={`translate(${seat.x}, ${seat.y})`} data-seat-badge={seat.displayId} data-state={state}>
      {showHalo ? (
        <circle r={SEAT_HALO_RADIUS} fill={state === "selected" ? NAVY : "#334155"} fillOpacity={state === "selected" ? 0.14 : 0.08} />
      ) : null}
      <circle r={SEAT_BADGE_RADIUS} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} />
      <text x="0" y="4" textAnchor="middle" fill={text} fontSize="11.5" fontWeight="700">
        {seat.displayId}
      </text>
      {state === "staff" ? (
        <g transform="translate(13, -14)">
          <circle r="8" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.2" />
          <Settings x={-5.5} y={-5.5} width={11} height={11} color={LINE} strokeWidth={2.4} aria-hidden="true" />
        </g>
      ) : null}
    </g>
  );
}

export function ArchitecturalFloorPlan({
  titleId,
  descId,
  seats,
  highlightedId,
  officeState,
}: {
  titleId: string;
  descId: string;
  seats: PlanSeat[];
  highlightedId?: string | null;
  officeState?: PlanOfficeState;
}) {
  return (
    <svg
      viewBox={VIEWBOX}
      className="block h-auto w-full select-none"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      data-seat-map-plan="architectural"
    >
      <title id={titleId}>Hi Coworking floor plan</title>
      <desc id={descId}>
        Main room with desks D1 to D7. D1 and D2 sit at the ends of the conference table, D3 to D6 are window desks along
        the south wall, and D7 is the staff-only reception desk by the west door. The lounge is on the right. The private office is the
        bookable right-hand room; booking it leaves D1 unsold. Use the seat and room buttons or the List view to choose a space.
      </desc>
      <defs>
        <pattern id="hic-wall-hatch" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke={SOFT} strokeWidth="1.2" />
        </pattern>
      </defs>

      {/* 1. Floor zones */}
      <rect x="10" y="10" width="510" height="480" fill="#F8FAFC" />
      <polygon points="528,10 830,10 830,410 670,410 670,490 528,490" fill="#F8FAFC" />
      <rect x="168" y="10" width="352" height="128" fill="#F1F5F9" />
      {/* Recessed exterior entry porch (outside the building line) */}
      <rect x="678" y="418" width="160" height="80" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />
      <rect x="822" y="482" width="14" height="14" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.2" />
      <circle cx="829" cy="489" r="3" fill="none" stroke="#64748B" strokeWidth="1" />

      {/* 2. Doors and swing arcs */}
      {/* West exterior door, swings out */}
      <DoorSwing leaf={[0, 215, -58, 215]} arc="M -58 215 A 58 58 0 0 0 0 273" />
      {/* North exterior door into the right room, swings out */}
      <DoorSwing leaf={[725, 0, 725, -56]} arc="M 725 -56 A 56 56 0 0 1 781 0" />
      {/* Storefront door, swings out into the porch (per the numbered plan) */}
      <DoorSwing leaf={[784, 420, 784, 476]} arc="M 728 420 A 56 56 0 0 0 784 476" />
      {/* Connecting door through the dividing wall */}
      <DoorSwing leaf={[528, 165, 586, 165]} arc="M 586 165 A 58 58 0 0 1 528 223" />
      {/* Accessible restroom door */}
      <DoorSwing leaf={[168, 134, 210, 96]} arc="M 168 78 A 56 56 0 0 1 224 134" width={1.8} />
      {/* Second restroom door */}
      <DoorSwing leaf={[520, 130, 466, 130]} arc="M 466 130 A 54 54 0 0 1 520 76" width={1.8} />

      {/* 3. Exterior walls (hatched) */}
      <g fill="url(#hic-wall-hatch)" stroke={WALL} strokeWidth="1.8">
        <rect x="0" y="0" width="725" height="10" />
        <rect x="783" y="0" width="57" height="10" />
        <rect x="0" y="10" width="10" height="205" />
        <rect x="0" y="275" width="10" height="225" />
        <rect x="10" y="490" width="668" height="10" />
        <rect x="668" y="410" width="10" height="80" />
        <rect x="678" y="410" width="48" height="10" />
        <rect x="784" y="410" width="56" height="10" />
        <rect x="830" y="10" width="10" height="400" />
      </g>

      {/* Interior partitions */}
      <g fill="#E2E8F0" stroke={WALL} strokeWidth="1.6">
        <rect x="165" y="10" width="6" height="68" />
        <rect x="342" y="10" width="10" height="128" />
        <rect x="520" y="10" width="8" height="66" />
        <rect x="520" y="130" width="8" height="35" />
        <rect x="165" y="134" width="355" height="6" />
        <rect x="520" y="225" width="8" height="265" />
      </g>

      {/* 4. Windows: two on the main-room south wall (numbered plan), one in the
          private office south wall, one on the east wall */}
      {[
        { x: 86, w: 66 },
        { x: 326, w: 64 },
        { x: 565, w: 68 },
      ].map((win) => (
        <g key={win.x}>
          <rect x={win.x} y={488} width={win.w} height={15} fill="#FFFFFF" stroke={WALL} strokeWidth="1.4" />
          <line x1={win.x} y1={495} x2={win.x + win.w} y2={495} stroke="#64748B" strokeWidth="1.2" />
        </g>
      ))}
      <g>
        <rect x="828" y="265" width="15" height="74" fill="#FFFFFF" stroke={WALL} strokeWidth="1.4" />
        <line x1="835" y1="265" x2="835" y2="339" stroke="#64748B" strokeWidth="1.2" />
      </g>

      {/* 5. Kitchenette and restroom fixtures */}
      <g>
        <rect x="16" y="16" width="42" height="42" rx="2" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" />
        <rect x="18" y="58" width="38" height="3" fill="#CBD5E1" stroke={LINE} strokeWidth="1" />
      </g>
      <g>
        <rect x="62" y="15" width="54" height="43" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" />
        <rect x="72" y="21" width="34" height="28" rx="5" fill="#F8FAFC" stroke={LINE} strokeWidth="1.2" />
        <circle cx="89" cy="35" r="3" fill="none" stroke={LINE} strokeWidth="1" />
        <line x1="89" y1="18" x2="89" y2="27" stroke={LINE} strokeWidth="1.5" />
      </g>
      <g>
        <rect x="120" y="15" width="38" height="36" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <circle cx="139" cy="33" r="10" fill="none" stroke={LINE} strokeWidth="1.2" />
        <circle cx="139" cy="33" r="3" fill={LINE} />
        <path d="M 124 56 L 139 66 L 154 56" fill="none" stroke={LINE} strokeWidth="1.2" />
      </g>
      <g>
        <rect x="15" y="174" width="28" height="32" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.2" />
        <rect x="43" y="186" width="3" height="8" fill="#64748B" />
      </g>
      {/* Accessible restroom 5' turning circle */}
      <circle cx="230" cy="74" r="48" fill="none" stroke={SOFT} strokeWidth="1.1" strokeDasharray="4 3" />
      <g>
        <rect x="332" y="29" width="8" height="26" rx="1" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <ellipse cx="318" cy="42" rx="14" ry="10" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <rect x="314" y="88" width="26" height="32" rx="4" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <rect x="318" y="93" width="16" height="22" rx="3" fill="#F8FAFC" stroke={LINE} strokeWidth="1" />
      </g>
      <g>
        <rect x="354" y="29" width="8" height="26" rx="1" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <ellipse cx="376" cy="42" rx="14" ry="10" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <rect x="354" y="88" width="26" height="32" rx="4" fill="#FFFFFF" stroke={LINE} strokeWidth="1.2" />
        <rect x="360" y="93" width="16" height="22" rx="3" fill="#F8FAFC" stroke={LINE} strokeWidth="1" />
      </g>

      {/* 6. Main room furniture */}
      {/* Wall TV above the conference table */}
      <g>
        <rect x="188" y="145" width="160" height="5" rx="1" fill="#334155" />
        <line x1="215" y1="152" x2="321" y2="152" stroke={SOFT} strokeWidth="1" />
      </g>
      {/* Conference table with its two head chairs (D1, D2) */}
      <g>
        <ArchitecturalChair x={165} y={189} angle={90} />
        <ArchitecturalChair x={371} y={189} angle={-90} />
        <rect x="178" y="160" width="180" height="58" rx="10" fill="#FFFFFF" stroke="#334155" strokeWidth="1.5" />
        <text x="268" y="193" textAnchor="middle" fill={LINE} fontSize="10.5" fontWeight="700" letterSpacing="0.06em">
          CONF TABLE
        </text>
      </g>
      {/* Reception 7-shaped corner desk (D7) */}
      <g>
        <ArchitecturalChair x={44} y={356} angle={-90} />
        <polygon points="16,288 110,288 110,418 74,418 74,324 16,324" fill="#FFFFFF" stroke="#334155" strokeWidth="1.4" />
      </g>
      {/* Window desks D3–D6 with chairs */}
      {[158, 250, 342, 434].map((deskX) => (
        <g key={deskX}>
          <ArchitecturalChair x={deskX + 41} y={422} angle={180} dashed />
          <rect x={deskX} y="428" width="82" height="54" rx="6" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" strokeDasharray="4 3" />
        </g>
      ))}
      {/* Acoustic dividers between D3–D6 */}
      {[245, 337, 429].map((divX) => (
        <g key={divX}>
          <line x1={divX - 1.5} y1="354" x2={divX - 1.5} y2="484" stroke={SOFT} strokeWidth="1.2" strokeDasharray="4 3" />
          <line x1={divX + 1.5} y1="354" x2={divX + 1.5} y2="484" stroke={SOFT} strokeWidth="1.2" strokeDasharray="4 3" />
        </g>
      ))}
      {/* Print station against the dividing wall */}
      <g>
        <rect x="456" y="246" width="56" height="56" rx="8" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.3" strokeDasharray="4 2" />
        <rect x="466" y="256" width="36" height="36" rx="3" fill="#F8FAFC" stroke="#64748B" strokeWidth="1.1" />
        <text x="484" y="277" textAnchor="middle" fill="#64748B" fontSize="8" fontWeight="600">
          PRINT
        </text>
      </g>

      {/* 7. Right room: lounge and private office (not bookable) */}
      <g>
        <rect x="542" y="15" width="82" height="22" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" />
        <line x1="542" y1="33" x2="624" y2="33" stroke={SOFT} strokeWidth="1" />
      </g>
      <g>
        <rect x="642" y="15" width="74" height="5" rx="1" fill="#334155" />
        <line x1="652" y1="22" x2="706" y2="22" stroke={SOFT} strokeWidth="1" />
      </g>
      {/* Lounge: sofa and two end tables, just right of the dividing wall */}
      <g data-plan-zone="lounge">
        <rect x="538" y="270" width="34" height="34" rx="2" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" />
        <rect x="538" y="312" width="52" height="112" rx="3" fill="#FFFFFF" stroke={LINE} strokeWidth="1.4" />
        <line x1="548" y1="312" x2="548" y2="424" stroke={LINE} strokeWidth="1.2" />
        <line x1="548" y1="368" x2="590" y2="368" stroke={LINE} strokeWidth="1.2" />
        <rect x="538" y="432" width="34" height="34" rx="2" fill="#FFFFFF" stroke={LINE} strokeWidth="1.3" />
        <rect x="530" y="358" width="68" height="20" rx="10" fill={NAVY} />
        <text x="564" y="371" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="700" letterSpacing="0.06em">
          LOUNGE
        </text>
      </g>
      {/* Private office L-desk */}
      <g data-plan-zone="private-office" data-state={officeState || "available"}>
        {officeState === "selected" || (officeState !== "unoffered" && highlightedId === "private-office") ? (
          <rect x="628" y="36" width="198" height="368" rx="10" fill={officeState === "selected" ? NAVY : "#334155"} fillOpacity={officeState === "selected" ? 0.10 : 0.06} />
        ) : null}
        {officeState === "unavailable" ? (
          <rect x="628" y="36" width="198" height="368" rx="10" fill="#F1F5F9" fillOpacity="0.85" />
        ) : null}
        <ArchitecturalChair x={755} y={215} angle={90} />
        <polygon points="668,152 712,152 712,272 814,272 814,316 668,316" fill={officeState === "selected" ? "#EEF0F6" : "#FFFFFF"} stroke={officeState === "unavailable" || officeState === "unoffered" ? "#CBD5E1" : "#334155"} strokeWidth="1.5" />
        <text x="741" y="298" textAnchor="middle" fill={officeState === "unavailable" || officeState === "unoffered" ? "#64748B" : LINE} fontSize="9.5" fontWeight="700" letterSpacing="0.05em">
          PRIVATE OFFICE
        </text>
        {officeState === "unoffered" ? null : (
          <text x="741" y="338" textAnchor="middle" fill={officeState === "selected" ? NAVY : officeState === "unavailable" ? "#94A3B8" : "#64748B"} fontSize="9" fontWeight="600">
            {officeState === "selected" ? "Selected" : officeState === "unavailable" ? "Unavailable" : "$39/hr · $99 half-day · $149 day"}
          </text>
        )}
      </g>

      {/* 8. Seat badges (visual only; hit areas are the buttons layered on top) */}
      <g aria-hidden="true">
        {seats.map((seat) => (
          <SeatBadge key={seat.resourceId} seat={seat} highlighted={highlightedId === seat.resourceId} />
        ))}
      </g>
    </svg>
  );
}
