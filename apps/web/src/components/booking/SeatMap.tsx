"use client";

import type { FloorSeat, FloorShape } from "@hi/shared";

export type SeatVisualStatus = "idle" | "open" | "taken" | "selected" | "combo";

const STATUS_CLASS: Record<SeatVisualStatus, string> = {
  idle: "border-slate-300 bg-white text-slate-900 hover:border-slate-900",
  open: "border-emerald-600 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
  taken: "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400",
  selected: "border-slate-950 bg-slate-950 text-white",
  combo: "border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100",
};

export function SeatMap({
  canvasWidth,
  canvasHeight,
  shell,
  seats,
  status,
  comboMarks,
  onToggle,
}: {
  canvasWidth: number;
  canvasHeight: number;
  shell: FloorShape[];
  seats: FloorSeat[];
  status: Record<string, SeatVisualStatus>;
  comboMarks?: Record<string, string>;
  onToggle: (resourceId: string) => void;
}) {
  const boxes = [...shell, ...seats];
  const minX = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;
  const maxX = boxes.length ? Math.max(...boxes.map((box) => box.x + box.width)) : canvasWidth;
  const maxY = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) : canvasHeight;
  const pad = 28;
  const viewX = Math.max(0, minX - pad);
  let viewY = Math.max(0, minY - pad);
  const viewWidth = Math.max(1, Math.min(canvasWidth, maxX + pad) - viewX);
  let viewHeight = Math.max(1, Math.min(canvasHeight, maxY + pad) - viewY);
  const minViewRatio = 0.72;
  if (viewHeight / viewWidth < minViewRatio) {
    const needed = viewWidth * minViewRatio;
    const extra = needed - viewHeight;
    viewY = Math.max(0, viewY - extra / 2);
    viewHeight = Math.min(canvasHeight - viewY, needed);
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">Floor plan</p>
        <p className="text-xs text-slate-500">Tap a seat</p>
      </div>
      <div className="p-3 sm:p-4">
        <div
          className="relative mx-auto w-full max-w-3xl"
          style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}
        >
          <svg
            viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <rect x="0" y="0" width={canvasWidth} height={canvasHeight} fill="#f8fafc" />
            {shell.map((shape) => (
              <g key={shape.id}>
                <rect
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  rx={shape.type === "WALL" ? 2 : 8}
                  fill={shape.fill || (shape.type === "DOOR" ? "#818cf8" : "#cbd5e1")}
                />
                {shape.label ? (
                  <text
                    x={shape.x + shape.width / 2}
                    y={shape.y + shape.height / 2 + 4}
                    textAnchor="middle"
                    fontSize="14"
                    fill="#334155"
                  >
                    {shape.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          {seats.map((seat) => {
            const visual = status[seat.resourceId] || "idle";
            const taken = visual === "taken";
            return (
              <button
                key={seat.resourceId}
                type="button"
                disabled={taken}
                aria-pressed={visual === "selected"}
                onClick={() => onToggle(seat.resourceId)}
                className={`absolute flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 px-1 text-center shadow-sm transition ${STATUS_CLASS[visual]}`}
                style={{
                  left: `${((seat.x + seat.width / 2 - viewX) / viewWidth) * 100}%`,
                  top: `${((seat.y + seat.height / 2 - viewY) / viewHeight) * 100}%`,
                  width: `max(44px, ${(seat.width / viewWidth) * 100}%)`,
                  height: `max(44px, ${(seat.height / viewHeight) * 100}%)`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <span className="block max-w-full">
                  {comboMarks?.[seat.resourceId] ? (
                    <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide">
                      {comboMarks[seat.resourceId]}
                    </span>
                  ) : null}
                  <span className="block truncate text-xs font-semibold leading-tight sm:text-sm">
                    {seat.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
