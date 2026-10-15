"use client";

/**
 * Official Accel Analysis wordmark PNG, shown without recolor, invert, or redraw.
 * The file has transparent padding; the frame clips that padding in CSS only.
 */
const SOURCE_W = 1448;
const SOURCE_H = 1086;
const CONTENT = { x: 74, y: 338, w: 1330, h: 379 };

export function AccelWordmark({
  height = 44,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  const displayHeight = height * (SOURCE_H / CONTENT.h);
  const displayWidth = displayHeight * (SOURCE_W / SOURCE_H);
  return (
    <span
      className={`inline-block overflow-hidden align-middle ${className}`}
      style={{ width: height * (CONTENT.w / CONTENT.h), height }}
    >
      <img
        src="/brand/accel-analysis-wordmark.png"
        alt="Accel Analysis"
        draggable={false}
        style={{
          height: displayHeight,
          width: displayWidth,
          maxWidth: "none",
          marginTop: -displayHeight * (CONTENT.y / SOURCE_H),
          marginLeft: -displayWidth * (CONTENT.x / SOURCE_W),
        }}
      />
    </span>
  );
}
