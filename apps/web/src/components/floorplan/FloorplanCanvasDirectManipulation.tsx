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
type ElementLayer = ActiveLayer | "legacy";
type CanvasTool = "SELECT" | "PAN";
type Viewport = { x: number; y: number; scale: number };
type ClientPoint = { x: number; y: number };
type AlignmentGuides = { vertical: number[]; horizontal: number[] };
type AlignmentMatch = { delta: number; target: number };
type CanvasInputEvent = MouseEvent | TouchEvent;
type ElementOrigin = { x: number; y: number };

type ObjectDragState = {
  layerName: ElementLayer;
  primaryId: string;
  start: ClientPoint;
  viewport: Viewport;
  movingIds: string[];
  origins: Record<string, ElementOrigin>;
  latestDeltaX: number;
  latestDeltaY: number;
};

type PanState = {
  start: ClientPoint;
  viewport: Viewport;
};

const GRID_SIZE = 20;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const MIN_VISIBLE_SCENE_PX = 72;
const VIEWPORT_LOCK_AFTER_OBJECT_MS = 1400;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function nowMilliseconds() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function readClientPoint(event: CanvasInputEvent): ClientPoint | null {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}

function sameGuides(left: AlignmentGuides, right: AlignmentGuides) {
  return (
    left.vertical.length === right.vertical.length &&
    left.horizontal.length === right.horizontal.length &&
    left.vertical.every((value, index) => value === right.vertical[index]) &&
    left.horizontal.every((value, index) => value === right.horizontal[index])
  );
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

function elementWidth(element: FloorplanElement) {
  return Math.max(1, element.width ?? 120);
}

function elementHeight(element: FloorplanElement) {
  return Math.max(1, element.height ?? 100);
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
  const sceneGroupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const wheelFrameRef = useRef<number | null>(null);
  const objectDragRef = useRef<ObjectDragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const transformViewportRef = useRef<Viewport | null>(null);
  const viewportLockedUntilRef = useRef(0);
  const lastFloorIdRef = useRef(floorplan?.id ?? "floor");

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
    return selectedId ? [selectedId] : [];
  }, [selectedId, selectedIds]);
  const selectedIdSet = useMemo(() => new Set(resolvedSelectedIds), [resolvedSelectedIds]);
  const selectedElement = useMemo(() => {
    if (resolvedSelectedIds.length !== 1) return undefined;
    return allElements.find((element) => element.id === resolvedSelectedIds[0]);
  }, [allElements, resolvedSelectedIds]);
  const referenceShellElement = useMemo(
    () => resolvedShell.find((element) => element.visible !== false),
    [resolvedShell]
  );

  const constrainViewport = useCallback(
    (candidate: Viewport): Viewport => {
      const scale = clamp(finiteOr(candidate.scale, 1), MIN_SCALE, MAX_SCALE);
      const visibleX = Math.min(MIN_VISIBLE_SCENE_PX, Math.max(24, width / 3));
      const visibleY = Math.min(MIN_VISIBLE_SCENE_PX, Math.max(24, height / 3));
      return {
        x: clamp(
          finiteOr(candidate.x, 0),
          visibleX - contentWidth * scale,
          width - visibleX
        ),
        y: clamp(
          finiteOr(candidate.y, 0),
          visibleY - contentHeight * scale,
          height - visibleY
        ),
        scale,
      };
    },
    [contentHeight, contentWidth, height, width]
  );

  const setViewport = useCallback(
    (candidate: Viewport, force = false) => {
      if (
        !force &&
        (objectDragRef.current ||
          transformViewportRef.current ||
          nowMilliseconds() < viewportLockedUntilRef.current)
      ) {
        return;
      }
      const next = constrainViewport(candidate);
      viewRef.current = next;
      setView(next);
      onViewportChange?.(next);
    },
    [constrainViewport, onViewportChange]
  );

  const restoreViewport = useCallback(
    (snapshot: Viewport) => {
      const current = viewRef.current;
      if (
        Math.abs(current.x - snapshot.x) < 0.01 &&
        Math.abs(current.y - snapshot.y) < 0.01 &&
        Math.abs(current.scale - snapshot.scale) < 0.0001
      ) {
        return;
      }
      setViewport(snapshot, true);
    },
    [setViewport]
  );

  const fitView = useCallback(() => {
    const padding = width < 640 ? 24 : 48;
    const scale = clamp(
      Math.min(
        Math.max(1, width - padding * 2) / contentWidth,
        Math.max(1, height - padding * 2) / contentHeight
      ),
      MIN_SCALE,
      MAX_SCALE
    );
    setViewport({
      x: (width - contentWidth * scale) / 2,
      y: (height - contentHeight * scale) / 2,
      scale,
    });
  }, [contentHeight, contentWidth, height, setViewport, width]);

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const current = viewRef.current;
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const centerX = width / 2;
      const centerY = height / 2;
      const contentX = (centerX - current.x) / current.scale;
      const contentY = (centerY - current.y) / current.scale;
      setViewport({
        x: centerX - contentX * nextScale,
        y: centerY - contentY * nextScale,
        scale: nextScale,
      });
    },
    [height, setViewport, width]
  );

  const sourceForLayer = useCallback(
    (layerName: ElementLayer) =>
      layerName === "legacy"
        ? legacyElements
        : layerName === "shell"
          ? resolvedShell
          : resolvedLayout,
    [legacyElements, resolvedLayout, resolvedShell]
  );

  const commitLayerElements = useCallback(
    (layerName: ElementLayer, next: FloorplanElement[]) => {
      if (layerName === "legacy") {
        if (onChange && floorplan) onChange({ ...floorplan, elements: next });
      } else if (layerName === "shell") {
        onShellElementsChange?.(next);
      } else {
        onLayoutElementsChange?.(next);
      }
    },
    [floorplan, onChange, onLayoutElementsChange, onShellElementsChange]
  );

  const updateElement = useCallback(
    (layerName: ElementLayer, id: string, patch: Partial<FloorplanElement>) => {
      commitLayerElements(
        layerName,
        sourceForLayer(layerName).map((element) =>
          element.id === id ? { ...element, ...patch } : element
        )
      );
    },
    [commitLayerElements, sourceForLayer]
  );

  const selectElement = useCallback(
    (event: CanvasInputEvent, element: FloorplanElement, layerName: ElementLayer) => {
      const source = sourceForLayer(layerName);
      const mouseEvent = "button" in event ? event : null;
      const additive = Boolean(
        mouseEvent && (mouseEvent.shiftKey || mouseEvent.metaKey || mouseEvent.ctrlKey)
      );

      if (mode === "EDIT" && additive && onSelectIds) {
        const next = new Set(resolvedSelectedIds);
        if (next.has(element.id)) next.delete(element.id);
        else next.add(element.id);
        const ids = Array.from(next);
        onSelectIds(ids);
        onSelect?.(ids[0]);
        return ids;
      }

      const ids =
        mode === "EDIT" && element.groupId
          ? source
              .filter((candidate) => candidate.groupId === element.groupId)
              .map((candidate) => candidate.id)
          : [element.id];
      onSelect?.(element.id);
      onSelectIds?.(ids);
      return ids;
    },
    [mode, onSelect, onSelectIds, resolvedSelectedIds, sourceForLayer]
  );

  const beginObjectDrag = useCallback(
    (
      event: KonvaEventObject<CanvasInputEvent>,
      element: FloorplanElement,
      layerName: ElementLayer
    ) => {
      event.cancelBubble = true;
      const nativeEvent = event.evt;
      const point = readClientPoint(nativeEvent);
      if (!point) return;
      if ("button" in nativeEvent && nativeEvent.button !== 0) return;

      const ids = selectElement(nativeEvent, element, layerName);
      if (
        mode !== "EDIT" ||
        element.locked ||
        (layerName !== "legacy" && layerName !== activeLayer) ||
        isPanMode
      ) {
        return;
      }

      nativeEvent.preventDefault();
      const source = sourceForLayer(layerName);
      const requestedIds = element.groupId
        ? source
            .filter((candidate) => candidate.groupId === element.groupId)
            .map((candidate) => candidate.id)
        : selectedIdSet.has(element.id) && resolvedSelectedIds.length > 1
          ? resolvedSelectedIds
          : ids.length
            ? ids
            : [element.id];
      const movingIds = requestedIds.filter((id) => source.some((candidate) => candidate.id === id));
      const origins: Record<string, ElementOrigin> = {};
      source.forEach((candidate) => {
        if (movingIds.includes(candidate.id)) {
          origins[candidate.id] = { x: candidate.x, y: candidate.y };
        }
      });

      const viewport = { ...viewRef.current };
      objectDragRef.current = {
        layerName,
        primaryId: element.id,
        start: point,
        viewport,
        movingIds,
        origins,
        latestDeltaX: 0,
        latestDeltaY: 0,
      };
      panRef.current = null;
      viewportLockedUntilRef.current = Number.POSITIVE_INFINITY;
      setGuides({ vertical: [], horizontal: [] });
      setObjectDragging(true);
    },
    [activeLayer, isPanMode, mode, resolvedSelectedIds, selectElement, selectedIdSet, sourceForLayer]
  );

  const updateObjectDrag = useCallback(
    (point: ClientPoint) => {
      const drag = objectDragRef.current;
      const stage = stageRef.current;
      if (!drag || !stage) return;
      const source = sourceForLayer(drag.layerName);
      const primary = source.find((element) => element.id === drag.primaryId);
      const primaryOrigin = drag.origins[drag.primaryId];
      if (!primary || !primaryOrigin) return;

      const movingIdSet = new Set(drag.movingIds);
      const scale = Math.max(MIN_SCALE, drag.viewport.scale);
      let proposedX = snap(primaryOrigin.x + (point.x - drag.start.x) / scale);
      let proposedY = snap(primaryOrigin.y + (point.y - drag.start.y) / scale);
      const peers = allElements.filter(
        (candidate) => !movingIdSet.has(candidate.id) && candidate.visible !== false
      );
      const threshold = 6 / scale;
      const horizontalMatch = findAlignment(
        proposedX,
        elementWidth(primary),
        peers.map((candidate) => ({
          position: candidate.x,
          size: elementWidth(candidate),
        })),
        threshold
      );
      const verticalMatch = findAlignment(
        proposedY,
        elementHeight(primary),
        peers.map((candidate) => ({
          position: candidate.y,
          size: elementHeight(candidate),
        })),
        threshold
      );
      if (horizontalMatch) proposedX += horizontalMatch.delta;
      if (verticalMatch) proposedY += verticalMatch.delta;

      let deltaX = proposedX - primaryOrigin.x;
      let deltaY = proposedY - primaryOrigin.y;
      const movingElements = source.filter((candidate) => movingIdSet.has(candidate.id));
      const minimumDeltaX = Math.max(
        ...movingElements.map((candidate) => -drag.origins[candidate.id].x)
      );
      const maximumDeltaX = Math.min(
        ...movingElements.map(
          (candidate) =>
            contentWidth - drag.origins[candidate.id].x - elementWidth(candidate)
        )
      );
      const minimumDeltaY = Math.max(
        ...movingElements.map((candidate) => -drag.origins[candidate.id].y)
      );
      const maximumDeltaY = Math.min(
        ...movingElements.map(
          (candidate) =>
            contentHeight - drag.origins[candidate.id].y - elementHeight(candidate)
        )
      );
      deltaX = clamp(deltaX, minimumDeltaX, maximumDeltaX);
      deltaY = clamp(deltaY, minimumDeltaY, maximumDeltaY);

      drag.latestDeltaX = deltaX;
      drag.latestDeltaY = deltaY;
      drag.movingIds.forEach((id) => {
        const origin = drag.origins[id];
        const node = stage.findOne<Konva.Node>(`#node-${drag.layerName}-${id}`);
        if (origin && node) {
          node.position({ x: origin.x + deltaX, y: origin.y + deltaY });
        }
      });
      transformerRef.current?.forceUpdate();
      stage.batchDraw();

      const nextGuides: AlignmentGuides = {
        vertical: horizontalMatch ? [horizontalMatch.target] : [],
        horizontal: verticalMatch ? [verticalMatch.target] : [],
      };
      setGuides((current) => (sameGuides(current, nextGuides) ? current : nextGuides));
      restoreViewport(drag.viewport);
    },
    [allElements, contentHeight, contentWidth, restoreViewport, sourceForLayer]
  );

  const finishObjectDrag = useCallback(
    (commit: boolean) => {
      const drag = objectDragRef.current;
      if (!drag) return;
      objectDragRef.current = null;
      setObjectDragging(false);
      setGuides({ vertical: [], horizontal: [] });
      viewportLockedUntilRef.current = nowMilliseconds() + VIEWPORT_LOCK_AFTER_OBJECT_MS;
      restoreViewport(drag.viewport);

      if (!commit) {
        const stage = stageRef.current;
        drag.movingIds.forEach((id) => {
          const origin = drag.origins[id];
          const node = stage?.findOne<Konva.Node>(`#node-${drag.layerName}-${id}`);
          if (origin && node) node.position(origin);
        });
        transformerRef.current?.forceUpdate();
        stage?.batchDraw();
        return;
      }

      const movingIdSet = new Set(drag.movingIds);
      const next = sourceForLayer(drag.layerName).map((element) => {
        if (!movingIdSet.has(element.id)) return element;
        const origin = drag.origins[element.id];
        return origin
          ? {
              ...element,
              x: snap(origin.x + drag.latestDeltaX),
              y: snap(origin.y + drag.latestDeltaY),
            }
          : element;
      });
      commitLayerElements(drag.layerName, next);
    },
    [commitLayerElements, restoreViewport, sourceForLayer]
  );

  const updatePan = useCallback(
    (point: ClientPoint) => {
      const pan = panRef.current;
      if (!pan || objectDragRef.current) return;
      setViewport({
        x: pan.viewport.x + point.x - pan.start.x,
        y: pan.viewport.y + point.y - pan.start.y,
        scale: pan.viewport.scale,
      });
    },
    [setViewport]
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (objectDragRef.current) {
        event.preventDefault();
        updateObjectDrag({ x: event.clientX, y: event.clientY });
      } else if (panRef.current) {
        event.preventDefault();
        updatePan({ x: event.clientX, y: event.clientY });
      }
    };
    const handleTouchMove = (event: TouchEvent) => {
      const point = readClientPoint(event);
      if (!point) return;
      if (objectDragRef.current) {
        event.preventDefault();
        updateObjectDrag(point);
      } else if (panRef.current) {
        event.preventDefault();
        updatePan(point);
      }
    };
    const finish = () => {
      if (objectDragRef.current) finishObjectDrag(true);
      panRef.current = null;
    };
    const cancel = () => {
      if (objectDragRef.current) finishObjectDrag(false);
      panRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", finish);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", finish);
    window.addEventListener("touchcancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [finishObjectDrag, updateObjectDrag, updatePan]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
      if (event.code === "Escape" && objectDragRef.current) {
        event.preventDefault();
        finishObjectDrag(false);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [finishObjectDrag]);

  useEffect(() => {
    return () => {
      if (wheelFrameRef.current !== null) window.cancelAnimationFrame(wheelFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const floorId = floorplan?.id ?? "floor";
    if (lastFloorIdRef.current === floorId) return;
    if (objectDragRef.current) finishObjectDrag(false);
    lastFloorIdRef.current = floorId;
    panRef.current = null;
    setGuides({ vertical: [], horizontal: [] });
    viewportLockedUntilRef.current = 0;
    setViewport({ x: 0, y: 0, scale: 1 }, true);
  }, [finishObjectDrag, floorplan?.id, setViewport]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (mode !== "EDIT" || !resolvedSelectedIds.length) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
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

  const handleStagePointerDown = (event: KonvaEventObject<CanvasInputEvent>) => {
    const point = readClientPoint(event.evt);
    if (!point) return;
    if (isPanMode) {
      event.evt.preventDefault();
      panRef.current = { start: point, viewport: { ...viewRef.current } };
      return;
    }
    if (!event.target?.attrs?.elementId) {
      onSelect?.(undefined);
      onSelectIds?.([]);
      setGuides({ vertical: [], horizontal: [] });
    }
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    if (
      objectDragRef.current ||
      transformViewportRef.current ||
      nowMilliseconds() < viewportLockedUntilRef.current ||
      wheelFrameRef.current !== null
    ) {
      return;
    }
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) {
        wheelFrameRef.current = null;
        return;
      }
      const current = viewRef.current;
      const nextScale = clamp(
        event.evt.deltaY > 0 ? current.scale / 1.08 : current.scale * 1.08,
        MIN_SCALE,
        MAX_SCALE
      );
      const contentX = (pointer.x - current.x) / current.scale;
      const contentY = (pointer.y - current.y) / current.scale;
      setViewport({
        x: pointer.x - contentX * nextScale,
        y: pointer.y - contentY * nextScale,
        scale: nextScale,
      });
      wheelFrameRef.current = null;
    });
  };

  const beginTransform = (event: KonvaEventObject<Event>) => {
    event.cancelBubble = true;
    transformViewportRef.current = { ...viewRef.current };
    viewportLockedUntilRef.current = Number.POSITIVE_INFINITY;
    setObjectDragging(true);
  };

  const finishTransform = (event: KonvaEventObject<Event>, element: FloorplanElement, layerName: ElementLayer) => {
    event.cancelBubble = true;
    const viewportSnapshot = transformViewportRef.current ?? { ...viewRef.current };
    transformViewportRef.current = null;
    viewportLockedUntilRef.current = nowMilliseconds() + VIEWPORT_LOCK_AFTER_OBJECT_MS;
    setObjectDragging(false);
    setGuides({ vertical: [], horizontal: [] });

    const node = event.target as Konva.Group;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const patch: Partial<FloorplanElement> = {
      x: snap(node.x()),
      y: snap(node.y()),
      rotation: node.rotation(),
    };
    if (element.shape === "LINE" || element.shape === "POLY") {
      patch.points = (element.points ?? [0, 0, element.width ?? 80, 0]).map((value, index) =>
        snap(value * (index % 2 === 0 ? scaleX : scaleY))
      );
    } else {
      patch.width = Math.max(10, snap(elementWidth(element) * scaleX));
      patch.height = Math.max(10, snap(elementHeight(element) * scaleY));
    }
    updateElement(layerName, element.id, patch);
    restoreViewport(viewportSnapshot);
  };

  const renderElement = (element: FloorplanElement, layerName: ElementLayer) => {
    if (
      element.visible === false ||
      (mode === "SELECT" && element.meta?.customerVisible === false)
    ) {
      return null;
    }

    const isSelected = selectedIdSet.has(element.id);
    const editableLayer = layerName === "legacy" || layerName === activeLayer;
    const canEdit = mode === "EDIT" && editableLayer && !element.locked;
    const canSelect = mode === "SELECT" ? isBookable(element) && layerName !== "shell" : canEdit;
    const interactive = mode !== "VIEW" && (canEdit || canSelect || isPanMode);
    const baseFill =
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
    const fill =
      mode === "SELECT"
        ? !canSelect
          ? "#cbd5e1"
          : isSelected
            ? "#334155"
            : baseFill
        : baseFill;
    const stroke = element.stroke ?? (isSelected ? "#0f172a" : "#94a3b8");
    const strokeWidth = element.strokeWidth ?? (isSelected ? 3 : 1);
    const opacity = element.opacity ?? (mode === "SELECT" && !canSelect ? 0.45 : 1);

    const pointerDown = (event: KonvaEventObject<CanvasInputEvent>) => {
      if (isPanMode) return;
      if (mode === "SELECT" && !canSelect) return;
      beginObjectDrag(event, element, layerName);
    };

    return (
      <Group
        key={`${layerName}-${element.id}`}
        id={`node-${layerName}-${element.id}`}
        elementId={element.id}
        elementLayer={layerName}
        x={element.x}
        y={element.y}
        rotation={element.rotation ?? 0}
        opacity={opacity}
        listening={interactive}
        draggable={false}
        onMouseDown={(event) => pointerDown(event as KonvaEventObject<CanvasInputEvent>)}
        onTouchStart={(event) => pointerDown(event as KonvaEventObject<CanvasInputEvent>)}
        onTransformStart={beginTransform}
        onTransformEnd={(event) => finishTransform(event, element, layerName)}
      >
        {element.shape === "LINE" || element.shape === "POLY" ? (
          <Line
            points={element.points ?? [0, 0, element.width ?? 80, 0]}
            closed={element.shape === "POLY" ? element.closed ?? true : false}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ) : element.shape === "TEXT" ? (
          <Text
            width={element.width ?? 180}
            height={element.height ?? 50}
            text={element.label ?? "Text"}
            fontSize={Number(element.meta?.fontSize ?? 14)}
            fill={fill}
          />
        ) : element.shape === "ICON" ? (
          <Text
            width={element.width ?? 40}
            height={element.height ?? 40}
            text={String(element.meta?.icon ?? "⬤")}
            fontSize={Number(element.meta?.fontSize ?? 22)}
            fill={fill}
          />
        ) : (
          <Rect
            width={element.width ?? 120}
            height={element.height ?? 100}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            cornerRadius={element.type === "WALL" ? 2 : 10}
          />
        )}

        {element.label && element.shape !== "TEXT" && element.shape !== "ICON" ? (
          <Text
            x={8}
            y={8}
            width={Math.max(40, elementWidth(element) - 16)}
            text={element.label}
            fontSize={13}
            fontStyle={isSelected ? "bold" : "normal"}
            fill={isSelected && mode === "SELECT" ? "#ffffff" : "#1e293b"}
            listening={false}
          />
        ) : null}
      </Group>
    );
  };

  const viewportCommandAllowed =
    !objectDragging &&
    !objectDragRef.current &&
    !transformViewportRef.current &&
    nowMilliseconds() >= viewportLockedUntilRef.current;

  return (
    <div
      className="relative h-full min-h-[280px] w-full overflow-hidden bg-slate-100 shadow-inner ring-1 ring-inset ring-slate-200"
      role="group"
      aria-label={canvasLabel}
      data-testid="floorplan-canvas"
      data-drag-model="manual-client-delta"
      data-viewport-x={view.x.toFixed(2)}
      data-viewport-y={view.y.toFixed(2)}
      data-viewport-scale={view.scale.toFixed(4)}
      data-object-dragging={objectDragging ? "true" : "false"}
      data-reference-shell-screen-x={
        referenceShellElement
          ? (view.x + referenceShellElement.x * view.scale).toFixed(2)
          : ""
      }
      data-reference-shell-screen-y={
        referenceShellElement
          ? (view.y + referenceShellElement.y * view.scale).toFixed(2)
          : ""
      }
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
        onMouseDown={(event) =>
          handleStagePointerDown(event as KonvaEventObject<CanvasInputEvent>)
        }
        onTouchStart={(event) =>
          handleStagePointerDown(event as KonvaEventObject<CanvasInputEvent>)
        }
        onWheel={handleWheel}
        style={{ cursor: isPanMode ? "grab" : "default", touchAction: "none" }}
      >
        <Layer>
          <Group
            ref={sceneGroupRef}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            draggable={false}
          >
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
                  .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
                  .map((element) => renderElement(element, "legacy"))
              : null}
            {!usingLegacyModel
              ? resolvedShell
                  .slice()
                  .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
                  .map((element) => renderElement(element, "shell"))
              : null}
            {!usingLegacyModel
              ? resolvedLayout
                  .slice()
                  .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
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
          className={`absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur ${
            viewportCommandAllowed ? "opacity-100" : "pointer-events-none opacity-45"
          }`}
          aria-label="Canvas viewport controls"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => viewportCommandAllowed && zoomAtCenter(1 / 1.2)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span className="min-w-12 px-1 text-center text-xs font-semibold tabular-nums text-slate-600" aria-live="polite">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => viewportCommandAllowed && zoomAtCenter(1.2)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => viewportCommandAllowed && fitView()}
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
