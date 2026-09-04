import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stablePath = resolve(
  process.cwd(),
  "apps/web/src/components/floorplan/FloorplanCanvasStable.tsx"
);
const publicPath = resolve(
  process.cwd(),
  "apps/web/src/components/floorplan/FloorplanCanvas.tsx"
);
const source = readFileSync(stablePath, "utf8");
const publicSource = readFileSync(publicPath, "utf8");

describe("visual designer viewport isolation", () => {
  it("keeps the Konva Stage fixed and transforms only the inner scene group", () => {
    const stageTag = source.match(/<Stage[\s\S]*?>/)?.[0] ?? "";

    expect(stageTag).not.toContain("x={view.x}");
    expect(stageTag).not.toContain("y={view.y}");
    expect(stageTag).not.toContain("scaleX={view.scale}");
    expect(stageTag).not.toContain("scaleY={view.scale}");
    expect(stageTag).not.toContain("draggable=");
    expect(stageTag).not.toContain("onDragEnd=");

    expect(source).toContain(
      "<Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>"
    );
  });

  it("allows viewport changes only through explicit pan, zoom, or Fit actions", () => {
    expect(source).not.toMatch(/useEffect\([\s\S]{0,900}fitView\(\)/);
    expect(source).not.toContain("fitView();");
    expect(source).toContain("onClick={() => runViewportCommand(fitView)}");
    expect(source).toContain("const handleStagePointerMove");
    expect(source).toContain("const handleWheel");
  });

  it("prevents object drag events and touch gestures from moving the viewport", () => {
    expect(source.match(/event\.cancelBubble = true;/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).toContain('style={{ touchAction: "none" }}');
    expect(source).toContain('data-viewport-x={view.x.toFixed(2)}');
    expect(source).toContain('data-object-dragging={objectDragging ? "true" : "false"}');
    expect(source).toContain("blockViewportCommandsUntilRef.current");
  });

  it("keeps the established import path pointed at the stable implementation", () => {
    expect(publicSource).toContain(
      'export { FloorplanCanvas } from "./FloorplanCanvasStable";'
    );
  });
});
