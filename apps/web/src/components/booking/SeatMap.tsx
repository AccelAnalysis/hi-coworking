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

function labelSize(shape: FloorShape) {
  if (!shape.label || shape.role === "conference-chair" || shape.type === "MODE_ZONE") return 0;
  const shortest = Math.min(shape.width, shape.height);
  if (shape.type === "ROOM") return Math.min(22, Math.max(14, shortest * 0.08));
  if (shape.type === "WALL") return 0;
  if (shortest < 36 && shape.width >= 80) return 11;
  if (shortest < 40) return 0;
  if (shortest < 80) return 12;
  return 14;
}

export function SeatMap({
  canvasWidth,
  canvasHeight,
  shell,
  furniture = [],
  seats,
  status,
  comboMarks,
  onToggle,
  interactive = true,
  heading = "Floor plan",
  hint = "Tap a desk",
}: {
  canvasWidth: number;
  canvasHeight: number;
  shell: FloorShape[];
  furniture?: FloorShape[];
  seats: FloorSeat[];
  status: Record<string, SeatVisualStatus>;
  comboMarks?: Record<string, string>;
  onToggle: (resourceId: string) => void;
  interactive?: boolean;
  heading?: string;
  hint?: string;
}) {
  const boxes = [...shell, ...furniture, ...seats];
  const minX = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;
  const maxX = boxes.length ? Math.max(...boxes.map((box) => box.x + box.width)) : canvasWidth;
  const maxY = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) : canvasHeight;
  const pad = 28;
  const viewX = Math.max(0, minX - pad);
  let viewY = Math.max(0, minY - pad);
  const viewWidth = Math.max(1, Math.min(canvasWidth, maxX + pad) - viewX);
  let viewHeight = Math.max(1, Math.min(canvasHeight, maxY + pad) - viewY);
  const minViewRatio = 0.62;
  if (viewHeight / viewWidth < minViewRatio) {
    const needed = viewWidth * minViewRatio;
    const extra = needed - viewHeight;
    viewY = Math.max(0, viewY - extra / 2);
    viewHeight = Math.min(canvasHeight - viewY, needed);
  }

  const draw = [...shell, ...furniture];

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{heading}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <div className="p-3 sm:p-4">
        <div
          className="relative mx-auto w-full"
          style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}
        >
          <svg
            viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={heading}
          >
            <rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill="#f8fafc" />
            {draw.map((shape) => {
              const fontSize = labelSize(shape);
              const showLabel = fontSize > 0;
              const fill = shape.fill || (shape.type === "DOOR" ? "#818cf8" : shape.type === "WALL" ? "#334155" : "#e2e8f0");
              const textFill = /tv/i.test(shape.label || "") ? "#f8fafc" : "#1e293b";
              return (
                <g key={shape.id}>
                  {shape.shape === "ellipse" ? (
                    <ellipse
                      cx={shape.x + shape.width / 2}
                      cy={shape.y + shape.height / 2}
                      rx={shape.width / 2}
                      ry={shape.height / 2}
                      fill={fill}
                      stroke="#64748b"
                      strokeWidth={2}
                    />
                  ) : (
                    <rect
                      x={shape.x}
                      y={shape.y}
                      width={shape.width}
                      height={shape.height}
                      rx={shape.type === "WALL" || shape.type === "WINDOW" ? 2 : shape.role === "conference-chair" ? 8 : 10}
                      fill={fill}
                      stroke={shape.type === "ROOM" || shape.type === "WALL" ? "none" : "#64748b"}
                      strokeWidth={shape.type === "MODE_ZONE" ? 2 : 1}
                      strokeDasharray={shape.type === "MODE_ZONE" ? "8 6" : undefined}
                    />
                  )}
                  {showLabel ? (
                    <text
                      x={shape.x + shape.width / 2}
                      y={shape.y + shape.height / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={fontSize}
                      fontWeight={shape.type === "ROOM" ? 700 : 600}
                      fill={textFill}
                    >
                      {shape.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {seats.map((seat) => {
            const visual = status[seat.resourceId] || "idle";
            const taken = visual === "taken" || !interactive;
            return (
              <button
                key={seat.resourceId}
                type="button"
                disabled={taken}
                aria-pressed={visual === "selected"}
                onClick={() => onToggle(seat.resourceId)}
                className={`absolute flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 px-1 text-center shadow-sm transition ${
                  interactive ? STATUS_CLASS[visual] : "cursor-default border-slate-300 bg-white/90 text-slate-700"
                }`}
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
