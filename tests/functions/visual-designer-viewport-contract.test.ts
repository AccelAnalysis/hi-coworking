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
const primaryPreviewPath = resolve(
  process.cwd(),
  "apps/web/src/app/preview/visual-designer/page.tsx"
);
const latestPreviewPath = resolve(
  process.cwd(),
  "apps/web/src/app/preview/visual-designer-latest/page.tsx"
);
const source = readFileSync(implementationPath, "utf8");
const publicSource = readFileSync(publicPath, "utf8");
const primaryPreviewSource = readFileSync(primaryPreviewPath, "utf8");
const latestPreviewSource = readFileSync(latestPreviewPath, "utf8");

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

  it("guards iOS touch interactions and reserves Control-click for a context menu", () => {
    expect(source).toContain("lastTouchStartRef");
    expect(source).toContain("SYNTHETIC_MOUSE_GUARD_MS");
    expect(source).toContain('window.addEventListener("touchend", finish)');
    expect(source).toContain('window.addEventListener("touchcancel", cancel)');
    expect(source).toContain("nativeEvent.ctrlKey");
  });

  it("keeps object groups inside the logical floor-plan boundary", () => {
    expect(source).toContain("minimumDeltaX");
    expect(source).toContain("maximumDeltaX");
    expect(source).toContain("minimumDeltaY");
    expect(source).toContain("maximumDeltaY");
    expect(source).toContain("deltaX = clamp(deltaX, minimumDeltaX, maximumDeltaX)");
    expect(source).toContain("deltaY = clamp(deltaY, minimumDeltaY, maximumDeltaY)");
  });

  it("locks the scene grid to one physical square foot per square", () => {
    expect(source).toContain("const GRID_SIZE = 20");
    expect(source).toContain("const INCHES_PER_GRID = 12");
    expect(source).toContain("const MAJOR_GRID_EVERY = 5");
    expect(source).toContain('data-grid-unit="12-inches"');
    expect(source).toContain('data-grid-square-feet="1"');
    expect(source).toContain("verticalGridLines.map");
    expect(source).toContain("horizontalGridLines.map");
    expect(source).toContain("Grid · 1 square = 1 ft × 1 ft");
    expect(source).toContain('data-testid="floorplan-scale"');
    expect(source).toContain("formatImperialLength(elementWidth(selectedElement))");
    expect(latestPreviewSource).toContain('data-testid="preview-physical-scale"');
    expect(latestPreviewSource).toContain("1 grid square = 1 ft × 1 ft = 1 sq ft");
  });

  it("provides concise object and blank-canvas contextual actions", () => {
    expect(source).toContain("const openContextMenu");
    expect(source).toContain("onContextMenu={(event) =>");
    expect(source).toContain('data-testid="floorplan-context-menu"');
    expect(source).toContain('role="menu"');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain("Add desk here");
    expect(source).toContain("Add room setup here");
    expect(source).toContain("Add wall here");
    expect(source).toContain("Duplicate");
    expect(source).toContain("Bring to front");
    expect(source).toContain("Send to back");
    expect(source).toContain("Delete");
    expect(source).toContain("destructive");
  });

  it("blocks native browser context menus at the DOM boundary", () => {
    expect(publicSource).toContain('data-testid="floorplan-browser-context-guard"');
    expect(publicSource).toContain("onContextMenu={(event) => event.preventDefault()}");
    expect(publicSource).toContain(
      'import { FloorplanCanvas as PointerStateCanvas } from "./FloorplanCanvasPointerState";'
    );
  });

  it("exposes Fit only as an explicit viewport command", () => {
    expect(source).not.toMatch(/useEffect\([\s\S]{0,900}fitView\(\)/);
    expect(source).toContain("onClick={() => viewportCommandsAllowed && fitView()}");
    expect(source).toContain("aria-label=\"Fit floor plan in view\"");
  });

  it("uses an explicit desktop Add dialog independent of mobile-sheet state", () => {
    expect(latestPreviewSource).toContain("const [addOpen, setAddOpen] = useState(false)");
    expect(latestPreviewSource).toContain("onClick={() => setAddOpen(true)}");
    expect(latestPreviewSource).toContain('data-testid="desktop-add-button"');
    expect(latestPreviewSource).toContain('data-testid="explicit-add-dialog"');
    expect(latestPreviewSource).toContain('aria-label="Add to the space"');
  });

  it("keeps the primary preview URL pointed at the cache-independent acceptance route", () => {
    expect(primaryPreviewSource).toContain(
      'export { default } from "../visual-designer-latest/page";'
    );
  });
});
