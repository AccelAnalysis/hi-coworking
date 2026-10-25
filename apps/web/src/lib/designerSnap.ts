/**
 * Grid and snapping math for the Visual Designer. Pure functions only.
 *
 * Canvas units are pixels at zoom 1. By default 20 px = 1 ft, so the
 * 1 ft grid preset matches the old fixed 20 px grid.
 */

export const DEFAULT_PX_PER_FOOT = 20;

export type GridPreset = { id: string; label: string; feet: number };

export const GRID_PRESETS: GridPreset[] = [
  { id: "6in", label: "6 in", feet: 0.5 },
  { id: "1ft", label: "1 ft", feet: 1 },
  { id: "2ft", label: "2 ft", feet: 2 },
  { id: "5ft", label: "5 ft", feet: 5 },
];

export type SnapSettings = {
  showGrid: boolean;
  /** Grid cell size in feet. */
  gridFeet: number;
  /** Master switch. When off, nothing snaps. */
  snap: boolean;
  snapGrid: boolean;
  snapAngle: boolean;
  snapVertices: boolean;
  snapObjects: boolean;
};

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  showGrid: true,
  gridFeet: 1,
  snap: true,
  snapGrid: true,
  snapAngle: true,
  snapVertices: true,
  snapObjects: true,
};

export const SNAP_SETTINGS_STORAGE_KEY = "hi.designer.view.v1";
export const MIN_GRID_FEET = 0.25;
export const MAX_GRID_FEET = 50;

export function clampGridFeet(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SNAP_SETTINGS.gridFeet;
  return Math.min(MAX_GRID_FEET, Math.max(MIN_GRID_FEET, value));
}

/** Reads stored settings defensively; unknown or bad values fall back to defaults. */
export function parseSnapSettings(raw: string | null | undefined): SnapSettings {
  if (!raw) return { ...DEFAULT_SNAP_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof SnapSettings, unknown>>;
    const bool = (key: keyof SnapSettings) =>
      typeof parsed[key] === "boolean" ? (parsed[key] as boolean) : (DEFAULT_SNAP_SETTINGS[key] as boolean);
    return {
      showGrid: bool("showGrid"),
      gridFeet: clampGridFeet(typeof parsed.gridFeet === "number" ? parsed.gridFeet : DEFAULT_SNAP_SETTINGS.gridFeet),
      snap: bool("snap"),
      snapGrid: bool("snapGrid"),
      snapAngle: bool("snapAngle"),
      snapVertices: bool("snapVertices"),
      snapObjects: bool("snapObjects"),
    };
  } catch {
    return { ...DEFAULT_SNAP_SETTINGS };
  }
}

export type EffectiveSnap = { grid: boolean; angle: boolean; vertices: boolean; objects: boolean };

/** Holding Alt/Option bypasses every snap for that gesture. */
export function effectiveSnap(settings: SnapSettings, bypass = false): EffectiveSnap {
  const on = settings.snap && !bypass;
  return {
    grid: on && settings.snapGrid,
    angle: on && settings.snapAngle,
    vertices: on && settings.snapVertices,
    objects: on && settings.snapObjects,
  };
}

export function gridStepPx(settings: Pick<SnapSettings, "gridFeet">, pxPerFoot = DEFAULT_PX_PER_FOOT) {
  return clampGridFeet(settings.gridFeet) * pxPerFoot;
}

export function snapToStep(value: number, step: number) {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

export function normalizeAngle(deg: number) {
  const n = ((deg % 360) + 360) % 360;
  return n === 360 ? 0 : n;
}

/** Rotation snaps in 15° steps when snapping is on. */
export function snapRotation(deg: number, enabled: boolean, step = 15) {
  if (!enabled) return Math.round(deg * 10) / 10;
  return normalizeAngle(snapToStep(deg, step));
}

/**
 * Constrains `point` so the segment from `origin` runs at a multiple of
 * `stepDeg` (45° gives 0/45/90/...). Keeps the projected length.
 */
export function snapPointToAngle(
  origin: { x: number; y: number },
  point: { x: number; y: number },
  stepDeg = 45,
) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...point };
  const angle = Math.atan2(dy, dx);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(angle / step) * step;
  // Project onto the snapped direction so the cursor still controls length.
  const projected = dx * Math.cos(snapped) + dy * Math.sin(snapped);
  const x = origin.x + projected * Math.cos(snapped);
  const y = origin.y + projected * Math.sin(snapped);
  return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(y) < 1e-9 ? 0 : y };
}

export function feetLabel(px: number, pxPerFoot = DEFAULT_PX_PER_FOOT) {
  const feet = px / pxPerFoot;
  const totalInches = Math.round(feet * 12);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (inches === 0) return `${ft} ft`;
  if (ft === 0) return `${inches} in`;
  return `${ft} ft ${inches} in`;
}

