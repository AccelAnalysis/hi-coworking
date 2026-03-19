"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import useImage from "use-image";
import type { Floorplan, FloorplanElement } from "@hi/shared";

type Mode = "EDIT" | "VIEW" | "SELECT";
type ActiveLayer = "shell" | "layout";
type CanvasTool = "SELECT" | "PAN";

const GRID_SIZE = 20;

function snap(n: number) {
  return Math.round(n / GRID_SIZE) * GRID_SIZE;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
  onSelect?: (id?: string) => void;
  onSelectIds?: (ids: string[]) => void;
  onChange?: (next: Floorplan) => void;
  onShellElementsChange?: (elements: FloorplanElement[]) => void;
  onLayoutElementsChange?: (elements: FloorplanElement[]) => void;
  stageWidth?: number;
  stageHeight?: number;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const viewRef = useRef<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 });
  const wheelRafRef = useRef<number | null>(null);
  const dragOriginRef = useRef<Record<string, { x: number; y: number }>>({});

  const [view, setView] = useState<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 });
  const [spaceDown, setSpaceDown] = useState(false);

  // Use provided stage dimensions or fallback to floorplan/default
  const width = stageWidth ?? floorplan?.canvasWidth ?? 1100;
  const height = stageHeight ?? floorplan?.canvasHeight ?? 650;

  // Keep track of content bounds for background image if needed, but stage is the viewport
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
    if (!stage) return;

    if (!resolvedSelectedIds.length) {
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

    if (!nodes.length) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
      return;
    }

    trRef.current.nodes(nodes);
    trRef.current.getLayer()?.batchDraw();
  }, [mode, resolvedSelectedIds]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
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
      if (wheelRafRef.current !== null) {
        window.cancelAnimationFrame(wheelRafRef.current);
      }
    };
  }, []);

  const updateLegacyElement = (id: string, patch: Partial<FloorplanElement>) => {
    if (!onChange) return;
    if (!floorplan) return;
    const next: Floorplan = {
      ...floorplan,
      elements: floorplan.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)),
    };
    onChange(next);
  };

  const updateLayerElements = (layer: ActiveLayer, id: string, patch: Partial<FloorplanElement>) => {
    if (layer === "shell") {
      if (!onShellElementsChange) return;
      onShellElementsChange(resolvedShell.map((el) => (el.id === id ? { ...el, ...patch } : el)));
      return;
    }
    if (!onLayoutElementsChange) return;
    onLayoutElementsChange(resolvedLayout.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  };

  const setViewSafe = (next: { x: number; y: number; scale: number }) => {
    viewRef.current = next;
    setView(next);
  };

  const handleStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (!onSelect && !onSelectIds) return;

    if (isPanMode) return;

    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      onSelect?.(undefined);
      onSelectIds?.([]);
      return;
    }

    const id = e.target?.attrs?.elementId as string | undefined;
    const layer = e.target?.attrs?.elementLayer as ActiveLayer | "legacy" | undefined;
    if (!id || !layer) return;

    if (mode === "SELECT") {
      const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
      const el = source.find((x) => x.id === id);
      if (!el || !isBookable(el)) return;
    }

    const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
    if (mode === "EDIT" && additive && onSelectIds) {
      const current = new Set(resolvedSelectedIds);
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
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

      const scaleBy = 1.05;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const nextScale = clamp(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy, 0.5, 2.8);

      const mousePointTo = {
        x: (pointer.x - viewRef.current.x) / oldScale,
        y: (pointer.y - viewRef.current.y) / oldScale,
      };

      const nextPos = {
        x: pointer.x - mousePointTo.x * nextScale,
        y: pointer.y - mousePointTo.y * nextScale,
      };

      setViewSafe({ x: nextPos.x, y: nextPos.y, scale: nextScale });
      wheelRafRef.current = null;
    });
  };

  const handleDragEndStage = (e: KonvaEventObject<DragEvent>) => {
    const stage = e.target;
    setViewSafe({ ...viewRef.current, x: stage.x(), y: stage.y() });
  };

  const renderElement = (el: FloorplanElement, layer: ActiveLayer | "legacy") => {
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
      if (!selectableInSelectMode) {
        displayFill = "#cbd5e1";
      } else if (isSelected) {
        displayFill = "#4f46e5";
      }
    }

    const stroke = el.stroke ?? (isSelected ? "#4f46e5" : "#94a3b8");
    const strokeWidth = el.strokeWidth ?? (isSelected ? 2 : 1);
    const opacity = el.opacity ?? (mode === "SELECT" && !selectableInSelectMode ? 0.5 : 1);

    const applyPatch = (patch: Partial<FloorplanElement>) => {
      if (layer === "legacy") {
        updateLegacyElement(el.id, patch);
      } else {
        updateLayerElements(layer, el.id, patch);
      }
    };

    const applyDeltaToSelection = (deltaX: number, deltaY: number) => {
      if (resolvedSelectedIds.length <= 1 || mode !== "EDIT") {
        applyPatch({ x: snap(el.x + deltaX), y: snap(el.y + deltaY) });
        return;
      }

      if (layer === "legacy") {
        if (!onChange || !floorplan) return;
        const next: Floorplan = {
          ...floorplan,
          elements: floorplan.elements.map((candidate) => {
            if (!selectedIdSet.has(candidate.id)) return candidate;
            const origin = dragOriginRef.current[candidate.id] ?? { x: candidate.x, y: candidate.y };
            return {
              ...candidate,
              x: snap(origin.x + deltaX),
              y: snap(origin.y + deltaY),
            };
          }),
        };
        onChange(next);
        return;
      }

      const source = layer === "shell" ? resolvedShell : resolvedLayout;
      const next = source.map((candidate) => {
        if (!selectedIdSet.has(candidate.id)) return candidate;
        const origin = dragOriginRef.current[candidate.id] ?? { x: candidate.x, y: candidate.y };
        return {
          ...candidate,
          x: snap(origin.x + deltaX),
          y: snap(origin.y + deltaY),
        };
      });

      if (layer === "shell") {
        onShellElementsChange?.(next);
      } else {
        onLayoutElementsChange?.(next);
      }
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
        node.x(snap(node.x()));
        node.y(snap(node.y()));
      },
      onDragEnd: (evt: KonvaEventObject<DragEvent>) => {
        if (mode !== "EDIT") return;
        const node = evt.target;
        const deltaX = node.x() - (dragOriginRef.current[el.id]?.x ?? el.x);
        const deltaY = node.y() - (dragOriginRef.current[el.id]?.y ?? el.y);
        applyDeltaToSelection(deltaX, deltaY);
      },
      onDragStart: () => {
        const source = layer === "legacy" ? legacyElements : layer === "shell" ? resolvedShell : resolvedLayout;
        const dragSelection = selectedIdSet.has(el.id) ? selectedIdSet : new Set([el.id]);
        const origin: Record<string, { x: number; y: number }> = {};
        source.forEach((candidate) => {
          if (!dragSelection.has(candidate.id)) return;
          origin[candidate.id] = { x: candidate.x, y: candidate.y };
        });
        dragOriginRef.current = origin;
      },
      onTransformEnd: (evt: KonvaEventObject<Event>) => {
        if (mode !== "EDIT") return;
        const node = evt.target as Konva.Shape;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);

        if (el.shape === "LINE" || el.shape === "POLY") {
          const lineNode = node as Konva.Line;
          const points = lineNode.points().map((point, index) => (index % 2 === 0 ? snap(point) : snap(point)));
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
            points={el.points ?? [0, 0, (el.width ?? 80), 0]}
            closed={el.shape === "POLY" ? el.closed ?? true : false}
          />
        ) : el.shape === "TEXT" ? (
          <Text
            {...sharedProps}
            x={el.x}
            y={el.y}
            width={el.width ?? 180}
            text={el.label ?? "Text"}
            fontSize={Number(el.meta?.fontSize ?? 14)}
          />
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
            text={el.label}
            fontSize={12}
            fill={isSelected && mode === "SELECT" ? "#ffffff" : "#1e293b"}
            listening={false}
          />
        ) : null}
      </React.Fragment>
    );
  };

  return (
    <div className="rounded-xl bg-slate-100 border-2 border-slate-200 overflow-hidden shadow-inner relative">
      {/* Grid Background Pattern */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]" 
        style={{
          backgroundImage:
            "linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        className="bg-transparent"
        onMouseDown={handleStageMouseDown}
        onWheel={handleWheel}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={isPanMode}
        onDragEnd={handleDragEndStage}
      >
        <Layer>
          {bgImage ? (
            <KonvaImage image={bgImage} width={width} height={height} opacity={backgroundOpacity ?? 1} />
          ) : null}

          {usingLegacyModel
            ? legacyElements
                .slice()
                .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                .map((el) => renderElement(el, "legacy"))
            : null}

          {!usingLegacyModel
            ? resolvedShell
                .slice()
                .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                .map((el) => renderElement(el, "shell"))
            : null}

          {!usingLegacyModel
            ? resolvedLayout
                .slice()
                .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                .map((el) => renderElement(el, "layout"))
            : null}

          {mode === "EDIT" ? (
            <Transformer
              ref={trRef}
              rotateEnabled
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
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 10 || newBox.height < 10) return oldBox;
                return newBox;
              }}
            />
          ) : null}
        </Layer>
      </Stage>

      {mode === "EDIT" && resolvedSelectedIds.length > 0 ? (
        <div className="border-t border-slate-200 bg-white/50 px-4 py-2 text-xs text-slate-500 backdrop-blur-sm absolute bottom-0 left-0 right-0">
          Selected: <span className="text-slate-900 font-medium">{resolvedSelectedIds.length}</span>
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
