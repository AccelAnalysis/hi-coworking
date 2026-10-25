"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import useImage from "use-image";
import type { Floorplan, FloorplanElement } from "@hi/shared";
import {
  DEFAULT_SNAP_SETTINGS,
  effectiveSnap,
  gridStepPx,
  snapMove,
  snapRotation,
  snapToStep,
  visibleGridLines,
  type Box,
  type SnapGuide,
  type SnapSettings,
} from "@/lib/designerSnap";
import { elementTypeLabel, rotatedCenter } from "@/lib/floorplanBuilder";

type Mode = "EDIT" | "VIEW" | "SELECT";
type ActiveLayer = "shell" | "layout";
type CanvasTool = "SELECT" | "PAN";

export type CanvasView = { x: number; y: number; scale: number };

const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isBookable(el: FloorplanElement) {
  return (el.type === "SEAT" || el.type === "MODE_ZONE") && typeof el.resourceId === "string" && el.resourceId.length > 0;
}

function normalizeElements(elements?: FloorplanElement[]) {
  return elements ?? [];
}

function boxOf(el: FloorplanElement): Box {
  return { x: el.x, y: el.y, width: el.width ?? 120, height: el.height ?? 100 };
}

function defaultFill(el: FloorplanElement) {
  if (el.type === "WALL") return "#94a3b8";
  if (el.type === "DOOR") return "#cbd5e1";
  if (el.type === "WINDOW") return "#e2e8f0";
  if (el.type === "SEAT") return "#d1fae5";
  return "#e0e7ff";
}