/** Parses "40", "40 ft", "40'", "12' 6\"", "12 ft 6 in", "6 in" into feet. */
export function parseFeet(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const inches = text.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")$/);
  if (inches) return Number(inches[1]) / 12;
  const m = text.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"))?$/);
  if (m) {
    const first = Number(m[1]);
    return first + (m[2] ? Number(m[2]) / 12 : 0);
  }
  return null;
}

/** Parses "40 x 60", "40x60 ft", "40' × 60'" into [widthFeet, depthFeet]. */
export function parseDimensions(input: string): [number, number] | null {
  const parts = input.split(/\s*[x×by,]+\s*/i).filter(Boolean);
  if (parts.length !== 2) return null;
  const clean = (part: string) => part.replace(/\s*(ft|feet|')\s*$/i, "");
  const a = parseFeet(clean(parts[0]));
  const b = parseFeet(clean(parts[1]));
  if (a == null || b == null || a <= 0 || b <= 0) return null;
  return [a, b];
}

export type Box = { x: number; y: number; width: number; height: number };
export type SnapGuide = { orientation: "vertical" | "horizontal"; position: number };

/**
 * Snaps a moving box to other boxes' edges and centers. Returns the offset
 * to add and the guides to draw. Each axis snaps independently, to the
 * closest candidate within `threshold`.
 */
export function snapBoxToObjects(moving: Box, others: Box[], threshold: number) {
  const xs = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
  const ys = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];
  let bestX: { delta: number; position: number } | null = null;
  let bestY: { delta: number; position: number } | null = null;
  for (const other of others) {
    for (const target of xs(other)) {
      for (const source of xs(moving)) {
        const delta = target - source;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, position: target };
        }
      }
    }
    for (const target of ys(other)) {
      for (const source of ys(moving)) {
        const delta = target - source;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, position: target };
        }
      }
    }
  }
  const guides: SnapGuide[] = [];
  if (bestX) guides.push({ orientation: "vertical", position: bestX.position });
  if (bestY) guides.push({ orientation: "horizontal", position: bestY.position });
  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}

/** Snaps a point to the nearest of `targets` within `threshold`. */
export function snapPointToTargets(
  point: { x: number; y: number },
  targets: Array<{ x: number; y: number }>,
  threshold: number,
) {
  let best: { x: number; y: number } | null = null;
  let bestDist = threshold;
  for (const t of targets) {
    const d = Math.hypot(t.x - point.x, t.y - point.y);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best ? { x: best.x, y: best.y, snapped: true } : { ...point, snapped: false };
}

/**
 * Snap a dragged position: objects first (edges/centers), else grid.
 * `box` is the element's box at the proposed position.
 */
export function snapMove(box: Box, others: Box[], snap: EffectiveSnap, step: number, threshold: number) {
  let x = box.x;
  let y = box.y;
  let guides: SnapGuide[] = [];
  if (snap.grid) {
    x = snapToStep(x, step);
    y = snapToStep(y, step);
  }
  if (snap.objects && others.length) {
    const result = snapBoxToObjects(box, others, threshold);
    if (result.guides.some((g) => g.orientation === "vertical")) x = box.x + result.dx;
    if (result.guides.some((g) => g.orientation === "horizontal")) y = box.y + result.dy;
    guides = result.guides;
  }
  return { x, y, guides };
}

export type GridLine = { points: [number, number, number, number]; major: boolean };

/**
 * Lines for the visible part of the canvas. Minor lines are skipped when
 * they would be closer than `minScreenGap` pixels on screen, so the grid
 * stays readable at any zoom.
 */
export function visibleGridLines(input: {
  view: { x: number; y: number; scale: number };
  stage: { width: number; height: number };
  step: number;
  majorEvery?: number;
  minScreenGap?: number;
}): GridLine[] {
  const { view, stage, step } = input;
  const majorEvery = input.majorEvery ?? (step < 20 ? 10 : 5);
  const minGap = input.minScreenGap ?? 6;
  if (!(step > 0) || !(view.scale > 0)) return [];
  let cell = step;
  // If minor lines would be too dense, draw only major lines.
  const showMinor = cell * view.scale >= minGap;
  if (!showMinor) cell = step * majorEvery;
  while (cell * view.scale < minGap) cell *= majorEvery;
  const left = -view.x / view.scale;
  const top = -view.y / view.scale;
  const right = left + stage.width / view.scale;
  const bottom = top + stage.height / view.scale;
  const lines: GridLine[] = [];
  const startX = Math.floor(left / cell) * cell + 0;
  const startY = Math.floor(top / cell) * cell + 0;
  const isMajor = (v: number) => !showMinor || Math.abs(Math.round(v / step) % majorEvery) === 0;
  for (let x = startX; x <= right && lines.length < 2000; x += cell) {
    lines.push({ points: [x, top, x, bottom], major: isMajor(x) });
  }
  for (let y = startY; y <= bottom && lines.length < 4000; y += cell) {
    lines.push({ points: [left, y, right, y], major: isMajor(y) });
  }
  return lines;
}
