"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import useImage from "use-image";
import type { Floorplan, FloorplanElement } from "@hi/shared";

type Mode = "EDIT" | "VIEW" | "SELECT";
type ActiveLayer = "shell" | "layout";
type CanvasTool = "SELECT" | "PAN";
type Viewport = { x: number; y: number; scale: number };
type AlignmentGuides = { vertical: number[]; horizontal: number[] };
type AlignmentMatch = { delta: number; target: number };
type CanvasPointerEvent = MouseEvent | TouchEvent;
type PanState = {
  active: boolean;
  pointerX: number;
  pointerY: number;
  view: Viewport;
};

const GRID_SIZE = 20;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const MIN_VISIBLE_SCENE_PX = 72;
const VIEWPORT_COMMAND_COOLDOWN_MS = 450;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function findAlignment(
  position: number,
  size: number,
  peers: Array<{ position: number; size: number }>,
  threshold: number
): AlignmentMatch | undefined {
  const movingPoints = [position, position + size / 2, position + size];
  let best: AlignmentMatch | undefined;

  peers.forEach((peer) => {
    const peerPoints = [peer.position, peer.position + peer.size / 2, peer.position + peer.size];
    movingPoints.forEach((movingPoint) => {
      peerPoints.forEach((target) => {
        const delta = target - movingPoint;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, target };
        }
      });
    });
  });

  return best;
}

function isBookable(element: FloorplanElement) {
  return (
    (element.type === "SEAT" || element.type === "MODE_ZONE") &&
    typeof element.resourceId === "string" &&
    element.resourceId.length > 0
  );
}

function normalizeElements(elements?: FloorplanElement[]) {
  return elements ?? [];
}