export function FloorplanCanvas({
  floorplan,
  shellElements,
  layoutElements,
  backgroundUrl,
  backgroundOpacity,
  stageWidth,
  stageHeight,
  activeLayer = "layout",
  activeTool = "SELECT",
  mode,
  selectedId,
  selectedIds,
  snapSettings = DEFAULT_SNAP_SETTINGS,
  fill = false,
  fitKey,
  onSelect,
  onSelectIds,
  onChange,
  onShellElementsChange,
  onLayoutElementsChange,
  onActivateLayer,
  onViewChange,
}: {
  floorplan?: Floorplan;
  shellElements?: FloorplanElement[];
  layoutElements?: FloorplanElement[];
  backgroundUrl?: string;
  backgroundOpacity?: number;
  activeLayer?: ActiveLayer;
  activeTool?: CanvasTool;
  mode: Mode;
  selectedId?: string;
  selectedIds?: string[];
  /** Grid and snapping preferences (designer View menu). */
  snapSettings?: SnapSettings;
  /** Fill the parent instead of drawing a framed card. */
  fill?: boolean;
  /** Changing this value re-fits the view to the floor (e.g. on floor switch). */
  fitKey?: string;
  onSelect?: (id?: string) => void;
  onSelectIds?: (ids: string[]) => void;
  onChange?: (next: Floorplan) => void;
  onShellElementsChange?: (elements: FloorplanElement[]) => void;
  onLayoutElementsChange?: (elements: FloorplanElement[]) => void;
  /** Clicking an element on the inactive layer asks the parent to switch to it. */
  onActivateLayer?: (layer: ActiveLayer, elementId: string) => void;
  onViewChange?: (view: CanvasView) => void;
  stageWidth?: number;
  stageHeight?: number;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const viewRef = useRef<CanvasView>({ x: 0, y: 0, scale: 1 });
  const wheelRafRef = useRef<number | null>(null);
  const dragOriginRef = useRef<Record<string, { x: number; y: number }>>({});

  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [altDown, setAltDown] = useState(false);
  const [guides, setGuides] = useState<SnapGuide[]>([]);

  const width = stageWidth ?? floorplan?.canvasWidth ?? 1100;
  const height = stageHeight ?? floorplan?.canvasHeight ?? 650;
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
    [usingLegacyModel, legacyElements, resolvedShell, resolvedLayout],
  );

  const resolvedBgUrl = backgroundUrl ?? floorplan?.backgroundImageDataUrl ?? "";
  const [bgImage] = useImage(resolvedBgUrl);

  const isPanMode = activeTool === "PAN" || spaceDown;
  const snap = effectiveSnap(snapSettings, altDown);
  const step = gridStepPx(snapSettings);

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
    const stage = stageRef.current;
    if (mode !== "EDIT" || !stage || !resolvedSelectedIds.length) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }
    const nodes = resolvedSelectedIds
      .map(
        (id) =>
          stage.findOne<Konva.Node>(`#node-shell-${id}`) ??
          stage.findOne<Konva.Node>(`#node-layout-${id}`) ??
          stage.findOne<Konva.Node>(`#node-legacy-${id}`),
      )
      .filter((node): node is Konva.Node => Boolean(node))
      .filter((node) => node.draggable());
    trRef.current.nodes(nodes);
    trRef.current.getLayer()?.batchDraw();
  }, [mode, resolvedSelectedIds, allElements, activeLayer]);

  const setViewSafe = (next: CanvasView) => {
    viewRef.current = next;
    setView(next);
    onViewChange?.(next);
  };

  // Fit the floor into the stage when the floor (fitKey) or the stage size changes.
  const lastFitRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!fill || !width || !height) return;
    const key = `${fitKey ?? ""}`;
    if (lastFitRef.current === key) return;
    lastFitRef.current = key;
    const pad = 32;
    const scale = clamp(Math.min((width - pad * 2) / contentWidth, (height - pad * 2) / contentHeight), 0.3, 2);
    setViewSafe({
      x: (width - contentWidth * scale) / 2,
      y: (height - contentHeight * scale) / 2,
      scale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fill, width, height, contentWidth, contentHeight]);

  useEffect(() => {
    onViewChange?.(viewRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "Alt") setAltDown(true);
      // A space typed into a field must not switch the canvas into pan mode.
      if (evt.code === "Space" && !isTyping(evt.target)) setSpaceDown(true);
    };
    const onKeyUp = (evt: KeyboardEvent) => {
      if (evt.key === "Alt") setAltDown(false);
      if (evt.code === "Space") setSpaceDown(false);
    };
    const reset = () => {
      setSpaceDown(false);
      setAltDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (wheelRafRef.current !== null) window.cancelAnimationFrame(wheelRafRef.current);
    };
  }, []);

  const updateLegacyElement = (id: string, patch: Partial<FloorplanElement>) => {
    if (!onChange || !floorplan) return;
    onChange({ ...floorplan, elements: floorplan.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) });
  };

  const updateLayerElements = (layer: ActiveLayer, id: string, patch: Partial<FloorplanElement>) => {
    if (layer === "shell") {
      onShellElementsChange?.(resolvedShell.map((el) => (el.id === id ? { ...el, ...patch } : el)));
      return;
    }
    onLayoutElementsChange?.(resolvedLayout.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  };

  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!onSelect && !onSelectIds) return;
    if (isPanMode) return;

    const target = e.target;
    const clickedOnEmpty = target === target.getStage();
    if (clickedOnEmpty) {
      onSelect?.(undefined);
      onSelectIds?.([]);
      return;
    }

    const id = target?.attrs?.elementId as string | undefined;
    const layer = target?.attrs?.elementLayer as ActiveLayer | "legacy" | undefined;
    if (!id || !layer) return;

    if (mode === "EDIT" && layer !== "legacy" && layer !== activeLayer) {
      // Clicking a Shell item while editing the Layout (or vice versa) switches to that layer.
      onActivateLayer?.(layer, id);
      return;
    }

    if (mode === "SELECT") {
      const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
      const el = source.find((x) => x.id === id);
      if (!el || !isBookable(el)) return;
    }

    const evt = e.evt as MouseEvent;
    const additive = Boolean(evt.shiftKey || evt.metaKey || evt.ctrlKey);
    if (mode === "EDIT" && additive && onSelectIds) {
      const current = new Set(resolvedSelectedIds);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      onSelectIds(Array.from(current));
      return;
    }

    onSelect?.(id);
    onSelectIds?.([id]);
  };

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    if (wheelRafRef.current !== null) return;
    wheelRafRef.current = window.requestAnimationFrame(() => {
      wheelRafRef.current = null;
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;
      const oldScale = viewRef.current.scale;
      const nextScale = clamp(e.evt.deltaY > 0 ? oldScale / 1.05 : oldScale * 1.05, 0.25, 4);
      const mousePointTo = {
        x: (pointer.x - viewRef.current.x) / oldScale,
        y: (pointer.y - viewRef.current.y) / oldScale,
      };
      setViewSafe({
        x: pointer.x - mousePointTo.x * nextScale,
        y: pointer.y - mousePointTo.y * nextScale,
        scale: nextScale,
      });
    });
  };

  // Konva drag events bubble from elements up to the Stage. Only a drag of
  // the Stage itself is a pan; an element's dragend used to be read as a pan
  // and jumped the whole view to the element's coordinates.
  const handleStageDragMove = (e: KonvaEventObject<DragEvent>) => {
    if (e.target !== e.target.getStage()) return;
    viewRef.current = { ...viewRef.current, x: e.target.x(), y: e.target.y() };
  };
  const handleStageDragEnd = (e: KonvaEventObject<DragEvent>) => {
    if (e.target !== e.target.getStage()) return;
    setViewSafe({ ...viewRef.current, x: e.target.x(), y: e.target.y() });
  };

  const gridLines = useMemo(
    () => (snapSettings.showGrid ? visibleGridLines({ view, stage: { width, height }, step }) : []),
    [snapSettings.showGrid, view, width, height, step],
  );

  const renderElement = (el: FloorplanElement, layer: ActiveLayer | "legacy") => {
    if (el.visible === false && mode !== "EDIT") return null;
    const isSelected = selectedIdSet.has(el.id);
    const locked = !!el.locked;
    const isEditableLayer = layer === "legacy" || layer === activeLayer;
    const selectable = mode !== "VIEW" && !locked && isEditableLayer;
    const selectableInSelectMode = mode === "SELECT" ? isBookable(el) && layer !== "shell" : true;
    // In EDIT, every element listens so an inactive-layer click can switch layers.
    const isInteractive =
      mode === "EDIT" ? !isPanMode && (selectable || (!isEditableLayer && !!onActivateLayer)) : mode === "SELECT" ? selectableInSelectMode : false;
    const dimmed = mode === "EDIT" && !isEditableLayer;

    const fillColor = el.fill ?? defaultFill(el);
    let displayFill = fillColor;
    if (mode === "SELECT") {
      if (!selectableInSelectMode) displayFill = "#cbd5e1";
      else if (isSelected) displayFill = "#4f46e5";
    }

    const stroke = el.stroke ?? (isSelected ? "#4f46e5" : dimmed ? "#cbd5e1" : "#94a3b8");
    const strokeWidth = el.strokeWidth ?? (isSelected ? 2 : 1);
    const baseOpacity = el.opacity ?? (mode === "SELECT" && !selectableInSelectMode ? 0.5 : 1);
    const opacity = (el.visible === false ? 0.35 : 1) * (dimmed ? Math.min(baseOpacity, 0.4) : baseOpacity);

    const applyPatch = (patch: Partial<FloorplanElement>) => {
      if (layer === "legacy") updateLegacyElement(el.id, patch);
      else updateLayerElements(layer, el.id, patch);
    };

    const applyDeltaToSelection = (deltaX: number, deltaY: number) => {
      const origin = dragOriginRef.current;
      if (resolvedSelectedIds.length <= 1 || mode !== "EDIT" || !selectedIdSet.has(el.id)) {
        applyPatch({ x: el.x + deltaX, y: el.y + deltaY });
        return;
      }
      if (layer === "legacy") {
        if (!onChange || !floorplan) return;
        onChange({
          ...floorplan,
          elements: floorplan.elements.map((c) =>
            selectedIdSet.has(c.id) ? { ...c, x: (origin[c.id]?.x ?? c.x) + deltaX, y: (origin[c.id]?.y ?? c.y) + deltaY } : c,
          ),
        });
        return;
      }
      const source = layer === "shell" ? resolvedShell : resolvedLayout;
      const next = source.map((c) =>
        selectedIdSet.has(c.id) ? { ...c, x: (origin[c.id]?.x ?? c.x) + deltaX, y: (origin[c.id]?.y ?? c.y) + deltaY } : c,
      );
      if (layer === "shell") onShellElementsChange?.(next);
      else onLayoutElementsChange?.(next);
    };

    const others = (): Box[] =>
      allElements.filter((c) => !selectedIdSet.has(c.id) && c.id !== el.id && c.visible !== false).map(boxOf);

    const sharedProps = {
      id: `node-${layer}-${el.id}`,
      elementId: el.id,
      elementLayer: layer,
      rotation: el.rotation,
      fill: displayFill,
      stroke,
      strokeWidth,
      hitStrokeWidth: 12,
      draggable: mode === "EDIT" && selectable && !isPanMode,
      listening: isInteractive,
      opacity,
      dash: el.visible === false ? [6, 4] : undefined,
      onDragStart: (evt: KonvaEventObject<DragEvent>) => {
        evt.cancelBubble = true;
        const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
        const dragSelection = selectedIdSet.has(el.id) ? selectedIdSet : new Set([el.id]);
        const origin: Record<string, { x: number; y: number }> = {};
        source.forEach((c) => {
          if (dragSelection.has(c.id)) origin[c.id] = { x: c.x, y: c.y };
        });
        dragOriginRef.current = origin;
      },
      onDragMove: (evt: KonvaEventObject<DragEvent>) => {
        evt.cancelBubble = true;
        if (mode !== "EDIT") return;
        const node = evt.target;
        const live = effectiveSnap(snapSettings, Boolean((evt.evt as MouseEvent)?.altKey) || altDown);
        const result = snapMove(
          { x: node.x(), y: node.y(), width: el.width ?? 120, height: el.height ?? 100 },
          live.objects && !el.rotation ? others() : [],
          live,
          step,
          8 / viewRef.current.scale,
        );
        node.x(result.x);
        node.y(result.y);
        setGuides(result.guides);
      },
      onDragEnd: (evt: KonvaEventObject<DragEvent>) => {
        evt.cancelBubble = true;
        setGuides([]);
        if (mode !== "EDIT") return;
        const node = evt.target;
        const deltaX = node.x() - (dragOriginRef.current[el.id]?.x ?? el.x);
        const deltaY = node.y() - (dragOriginRef.current[el.id]?.y ?? el.y);
        if (deltaX === 0 && deltaY === 0) return;
        applyDeltaToSelection(deltaX, deltaY);
      },
      onTransformEnd: (evt: KonvaEventObject<Event>) => {
        if (mode !== "EDIT") return;
        const node = evt.target as Konva.Shape;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const live = effectiveSnap(snapSettings, altDown);
        const size = (n: number) => Math.max(10, live.grid ? Math.max(step / 2, snapToStep(n, step / 2)) : Math.round(n));
        const rotation = snapRotation(node.rotation(), live.angle);

        if (el.shape === "LINE" || el.shape === "POLY") {
          const lineNode = node as Konva.Line;
          const points = lineNode.points().map((p, i) => Math.round(p * (i % 2 === 0 ? scaleX : scaleY)));
          applyPatch({ x: Math.round(node.x()), y: Math.round(node.y()), points, rotation });
          return;
        }
        const rectNode = node as Konva.Rect;
        applyPatch({
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: size(rectNode.width() * scaleX),
          height: size(rectNode.height() * scaleY),
          rotation,
        });
      },
    };

    const label = el.label ?? "";
    const w = el.width ?? 120;
    const h = el.height ?? 100;
    const center = rotatedCenter(el);
    const fontSize = clamp(Math.min(w, h) / 4, 10, 14);
    const showLabel = label && !(dimmed && layer === "shell");

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
          <Rect {...sharedProps} x={el.x} y={el.y} width={w} height={h} cornerRadius={el.type === "WALL" ? 2 : 10} />
        )}

        {showLabel && el.shape !== "TEXT" ? (
          // Labels follow the element's rotated center and stay upright so they remain readable.
          <Text
            x={center.x}
            y={center.y}
            width={Math.max(w, 60)}
            offsetX={Math.max(w, 60) / 2}
            offsetY={fontSize / 2}
            align="center"
            text={label}
            fontSize={fontSize}
            fill={isSelected && mode === "SELECT" ? "#ffffff" : "#1e293b"}
            opacity={dimmed ? 0.5 : 1}
            ellipsis
            wrap="none"
            listening={false}
          />
        ) : null}
      </React.Fragment>
    );
  };

  const sortZ = (els: FloorplanElement[]) => els.slice().sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const shellFirst = activeLayer === "layout";

  return (
    <div
      className={
        fill
          ? "relative h-full w-full overflow-hidden bg-slate-50"
          : "rounded-xl bg-slate-100 border-2 border-slate-200 overflow-hidden shadow-inner relative"
      }
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        className="bg-transparent"
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
        onWheel={handleWheel}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={isPanMode}
        onDragMove={handleStageDragMove}
        onDragEnd={handleStageDragEnd}
        style={{ cursor: isPanMode ? "grab" : "default" }}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={contentWidth} height={contentHeight} fill="#ffffff" stroke="#e2e8f0" strokeWidth={1} />
          {bgImage ? (
            <KonvaImage image={bgImage} width={contentWidth} height={contentHeight} opacity={backgroundOpacity ?? 1} />
          ) : null}
          {gridLines.map((line, i) => (
            <Line
              key={i}
              points={line.points}
              stroke={line.major ? "#94a3b8" : "#cbd5e1"}
              strokeWidth={(line.major ? 1 : 0.5) / view.scale}
              opacity={line.major ? 0.55 : 0.45}
            />
          ))}
        </Layer>

        {usingLegacyModel ? (
          <Layer>{sortZ(legacyElements).map((el) => renderElement(el, "legacy"))}</Layer>
        ) : (
          <>
            {/* The inactive layer is drawn first and dimmed; the layer being edited is always on top. */}
            <Layer>
              {shellFirst
                ? sortZ(resolvedShell).map((el) => renderElement(el, "shell"))
                : sortZ(resolvedLayout).map((el) => renderElement(el, "layout"))}
            </Layer>
            <Layer>
              {shellFirst
                ? sortZ(resolvedLayout).map((el) => renderElement(el, "layout"))
                : sortZ(resolvedShell).map((el) => renderElement(el, "shell"))}
              {mode === "EDIT" ? (
                <Transformer
                  ref={trRef}
                  rotateEnabled
                  rotationSnaps={snap.angle ? ROTATION_SNAPS : []}
                  rotationSnapTolerance={7.5}
                  anchorSize={12}
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
                  boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
                />
              ) : null}
            </Layer>
          </>
        )}

        <Layer listening={false}>
          {guides.map((g, i) =>
            g.orientation === "vertical" ? (
              <Line key={i} points={[g.position, -10000, g.position, 10000]} stroke="#ec4899" strokeWidth={1 / view.scale} dash={[4 / view.scale, 4 / view.scale]} />
            ) : (
              <Line key={i} points={[-10000, g.position, 10000, g.position]} stroke="#ec4899" strokeWidth={1 / view.scale} dash={[4 / view.scale, 4 / view.scale]} />
            ),
          )}
        </Layer>
      </Stage>

      {mode === "EDIT" && resolvedSelectedIds.length > 0 && !fill ? (
        <div className="border-t border-slate-200 bg-white/50 px-4 py-2 text-xs text-slate-500 backdrop-blur-sm absolute bottom-0 left-0 right-0">
          Selected: <span className="text-slate-900 font-medium">{resolvedSelectedIds.length}</span>
          {selectedEl ? <span> · {elementTypeLabel(selectedEl.type)}</span> : null}
          {selectedEl?.resourceId ? (
            <span>
              {" "}
              / resourceId: <span className="text-slate-900 font-medium">{selectedEl.resourceId}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

