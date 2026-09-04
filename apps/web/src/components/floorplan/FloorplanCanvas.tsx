"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
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

const GRID_SIZE = 20;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;

function snap(n: number) {
  return Math.round(n / GRID_SIZE) * GRID_SIZE;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

function isBookable(el: FloorplanElement) {
  return (el.type === "SEAT" || el.type === "MODE_ZONE") && typeof el.resourceId === "string" && el.resourceId.length > 0;
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
  const trRef = useRef<Konva.Transformer>(null);
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const wheelRafRef = useRef<number | null>(null);
  const dragOriginRef = useRef<Record<string, { x: number; y: number }>>({});
  const lastFittedFloorIdRef = useRef<string | undefined>(undefined);
  const previousStageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const previousViewportSourceRef = useRef<"fallback" | "external" | null>(null);

  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [guides, setGuides] = useState<AlignmentGuides>({ vertical: [], horizontal: [] });

  const width = Math.max(1, stageWidth ?? floorplan?.canvasWidth ?? 1100);
  const height = Math.max(1, stageHeight ?? floorplan?.canvasHeight ?? 650);
  const contentWidth = floorplan?.canvasWidth ?? 1100;
  const contentHeight = floorplan?.canvasHeight ?? 650;

  const shellEls = useMemo(() => normalizeElements(shellElements), [shellElements]);
  const layoutEls = useMemo(() => normalizeElements(layoutElements), [layoutElements]);
  const legacyElements = useMemo(() => floorplan?.elements ?? [], [floorplan?.elements]);
  const usingLegacyModel = !shellElements && !layoutElements;

  const resolvedShell = useMemo(() => (usingLegacyModel ? [] : shellEls), [usingLegacyModel, shellEls]);
  const resolvedLayout = useMemo(() => (usingLegacyModel ? [] : layoutEls), [usingLegacyModel, layoutEls]);
  const allElements = useMemo(
    () => (usingLegacyModel ? legacyElements : [...resolvedShell, ...resolvedLayout]),
    [usingLegacyModel, legacyElements, resolvedShell, resolvedLayout]
  );

  const resolvedBgUrl = backgroundUrl ?? floorplan?.backgroundImageDataUrl ?? "";
  const [bgImage] = useImage(resolvedBgUrl);
  const isPanMode = activeTool === "PAN" || spaceDown;

  const resolvedSelectedIds = useMemo(() => {
    if (selectedIds?.length) return selectedIds;
    if (selectedId) return [selectedId];
    return [];
  }, [selectedIds, selectedId]);

  const selectedIdSet = useMemo(() => new Set(resolvedSelectedIds), [resolvedSelectedIds]);
  const selectedEl = useMemo(() => {
    if (resolvedSelectedIds.length !== 1) return undefined;
    return allElements.find((e) => e.id === resolvedSelectedIds[0]);
  }, [allElements, resolvedSelectedIds]);

  useEffect(() => {
    if (!trRef.current) return;
    if (mode !== "EDIT") {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }

    const stage = stageRef.current;
    if (!stage || !resolvedSelectedIds.length) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }

    const nodes = resolvedSelectedIds
      .map((id) =>
        stage.findOne<Konva.Node>(`#node-shell-${id}`) ??
        stage.findOne<Konva.Node>(`#node-layout-${id}`) ??
        stage.findOne<Konva.Node>(`#node-legacy-${id}`)
      )
      .filter((node): node is Konva.Node => Boolean(node));

    trRef.current.nodes(nodes);
    trRef.current.getLayer()?.batchDraw();
  }, [mode, resolvedSelectedIds]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      const target = evt.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (evt.code === "Space") setSpaceDown(true);
    };

    const onKeyUp = (evt: KeyboardEvent) => {
      if (evt.code === "Space") setSpaceDown(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (wheelRafRef.current !== null) window.cancelAnimationFrame(wheelRafRef.current);
    };
  }, []);

  const updateLegacyElement = (id: string, patch: Partial<FloorplanElement>) => {
    if (!onChange || !floorplan) return;
    onChange({
      ...floorplan,
      elements: floorplan.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)),
    });
  };

  const updateLayerElements = (layer: ActiveLayer, id: string, patch: Partial<FloorplanElement>) => {
    if (layer === "shell") {
      onShellElementsChange?.(resolvedShell.map((el) => (el.id === id ? { ...el, ...patch } : el)));
      return;
    }
    onLayoutElementsChange?.(resolvedLayout.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  };

  const setViewSafe = useCallback(
    (next: Viewport) => {
      viewRef.current = next;
      setView(next);
      onViewportChange?.(next);
    },
    [onViewportChange]
  );

  const fitView = useCallback(() => {
    const padding = width < 640 ? 24 : 48;
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const nextScale = clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight), MIN_SCALE, MAX_SCALE);
    setViewSafe({
      x: (width - contentWidth * nextScale) / 2,
      y: (height - contentHeight * nextScale) / 2,
      scale: nextScale,
    });
  }, [contentHeight, contentWidth, height, setViewSafe, width]);

  useEffect(() => {
    if (width <= 1 || height <= 1) return;

    const floorId = floorplan?.id ?? "floor";
    const viewportSource: "fallback" | "external" =
      typeof stageWidth === "number" && typeof stageHeight === "number" ? "external" : "fallback";
    const previousSize = previousStageSizeRef.current;
    const floorChanged = lastFittedFloorIdRef.current !== floorId;
    const externalViewportBecameAvailable =
      previousViewportSourceRef.current === "fallback" && viewportSource === "external";

    if (!previousSize || floorChanged || externalViewportBecameAvailable) {
      previousStageSizeRef.current = { width, height };
      previousViewportSourceRef.current = viewportSource;
      lastFittedFloorIdRef.current = floorId;
      fitView();
      return;
    }

    // Resizing the browser, opening an inspector, or any ResizeObserver update
    // must not move or scale the design. Only the explicit Fit/zoom/pan controls
    // are allowed to change the viewport after initialization.
    previousStageSizeRef.current = { width, height };
    previousViewportSourceRef.current = viewportSource;
  }, [fitView, floorplan?.id, height, stageHeight, stageWidth, width]);

  const zoomAtCenter = (factor: number) => {
    const oldScale = viewRef.current.scale;
    const nextScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
    const center = { x: width / 2, y: height / 2 };
    const contentPoint = {
      x: (center.x - viewRef.current.x) / oldScale,
      y: (center.y - viewRef.current.y) / oldScale,
    };
    setViewSafe({
      x: center.x - contentPoint.x * nextScale,
      y: center.y - contentPoint.y * nextScale,
      scale: nextScale,
    });
  };

  const handleStagePointerDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ((!onSelect && !onSelectIds) || isPanMode) return;

    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setGuides({ vertical: [], horizontal: [] });
      onSelect?.(undefined);
      onSelectIds?.([]);
      return;
    }

    const id = e.target?.attrs?.elementId as string | undefined;
    const layer = e.target?.attrs?.elementLayer as ActiveLayer | "legacy" | undefined;
    if (!id || !layer) return;

    const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
    const selectedElement = source.find((candidate) => candidate.id === id);
    if (!selectedElement) return;
    if (mode === "SELECT" && !isBookable(selectedElement)) return;

    const mouseEvent = e.evt instanceof MouseEvent ? e.evt : null;
    const additive = Boolean(mouseEvent && (mouseEvent.shiftKey || mouseEvent.metaKey || mouseEvent.ctrlKey));
    if (mode === "EDIT" && additive && onSelectIds) {
      const current = new Set(resolvedSelectedIds);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      onSelectIds(Array.from(current));
      return;
    }

    const groupIds =
      mode === "EDIT" && selectedElement.groupId
        ? source.filter((candidate) => candidate.groupId === selectedElement.groupId).map((candidate) => candidate.id)
        : [id];
    onSelect?.(id);
    onSelectIds?.(groupIds);
  };

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (wheelRafRef.current !== null) return;

    wheelRafRef.current = window.requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) {
        wheelRafRef.current = null;
        return;
      }

      const oldScale = viewRef.current.scale;
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        wheelRafRef.current = null;
        return;
      }

      const nextScale = clamp(e.evt.deltaY > 0 ? oldScale / 1.08 : oldScale * 1.08, MIN_SCALE, MAX_SCALE);
      const contentPoint = {
        x: (pointer.x - viewRef.current.x) / oldScale,
        y: (pointer.y - viewRef.current.y) / oldScale,
      };

      setViewSafe({
        x: pointer.x - contentPoint.x * nextScale,
        y: pointer.y - contentPoint.y * nextScale,
        scale: nextScale,
      });
      wheelRafRef.current = null;
    });
  };

  const handleStageDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    if (!stage || e.target !== stage) return;
    setViewSafe({ ...viewRef.current, x: stage.x(), y: stage.y() });
  };

  const renderElement = (el: FloorplanElement, layer: ActiveLayer | "legacy") => {
    if (el.visible === false || (mode === "SELECT" && el.meta?.customerVisible === false)) return null;

    const isSelected = selectedIdSet.has(el.id);
    const locked = !!el.locked;
    const isEditableLayer = layer === "legacy" || layer === activeLayer;
    const selectable = mode !== "VIEW" && !locked && isEditableLayer;
    const selectableInSelectMode = mode === "SELECT" ? isBookable(el) && layer !== "shell" : true;
    const isInteractive = mode === "EDIT" ? selectable && !isPanMode : mode === "SELECT" ? selectableInSelectMode : false;

    const fill = el.fill ??
      (el.type === "WALL"
        ? "#94a3b8"
        : el.type === "DOOR"
          ? "#cbd5e1"
          : el.type === "WINDOW"
            ? "#e2e8f0"
            : el.type === "SEAT"
              ? "#d1fae5"
              : "#e0e7ff");

    let displayFill = fill;
    if (mode === "SELECT") {
      if (!selectableInSelectMode) displayFill = "#cbd5e1";
      else if (isSelected) displayFill = "#334155";
    }

    const stroke = el.stroke ?? (isSelected ? "#0f172a" : "#94a3b8");
    const strokeWidth = el.strokeWidth ?? (isSelected ? 3 : 1);
    const opacity = el.opacity ?? (mode === "SELECT" && !selectableInSelectMode ? 0.45 : 1);

    const applyPatch = (patch: Partial<FloorplanElement>) => {
      if (layer === "legacy") updateLegacyElement(el.id, patch);
      else updateLayerElements(layer, el.id, patch);
    };

    const applyDeltaToSelection = (deltaX: number, deltaY: number) => {
      const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
      const movingIds = el.groupId
        ? new Set(source.filter((candidate) => candidate.groupId === el.groupId).map((candidate) => candidate.id))
        : selectedIdSet.has(el.id)
          ? selectedIdSet
          : new Set([el.id]);

      if (movingIds.size <= 1 || mode !== "EDIT") {
        applyPatch({ x: snap(el.x + deltaX), y: snap(el.y + deltaY) });
        return;
      }

      if (layer === "legacy") {
        if (!onChange || !floorplan) return;
        onChange({
          ...floorplan,
          elements: floorplan.elements.map((candidate) => {
            if (!movingIds.has(candidate.id)) return candidate;
            const origin = dragOriginRef.current[candidate.id] ?? { x: candidate.x, y: candidate.y };
            return { ...candidate, x: snap(origin.x + deltaX), y: snap(origin.y + deltaY) };
          }),
        });
        return;
      }

      const next = source.map((candidate) => {
        if (!movingIds.has(candidate.id)) return candidate;
        const origin = dragOriginRef.current[candidate.id] ?? { x: candidate.x, y: candidate.y };
        return { ...candidate, x: snap(origin.x + deltaX), y: snap(origin.y + deltaY) };
      });

      if (layer === "shell") onShellElementsChange?.(next);
      else onLayoutElementsChange?.(next);
    };

    const sharedProps = {
      id: `node-${layer}-${el.id}`,
      elementId: el.id,
      elementLayer: layer,
      rotation: el.rotation,
      fill: displayFill,
      stroke,
      strokeWidth,
      draggable: mode === "EDIT" && selectable && !isPanMode,
      listening: isInteractive,
      opacity,
      onDragMove: (evt: KonvaEventObject<DragEvent>) => {
        if (mode !== "EDIT") return;
        const node = evt.target;
        const peers = allElements.filter(
          (candidate) =>
            !selectedIdSet.has(candidate.id) &&
            candidate.visible !== false
        );
        const threshold = 6 / Math.max(viewRef.current.scale, MIN_SCALE);
        const widthValue = Math.max(1, el.width ?? 120);
        const heightValue = Math.max(1, el.height ?? 100);
        let nextX = snap(node.x());
        let nextY = snap(node.y());
        const horizontalMatch = findAlignment(
          nextX,
          widthValue,
          peers.map((candidate) => ({ position: candidate.x, size: Math.max(1, candidate.width ?? 120) })),
          threshold
        );
        const verticalMatch = findAlignment(
          nextY,
          heightValue,
          peers.map((candidate) => ({ position: candidate.y, size: Math.max(1, candidate.height ?? 100) })),
          threshold
        );
        if (horizontalMatch) nextX += horizontalMatch.delta;
        if (verticalMatch) nextY += verticalMatch.delta;
        node.x(nextX);
        node.y(nextY);
        setGuides({
          vertical: horizontalMatch ? [horizontalMatch.target] : [],
          horizontal: verticalMatch ? [verticalMatch.target] : [],
        });
      },
      onDragEnd: (evt: KonvaEventObject<DragEvent>) => {
        if (mode !== "EDIT") return;
        evt.cancelBubble = true;
        setGuides({ vertical: [], horizontal: [] });
        const node = evt.target;
        const deltaX = node.x() - (dragOriginRef.current[el.id]?.x ?? el.x);
        const deltaY = node.y() - (dragOriginRef.current[el.id]?.y ?? el.y);
        applyDeltaToSelection(deltaX, deltaY);
      },
      onDragStart: () => {
        setGuides({ vertical: [], horizontal: [] });
        const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
        const dragSelection = el.groupId
          ? new Set(source.filter((candidate) => candidate.groupId === el.groupId).map((candidate) => candidate.id))
          : selectedIdSet.has(el.id)
            ? selectedIdSet
            : new Set([el.id]);
        const origin: Record<string, { x: number; y: number }> = {};
        source.forEach((candidate) => {
          if (dragSelection.has(candidate.id)) origin[candidate.id] = { x: candidate.x, y: candidate.y };
        });
        dragOriginRef.current = origin;
      },
      onTransformEnd: (evt: KonvaEventObject<Event>) => {
        if (mode !== "EDIT") return;
        setGuides({ vertical: [], horizontal: [] });
        const node = evt.target as Konva.Shape;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);

        if (el.shape === "LINE" || el.shape === "POLY") {
          const lineNode = node as Konva.Line;
          const points = lineNode.points().map((point) => snap(point));
          applyPatch({ x: snap(node.x()), y: snap(node.y()), points, rotation: node.rotation() });
          return;
        }

        const rectNode = node as Konva.Rect;
        applyPatch({
          x: snap(node.x()),
          y: snap(node.y()),
          width: Math.max(10, snap(rectNode.width() * scaleX)),
          height: Math.max(10, snap(rectNode.height() * scaleY)),
          rotation: node.rotation(),
        });
      },
    };

    return (
      <React.Fragment key={`${layer}-${el.id}`}>
        {el.shape === "LINE" || el.shape === "POLY" ? (
          <Line
            {...sharedProps}
            x={el.x}
            y={el.y}
            points={el.points ?? [0, 0, el.width ?? 80, 0]}
            closed={el.shape === "POLY" ? el.closed ?? true : false}
          />
        ) : el.shape === "TEXT" ? (
          <Text {...sharedProps} x={el.x} y={el.y} width={el.width ?? 180} text={el.label ?? "Text"} fontSize={Number(el.meta?.fontSize ?? 14)} />
        ) : el.shape === "ICON" ? (
          <Text
            {...sharedProps}
            x={el.x}
            y={el.y}
            width={el.width ?? 40}
            height={el.height ?? 40}
            text={String(el.meta?.icon ?? "⬤")}
            fontSize={Number(el.meta?.fontSize ?? 22)}
          />
        ) : (
          <Rect
            {...sharedProps}
            x={el.x}
            y={el.y}
            width={el.width ?? 120}
            height={el.height ?? 100}
            cornerRadius={el.type === "WALL" ? 2 : 10}
          />
        )}

        {el.label ? (
          <Text
            x={el.x + 8}
            y={el.y + 8}
            width={Math.max(40, (el.width ?? 120) - 16)}
            text={el.label}
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
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: "linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)",
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
        }}
      />
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        className="bg-transparent"
        onMouseDown={(event) => handleStagePointerDown(event)}
        onTap={(event) => handleStagePointerDown(event as KonvaEventObject<TouchEvent>)}
        onWheel={handleWheel}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={isPanMode}
        onDragEnd={handleStageDragEnd}
      >
        <Layer>
          {bgImage ? (
            <KonvaImage image={bgImage} x={backgroundOffsetX} y={backgroundOffsetY} width={contentWidth * backgroundScale} height={contentHeight * backgroundScale} opacity={backgroundOpacity ?? 1} />
          ) : null}

          {usingLegacyModel
            ? legacyElements.slice().sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((el) => renderElement(el, "legacy"))
            : null}

          {!usingLegacyModel
            ? resolvedShell.slice().sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((el) => renderElement(el, "shell"))
            : null}

          {!usingLegacyModel
            ? resolvedLayout.slice().sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((el) => renderElement(el, "layout"))
            : null}

          {mode === "EDIT"
            ? guides.vertical.map((guide) => (
                <Line key={`guide-x-${guide}`} points={[guide, 0, guide, contentHeight]} stroke="#2563eb" strokeWidth={1} dash={[6, 5]} listening={false} />
              ))
            : null}
          {mode === "EDIT"
            ? guides.horizontal.map((guide) => (
                <Line key={`guide-y-${guide}`} points={[0, guide, contentWidth, guide]} stroke="#2563eb" strokeWidth={1} dash={[6, 5]} listening={false} />
              ))
            : null}

          {mode === "EDIT" ? (
            <Transformer
              ref={trRef}
              rotateEnabled
              borderStroke="#0f172a"
              borderStrokeWidth={2}
              anchorFill="#ffffff"
              anchorStroke="#0f172a"
              anchorSize={12}
              enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right", "top-center", "bottom-center"]}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
            />
          ) : null}
        </Layer>
      </Stage>

      {mode === "EDIT" && resolvedSelectedIds.length > 0 ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur">
          {resolvedSelectedIds.length === 1 ? selectedEl?.label || "1 object selected" : `${resolvedSelectedIds.length} objects selected`}
        </div>
      ) : null}

      {showViewportControls ? (
        <div className="absolute bottom-3 right-3 flex items-center rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur" aria-label="Canvas zoom controls">
          <button
            type="button"
            onClick={() => zoomAtCenter(1 / 1.2)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={fitView}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-semibold tabular-nums text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label={`Fit floor plan. Current zoom ${Math.round(view.scale * 100)} percent`}
            title="Fit floor plan"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomAtCenter(1.2)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
        </div>
      ) : null}
    </div>
  );
}