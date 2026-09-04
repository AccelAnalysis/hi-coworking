import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const implementationPath = resolve(
  process.cwd(),
  "apps/web/src/components/floorplan/FloorplanCanvasPointerState.tsx"
);
const publicPath = resolve(
  process.cwd(),
  "apps/web/src/components/floorplan/FloorplanCanvas.tsx"
);
const source = readFileSync(implementationPath, "utf8");
const publicSource = readFileSync(publicPath, "utf8");

describe("visual designer viewport isolation", () => {
  it("keeps the Konva Stage fixed and transforms only a non-draggable scene group", () => {
    const stageTag = source.match(/<Stage[\s\S]*?>/)?.[0] ?? "";

    expect(stageTag).not.toContain("x={view.x}");
    expect(stageTag).not.toContain("y={view.y}");
    expect(stageTag).not.toContain("scaleX={view.scale}");
    expect(stageTag).not.toContain("scaleY={view.scale}");
    expect(stageTag).not.toContain("draggable=");
    expect(stageTag).not.toContain("onDragEnd=");

    expect(source).toContain("x={view.x}");
    expect(source).toContain("y={view.y}");
    expect(source).toContain("scaleX={view.scale}");
    expect(source).toContain("scaleY={view.scale}");
    expect(source).toContain("draggable={false}");
  });

  it("ports the AccelRestaurants pointer-delta state model instead of using Konva dragging", () => {
    expect(source).toContain('data-drag-model="react-pointer-delta"');
    expect(source).toContain("const [dragPositions, setDragPositions]");
    expect(source).toContain("const beginObjectDrag");
    expect(source).toContain("const updateObjectDrag");
    expect(source).toContain("(point.x - drag.start.x) / scale");
    expect(source).toContain("(point.y - drag.start.y) / scale");
    expect(source).toContain("setDragPositions(nextPositions)");
    expect(source).toContain("dragPositions[element.id]");
    expect(source).toContain('window.addEventListener("mousemove", handleMouseMove');
    expect(source).toContain('window.addEventListener("touchmove", handleTouchMove');
    expect(source).not.toContain("node.position(");
    expect(source).not.toContain("onDragStart:");
    expect(source).not.toContain("onDragMove:");
    expect(source).not.toContain("onDragEnd:");
  });

  it("locks and restores the viewport throughout object manipulation", () => {
    expect(source).toContain("viewportSuppressedUntilRef.current = Number.POSITIVE_INFINITY");
    expect(source).toContain("restoreViewport(drag.viewport)");
    expect(source).toContain("POST_OBJECT_VIEWPORT_GUARD_MS");
    expect(source).toContain('data-viewport-x={view.x.toFixed(2)}');
    expect(source).toContain('data-object-dragging={objectDragging ? "true" : "false"}');
    expect(source).toContain('style={{ touchAction: "none" }}');
  });

  it("guards iOS touch interactions from synthesized follow-up mouse events", () => {
    expect(source).toContain("lastTouchStartRef");
    expect(source).toContain("SYNTHETIC_MOUSE_GUARD_MS");
    expect(source).toContain('window.addEventListener("touchend", finish)');
    expect(source).toContain('window.addEventListener("touchcancel", cancel)');
  });

  it("keeps object groups inside the logical floor-plan boundary", () => {
    expect(source).toContain("minimumDeltaX");
    expect(source).toContain("maximumDeltaX");
    expect(source).toContain("minimumDeltaY");
    expect(source).toContain("maximumDeltaY");
    expect(source).toContain("deltaX = clamp(deltaX, minimumDeltaX, maximumDeltaX)");
    expect(source).toContain("deltaY = clamp(deltaY, minimumDeltaY, maximumDeltaY)");
  });

  it("exposes Fit only as an explicit viewport command", () => {
    expect(source).not.toMatch(/useEffect\([\s\S]{0,900}fitView\(\)/);
    expect(source).toContain("onClick={() => viewportCommandsAllowed && fitView()}");
    expect(source).toContain("aria-label=\"Fit floor plan in view\"");
  });

  it("keeps the established import path pointed at the pointer-state implementation", () => {
    expect(publicSource).toContain(
      'export { FloorplanCanvas } from "./FloorplanCanvasPointerState";'
    );
  });
});