export function FloorplanCanvas({
  floorplan,
  shellElements,
  layoutElements,
  backgroundUrl,
  backgroundOpacity,
  backgroundScale = 1,
  backgroundOffsetX = 0,
  backgroundOffsetY = 0,
  stageWidth,
  stageHeight,
  activeLayer = "layout",
  activeTool = "SELECT",
  mode,
  selectedId,
  selectedIds,
  onSelect,
  onSelectIds,
  onChange,
  onShellElementsChange,
  onLayoutElementsChange,
  showViewportControls = mode !== "VIEW",
  canvasLabel = "Interactive floor plan",
  onViewportChange,
}: {
  floorplan?: Floorplan;
  shellElements?: FloorplanElement[];
  layoutElements?: FloorplanElement[];
  backgroundUrl?: string;
  backgroundOpacity?: number;
  backgroundScale?: number;
  backgroundOffsetX?: number;
  backgroundOffsetY?: number;
  activeLayer?: ActiveLayer;
  activeTool?: CanvasTool;
  mode: Mode;
  selectedId?: string;
  selectedIds?: string[];
  onSelect?: (id?: string) => void;
  onSelectIds?: (ids: string[]) => void;
  onChange?: (next: Floorplan) => void;
  onShellElementsChange?: (elements: FloorplanElement[]) => void;
  onLayoutElementsChange?: (elements: FloorplanElement[]) => void;
  stageWidth?: number;
  stageHeight?: number;
  showViewportControls?: boolean;
  canvasLabel?: string;
  onViewportChange?: (viewport: Viewport) => void;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const wheelFrameRef = useRef<number | null>(null);
  const dragOriginRef = useRef<Record<string, { x: number; y: number }>>({});
  const panStateRef = useRef<PanState | null>(null);
  const lastFloorIdRef = useRef(floorplan?.id ?? "floor");
  const blockViewportCommandsUntilRef = useRef(0);

  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [guides, setGuides] = useState<AlignmentGuides>({ vertical: [], horizontal: [] });
  const [objectDragging, setObjectDragging] = useState(false);

  const width = Math.max(1, stageWidth ?? floorplan?.canvasWidth ?? 1100);
  const height = Math.max(1, stageHeight ?? floorplan?.canvasHeight ?? 650);
  const contentWidth = Math.max(1, floorplan?.canvasWidth ?? 1100);
  const contentHeight = Math.max(1, floorplan?.canvasHeight ?? 650);

  const shell = useMemo(() => normalizeElements(shellElements), [shellElements]);
  const layout = useMemo(() => normalizeElements(layoutElements), [layoutElements]);
  const legacyElements = useMemo(() => floorplan?.elements ?? [], [floorplan?.elements]);
  const usingLegacyModel = !shellElements && !layoutElements;

  const resolvedShell = useMemo(() => (usingLegacyModel ? [] : shell), [usingLegacyModel, shell]);
  const resolvedLayout = useMemo(() => (usingLegacyModel ? [] : layout), [usingLegacyModel, layout]);
  const allElements = useMemo(
    () => (usingLegacyModel ? legacyElements : [...resolvedShell, ...resolvedLayout]),
    [usingLegacyModel, legacyElements, resolvedShell, resolvedLayout]
  );

  const resolvedBackgroundUrl = backgroundUrl ?? floorplan?.backgroundImageDataUrl ?? "";
  const [backgroundImage] = useImage(resolvedBackgroundUrl);
  const isPanMode = activeTool === "PAN" || spaceDown;

  const resolvedSelectedIds = useMemo(() => {
    if (selectedIds?.length) return selectedIds;
    if (selectedId) return [selectedId];
    return [];
  }, [selectedIds, selectedId]);

  const selectedIdSet = useMemo(() => new Set(resolvedSelectedIds), [resolvedSelectedIds]);
  const selectedElement = useMemo(() => {
    if (resolvedSelectedIds.length !== 1) return undefined;
    return allElements.find((element) => element.id === resolvedSelectedIds[0]);
  }, [allElements, resolvedSelectedIds]);

  const constrainViewport = useCallback(
    (candidate: Viewport): Viewport => {
      const scale = clamp(finiteOr(candidate.scale, 1), MIN_SCALE, MAX_SCALE);
      const visibleX = Math.min(MIN_VISIBLE_SCENE_PX, Math.max(24, width / 3));
      const visibleY = Math.min(MIN_VISIBLE_SCENE_PX, Math.max(24, height / 3));
      const minX = visibleX - contentWidth * scale;
      const maxX = width - visibleX;
      const minY = visibleY - contentHeight * scale;
      const maxY = height - visibleY;

      return {
        x: clamp(finiteOr(candidate.x, 0), minX, maxX),
        y: clamp(finiteOr(candidate.y, 0), minY, maxY),
        scale,
      };
    },
    [contentHeight, contentWidth, height, width]
  );

  const setViewSafe = useCallback(
    (candidate: Viewport) => {
      const next = constrainViewport(candidate);
      viewRef.current = next;
      setView(next);
      onViewportChange?.(next);
    },
    [constrainViewport, onViewportChange]
  );

  const fitView = useCallback(() => {
    const padding = width < 640 ? 24 : 48;
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const scale = clamp(
      Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
      MIN_SCALE,
      MAX_SCALE
    );

    setViewSafe({
      x: (width - contentWidth * scale) / 2,
      y: (height - contentHeight * scale) / 2,
      scale,
    });
  }, [contentHeight, contentWidth, height, setViewSafe, width]);

  const runViewportCommand = useCallback((command: () => void) => {
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    if (now < blockViewportCommandsUntilRef.current) return;
    command();
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const floorId = floorplan?.id ?? "floor";
    if (lastFloorIdRef.current === floorId) return;
    lastFloorIdRef.current = floorId;
    panStateRef.current = null;
    setGuides({ vertical: [], horizontal: [] });
    setViewSafe({ x: 0, y: 0, scale: 1 });
  }, [floorplan?.id, setViewSafe]);

  useEffect(() => {
    const stopPan = () => {
      panStateRef.current = null;
      setSpaceDown(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mouseup", stopPan);
    window.addEventListener("touchend", stopPan);
    window.addEventListener("touchcancel", stopPan);
    window.addEventListener("blur", stopPan);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mouseup", stopPan);
      window.removeEventListener("touchend", stopPan);
      window.removeEventListener("touchcancel", stopPan);
      window.removeEventListener("blur", stopPan);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (wheelFrameRef.current !== null) window.cancelAnimationFrame(wheelFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (mode !== "EDIT") {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const stage = stageRef.current;
    if (!stage || !resolvedSelectedIds.length) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const nodes = resolvedSelectedIds
      .map(
        (id) =>
          stage.findOne<Konva.Node>(`#node-shell-${id}`) ??
          stage.findOne<Konva.Node>(`#node-layout-${id}`) ??
          stage.findOne<Konva.Node>(`#node-legacy-${id}`)
      )
      .filter((node): node is Konva.Node => Boolean(node));

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [mode, resolvedSelectedIds]);

  const updateLegacyElement = (id: string, patch: Partial<FloorplanElement>) => {
    if (!onChange || !floorplan) return;
    onChange({
      ...floorplan,
      elements: floorplan.elements.map((element) =>
        element.id === id ? { ...element, ...patch } : element
      ),
    });
  };

  const updateLayerElement = (
    layerName: ActiveLayer,
    id: string,
    patch: Partial<FloorplanElement>
  ) => {
    if (layerName === "shell") {
      onShellElementsChange?.(
        resolvedShell.map((element) => (element.id === id ? { ...element, ...patch } : element))
      );
      return;
    }
    onLayoutElementsChange?.(
      resolvedLayout.map((element) => (element.id === id ? { ...element, ...patch } : element))
    );
  };

  const clearSelection = () => {
    setGuides({ vertical: [], horizontal: [] });
    onSelect?.(undefined);
    onSelectIds?.([]);
  };

  const beginPan = (event: KonvaEventObject<CanvasPointerEvent>) => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    event.evt.preventDefault();
    panStateRef.current = {
      active: true,
      pointerX: pointer.x,
      pointerY: pointer.y,
      view: viewRef.current,
    };
  };

  const handleStagePointerDown = (event: KonvaEventObject<CanvasPointerEvent>) => {
    if (isPanMode) {
      beginPan(event);
      return;
    }
    if (!onSelect && !onSelectIds) return;

    const id = event.target?.attrs?.elementId as string | undefined;
    const layerName = event.target?.attrs?.elementLayer as ActiveLayer | "legacy" | undefined;
    if (!id || !layerName) {
      clearSelection();
      return;
    }

    const source =
      layerName === "legacy"
        ? legacyElements
        : layerName === "shell"
          ? resolvedShell
          : resolvedLayout;
    const element = source.find((candidate) => candidate.id === id);
    if (!element) return;
    if (mode === "SELECT" && !isBookable(element)) return;

    const mouseEvent = event.evt instanceof MouseEvent ? event.evt : null;
    const additive = Boolean(
      mouseEvent && (mouseEvent.shiftKey || mouseEvent.metaKey || mouseEvent.ctrlKey)
    );

    if (mode === "EDIT" && additive && onSelectIds) {
      const next = new Set(resolvedSelectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const ids = Array.from(next);
      onSelectIds(ids);
      if (!ids.length) onSelect?.(undefined);
      return;
    }

    const ids =
      mode === "EDIT" && element.groupId
        ? source
            .filter((candidate) => candidate.groupId === element.groupId)
            .map((candidate) => candidate.id)
        : [id];
    onSelect?.(id);
    onSelectIds?.(ids);
  };

  const handleStagePointerMove = (event: KonvaEventObject<CanvasPointerEvent>) => {
    const pan = panStateRef.current;
    if (!pan?.active) return;
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    event.evt.preventDefault();
    setViewSafe({
      x: pan.view.x + pointer.x - pan.pointerX,
      y: pan.view.y + pointer.y - pan.pointerY,
      scale: pan.view.scale,
    });
  };

  const endPan = () => {
    panStateRef.current = null;
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    if (objectDragging || wheelFrameRef.current !== null) return;

    wheelFrameRef.current = window.requestAnimationFrame(() => {
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) {
        wheelFrameRef.current = null;
        return;
      }

      const oldScale = viewRef.current.scale;
      const nextScale = clamp(
        event.evt.deltaY > 0 ? oldScale / 1.08 : oldScale * 1.08,
        MIN_SCALE,
        MAX_SCALE
      );
      const contentPoint = {
        x: (pointer.x - viewRef.current.x) / oldScale,
        y: (pointer.y - viewRef.current.y) / oldScale,
      };

      setViewSafe({
        x: pointer.x - contentPoint.x * nextScale,
        y: pointer.y - contentPoint.y * nextScale,
        scale: nextScale,
      });
      wheelFrameRef.current = null;
    });
  };

  const zoomAtCenter = (factor: number) => {
    const oldScale = viewRef.current.scale;
    const nextScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
    const centerX = width / 2;
    const centerY = height / 2;
    const contentX = (centerX - viewRef.current.x) / oldScale;
    const contentY = (centerY - viewRef.current.y) / oldScale;

    setViewSafe({
      x: centerX - contentX * nextScale,
      y: centerY - contentY * nextScale,
      scale: nextScale,
    });
  };

  const finishObjectDrag = () => {
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    blockViewportCommandsUntilRef.current = now + VIEWPORT_COMMAND_COOLDOWN_MS;
    setObjectDragging(false);
  };

  const renderElement = (element: FloorplanElement, layerName: ActiveLayer | "legacy") => {
    if (
      element.visible === false ||
      (mode === "SELECT" && element.meta?.customerVisible === false)
    ) {
      return null;
    }

    const isSelected = selectedIdSet.has(element.id);
    const locked = Boolean(element.locked);
    const isEditableLayer = layerName === "legacy" || layerName === activeLayer;
    const selectable = mode !== "VIEW" && !locked && isEditableLayer;
    const selectableInSelectMode =
      mode === "SELECT" ? isBookable(element) && layerName !== "shell" : true;
    const interactive =
      mode === "EDIT"
        ? selectable && !isPanMode
        : mode === "SELECT"
          ? selectableInSelectMode
          : false;

    const fill =
      element.fill ??
      (element.type === "WALL"
        ? "#94a3b8"
        : element.type === "DOOR"
          ? "#cbd5e1"
          : element.type === "WINDOW"
            ? "#e2e8f0"
            : element.type === "SEAT"
              ? "#d1fae5"
              : "#e0e7ff");

    let displayFill = fill;
    if (mode === "SELECT") {
      if (!selectableInSelectMode) displayFill = "#cbd5e1";
      else if (isSelected) displayFill = "#334155";
    }

    const stroke = element.stroke ?? (isSelected ? "#0f172a" : "#94a3b8");
    const strokeWidth = element.strokeWidth ?? (isSelected ? 3 : 1);
    const opacity =
      element.opacity ?? (mode === "SELECT" && !selectableInSelectMode ? 0.45 : 1);

    const applyPatch = (patch: Partial<FloorplanElement>) => {
      if (layerName === "legacy") updateLegacyElement(element.id, patch);
      else updateLayerElement(layerName, element.id, patch);
    };

    const applyDeltaToSelection = (deltaX: number, deltaY: number) => {
      const source =
        layerName === "legacy"
          ? legacyElements
          : layerName === "shell"
            ? resolvedShell
            : resolvedLayout;
      const movingIds = element.groupId
        ? new Set(
            source
              .filter((candidate) => candidate.groupId === element.groupId)
              .map((candidate) => candidate.id)
          )
        : selectedIdSet.has(element.id)
          ? selectedIdSet
          : new Set([element.id]);

      if (movingIds.size <= 1 || mode !== "EDIT") {
        applyPatch({
          x: snap(element.x + deltaX),
          y: snap(element.y + deltaY),
        });
        return;
      }

      if (layerName === "legacy") {
        if (!onChange || !floorplan) return;
        onChange({
          ...floorplan,
          elements: floorplan.elements.map((candidate) => {
            if (!movingIds.has(candidate.id)) return candidate;
            const origin = dragOriginRef.current[candidate.id] ?? {
              x: candidate.x,
              y: candidate.y,
            };
            return {
              ...candidate,
              x: snap(origin.x + deltaX),
              y: snap(origin.y + deltaY),
            };
          }),
        });
        return;
      }

      const next = source.map((candidate) => {
        if (!movingIds.has(candidate.id)) return candidate;
        const origin = dragOriginRef.current[candidate.id] ?? {
          x: candidate.x,
          y: candidate.y,
        };
        return {
          ...candidate,
          x: snap(origin.x + deltaX),
          y: snap(origin.y + deltaY),
        };
      });

      if (layerName === "shell") onShellElementsChange?.(next);
      else onLayoutElementsChange?.(next);
    };

    const sharedProps = {
      id: `node-${layerName}-${element.id}`,
      elementId: element.id,
      elementLayer: layerName,
      rotation: element.rotation,
      fill: displayFill,
      stroke,
      strokeWidth,
      draggable: mode === "EDIT" && selectable && !isPanMode,
      listening: interactive,
      opacity,
      onDragStart: (event: KonvaEventObject<DragEvent>) => {
        event.cancelBubble = true;
        setObjectDragging(true);
        setGuides({ vertical: [], horizontal: [] });

        const source =
          layerName === "legacy"
            ? legacyElements
            : layerName === "shell"
              ? resolvedShell
              : resolvedLayout;
        const dragSelection = element.groupId
          ? new Set(
              source
                .filter((candidate) => candidate.groupId === element.groupId)
                .map((candidate) => candidate.id)
            )
          : selectedIdSet.has(element.id)
            ? selectedIdSet
            : new Set([element.id]);
        const origin: Record<string, { x: number; y: number }> = {};
        source.forEach((candidate) => {
          if (dragSelection.has(candidate.id)) {
            origin[candidate.id] = { x: candidate.x, y: candidate.y };
          }
        });
        dragOriginRef.current = origin;
      },
      onDragMove: (event: KonvaEventObject<DragEvent>) => {
        event.cancelBubble = true;
        if (mode !== "EDIT") return;
        const node = event.target;
        const movingIds = new Set(Object.keys(dragOriginRef.current));
        const peers = allElements.filter(
          (candidate) => !movingIds.has(candidate.id) && candidate.visible !== false
        );
        const threshold = 6 / Math.max(viewRef.current.scale, MIN_SCALE);
        const elementWidth = Math.max(1, element.width ?? 120);
        const elementHeight = Math.max(1, element.height ?? 100);
        let nextX = snap(node.x());
        let nextY = snap(node.y());

        const horizontalMatch = findAlignment(
          nextX,
          elementWidth,
          peers.map((candidate) => ({
            position: candidate.x,
            size: Math.max(1, candidate.width ?? 120),
          })),
          threshold
        );
        const verticalMatch = findAlignment(
          nextY,
          elementHeight,
          peers.map((candidate) => ({
            position: candidate.y,
            size: Math.max(1, candidate.height ?? 100),
          })),
          threshold
        );

        if (horizontalMatch) nextX += horizontalMatch.delta;
        if (verticalMatch) nextY += verticalMatch.delta;
        node.position({ x: nextX, y: nextY });
        setGuides({
          vertical: horizontalMatch ? [horizontalMatch.target] : [],
          horizontal: verticalMatch ? [verticalMatch.target] : [],
        });
      },
      onDragEnd: (event: KonvaEventObject<DragEvent>) => {
        event.cancelBubble = true;
        if (mode !== "EDIT") {
          finishObjectDrag();
          return;
        }
        setGuides({ vertical: [], horizontal: [] });
        const node = event.target;
        const origin = dragOriginRef.current[element.id] ?? {
          x: element.x,
          y: element.y,
        };
        applyDeltaToSelection(node.x() - origin.x, node.y() - origin.y);
        finishObjectDrag();
      },
      onTransformEnd: (event: KonvaEventObject<Event>) => {
        event.cancelBubble = true;
        if (mode !== "EDIT") return;
        setGuides({ vertical: [], horizontal: [] });
        const node = event.target as Konva.Shape;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);

        if (element.shape === "LINE" || element.shape === "POLY") {
          const line = node as Konva.Line;
          applyPatch({
            x: snap(node.x()),
            y: snap(node.y()),
            points: line.points().map((point) => snap(point)),
            rotation: node.rotation(),
          });
          return;
        }

        const rect = node as Konva.Rect;
        applyPatch({
          x: snap(node.x()),
          y: snap(node.y()),
          width: Math.max(10, snap(rect.width() * scaleX)),
          height: Math.max(10, snap(rect.height() * scaleY)),
          rotation: node.rotation(),
        });
      },
    };

    return (
      <React.Fragment key={`${layerName}-${element.id}`}>
        {element.shape === "LINE" || element.shape === "POLY" ? (
          <Line
            {...sharedProps}
            x={element.x}
            y={element.y}
            points={element.points ?? [0, 0, element.width ?? 80, 0]}
            closed={element.shape === "POLY" ? element.closed ?? true : false}
          />
        ) : element.shape === "TEXT" ? (
          <Text
            {...sharedProps}
            x={element.x}
            y={element.y}
            width={element.width ?? 180}
            text={element.label ?? "Text"}
            fontSize={Number(element.meta?.fontSize ?? 14)}
          />
        ) : element.shape === "ICON" ? (
          <Text
            {...sharedProps}
            x={element.x}
            y={element.y}
            width={element.width ?? 40}
            height={element.height ?? 40}
            text={String(element.meta?.icon ?? "⬤")}
            fontSize={Number(element.meta?.fontSize ?? 22)}
          />
        ) : (
          <Rect
            {...sharedProps}
            x={element.x}
            y={element.y}
            width={element.width ?? 120}
            height={element.height ?? 100}
            cornerRadius={element.type === "WALL" ? 2 : 10}
          />
        )}

        {element.label ? (
          <Text
            x={element.x + 8}
            y={element.y + 8}
            width={Math.max(40, (element.width ?? 120) - 16)}
            text={element.label}
            fontSize={13}
            fontStyle={isSelected ? "bold" : "normal"}
            fill={isSelected && mode === "SELECT" ? "#ffffff" : "#1e293b"}
            listening={false}
          />
        ) : null}
      </React.Fragment>
    );
  };

  return (
    <div
      className="relative h-full min-h-[280px] w-full overflow-hidden bg-slate-100 shadow-inner ring-1 ring-inset ring-slate-200"
      role="group"
      aria-label={canvasLabel}
      data-testid="floorplan-canvas"
      data-viewport-x={view.x.toFixed(2)}
      data-viewport-y={view.y.toFixed(2)}
      data-viewport-scale={view.scale.toFixed(4)}
      data-object-dragging={objectDragging ? "true" : "false"}
      style={{ touchAction: "none" }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)",
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
        }}
      />

      <Stage
        ref={stageRef}
        width={width}
        height={height}
        className="bg-transparent"
        onMouseDown={handleStagePointerDown}
        onMouseMove={handleStagePointerMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onTouchStart={handleStagePointerDown}
        onTouchMove={handleStagePointerMove}
        onTouchEnd={endPan}
        onWheel={handleWheel}
        style={{ cursor: isPanMode ? "grab" : "default", touchAction: "none" }}
      >
        <Layer>
          <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            {backgroundImage ? (
              <KonvaImage
                image={backgroundImage}
                x={backgroundOffsetX}
                y={backgroundOffsetY}
                width={contentWidth * backgroundScale}
                height={contentHeight * backgroundScale}
                opacity={backgroundOpacity ?? 1}
                listening={false}
              />
            ) : null}

            {usingLegacyModel
              ? legacyElements
                  .slice()
                  .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                  .map((element) => renderElement(element, "legacy"))
              : null}

            {!usingLegacyModel
              ? resolvedShell
                  .slice()
                  .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                  .map((element) => renderElement(element, "shell"))
              : null}

            {!usingLegacyModel
              ? resolvedLayout
                  .slice()
                  .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                  .map((element) => renderElement(element, "layout"))
              : null}

            {mode === "EDIT"
              ? guides.vertical.map((guide) => (
                  <Line
                    key={`guide-x-${guide}`}
                    points={[guide, 0, guide, contentHeight]}
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    dash={[6 / view.scale, 5 / view.scale]}
                    listening={false}
                  />
                ))
              : null}
            {mode === "EDIT"
              ? guides.horizontal.map((guide) => (
                  <Line
                    key={`guide-y-${guide}`}
                    points={[0, guide, contentWidth, guide]}
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    dash={[6 / view.scale, 5 / view.scale]}
                    listening={false}
                  />
                ))
              : null}

            {mode === "EDIT" ? (
              <Transformer
                ref={transformerRef}
                rotateEnabled
                borderStroke="#0f172a"
                borderStrokeWidth={2 / view.scale}
                anchorFill="#ffffff"
                anchorStroke="#0f172a"
                anchorSize={12 / view.scale}
                enabledAnchors={[
                  "top-left",
                  "top-right",
                  "bottom-left",
                  "bottom-right",
                  "middle-left",
                  "middle-right",
                  "top-center",
                  "bottom-center",
                ]}
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < 10 || newBox.height < 10 ? oldBox : newBox
                }
              />
            ) : null}
          </Group>
        </Layer>
      </Stage>

      {mode === "EDIT" && resolvedSelectedIds.length > 0 ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur">
          {resolvedSelectedIds.length === 1
            ? selectedElement?.label || "1 object selected"
            : `${resolvedSelectedIds.length} objects selected`}
        </div>
      ) : null}

      {showViewportControls ? (
        <div
          className={`absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur transition-opacity ${
            objectDragging ? "pointer-events-none opacity-50" : "opacity-100"
          }`}
          aria-label="Canvas viewport controls"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => runViewportCommand(() => zoomAtCenter(1 / 1.2))}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span
            className="min-w-12 px-1 text-center text-xs font-semibold tabular-nums text-slate-600"
            aria-live="polite"
          >
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => runViewportCommand(() => zoomAtCenter(1.2))}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => runViewportCommand(fitView)}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Fit floor plan in view"
            title="Fit floor plan"
          >
            Fit
          </button>
        </div>
      ) : null}
    </div>
  );
}
