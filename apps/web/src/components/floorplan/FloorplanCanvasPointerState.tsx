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
type ElementPosition = { x: number; y: number };
type PositionMap = Record<string, ElementPosition>;
type AlignmentGuides = { vertical: number[]; horizontal: number[] };
type AlignmentMatch = { delta: number; target: number };
type CanvasInputEvent = MouseEvent | TouchEvent;
type ContextElementType = "WALL" | "ROOM" | "SEAT" | "MODE_ZONE";

type ObjectDragState = {
  layerName: ElementLayer;
  primaryId: string;
  start: ClientPoint;
  viewport: Viewport;
  movingIds: string[];
  origins: PositionMap;
  latestDeltaX: number;
  latestDeltaY: number;
};

type PanState = {
  start: ClientPoint;
  viewport: Viewport;
};

type ContextMenuState = {
  kind: "BACKGROUND" | "OBJECT";
  x: number;
  y: number;
  logicalX: number;
  logicalY: number;
  layerName: ElementLayer;
  targetIds: string[];
};

const GRID_SIZE = 20;
const INCHES_PER_GRID = 12;
const MAJOR_GRID_EVERY = 5;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const MIN_VISIBLE_SCENE_PX = 72;
const POST_OBJECT_VIEWPORT_GUARD_MS = 500;
const SYNTHETIC_MOUSE_GUARD_MS = 900;
const CONTEXT_MENU_WIDTH = 232;
const CONTEXT_MENU_ESTIMATED_HEIGHT = 330;

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

function logicalToInches(logicalValue: number) {
  return (logicalValue / GRID_SIZE) * INCHES_PER_GRID;
}

function formatImperialLength(logicalValue: number) {
  const inches = Math.max(0, Math.round(logicalToInches(logicalValue)));
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  if (feet === 0) return `${remainder}″`;
  if (remainder === 0) return `${feet}′`;
  return `${feet}′ ${remainder}″`;
}

function areaSquareFeet(width: number, height: number) {
  return (logicalToInches(width) / 12) * (logicalToInches(height) / 12);
}

function formatSquareFeet(width: number, height: number) {
  return `${Math.round(areaSquareFeet(width, height)).toLocaleString()} sq ft`;
}

function makeContextToken(prefix: string) {
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${token}`;
}

function contextElementDefaults(type: ContextElementType) {
  if (type === "WALL") {
    return { width: 240, height: 20, label: "Wall", fill: "rgba(148,163,184,0.65)" };
  }
  if (type === "ROOM") {
    return { width: 260, height: 180, label: "Room", fill: "rgba(226,232,240,0.45)" };
  }
  if (type === "SEAT") {
    return { width: 100, height: 60, label: "Bookable desk", fill: "rgba(186,230,253,0.72)" };
  }
  return { width: 300, height: 220, label: "Room setup", fill: "rgba(191,219,254,0.52)" };
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const wheelFrameRef = useRef<number | null>(null);
  const objectDragRef = useRef<ObjectDragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const transformViewportRef = useRef<Viewport | null>(null);
  const viewportSuppressedUntilRef = useRef(0);
  const unlockTimerRef = useRef<number | null>(null);
  const lastTouchStartRef = useRef(Number.NEGATIVE_INFINITY);
  const lastFloorIdRef = useRef(floorplan?.id ?? "floor");

  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [guides, setGuides] = useState<AlignmentGuides>({ vertical: [], horizontal: [] });
  const [dragPositions, setDragPositions] = useState<PositionMap>({});
  const [objectDragging, setObjectDragging] = useState(false);
  const [viewportLocked, setViewportLocked] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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
  const referenceLayoutElement = useMemo(
    () => resolvedLayout.find((element) => element.visible !== false && isBookable(element)),
    [resolvedLayout]
  );
  const verticalGridLines = useMemo(
    () => Array.from({ length: Math.floor(contentWidth / GRID_SIZE) + 1 }, (_, index) => index * GRID_SIZE),
    [contentWidth]
  );
  const horizontalGridLines = useMemo(
    () => Array.from({ length: Math.floor(contentHeight / GRID_SIZE) + 1 }, (_, index) => index * GRID_SIZE),
    [contentHeight]
  );

  const renderedPosition = useCallback(
    (element: FloorplanElement): ElementPosition =>
      dragPositions[element.id] ?? { x: element.x, y: element.y },
    [dragPositions]
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
          nowMilliseconds() < viewportSuppressedUntilRef.current)
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

  const lockViewport = useCallback(() => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
    viewportSuppressedUntilRef.current = Number.POSITIVE_INFINITY;
    setViewportLocked(true);
  }, []);

  const releaseViewport = useCallback(() => {
    viewportSuppressedUntilRef.current = nowMilliseconds() + POST_OBJECT_VIEWPORT_GUARD_MS;
    if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = window.setTimeout(() => {
      viewportSuppressedUntilRef.current = 0;
      unlockTimerRef.current = null;
      setViewportLocked(false);
    }, POST_OBJECT_VIEWPORT_GUARD_MS + 40);
  }, []);

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

  const zoomTo100 = useCallback(() => {
    const current = viewRef.current;
    const centerX = width / 2;
    const centerY = height / 2;
    const contentX = (centerX - current.x) / current.scale;
    const contentY = (centerY - current.y) / current.scale;
    setViewport({
      x: centerX - contentX,
      y: centerY - contentY,
      scale: 1,
    });
  }, [height, setViewport, width]);

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

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

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

  const openContextMenu = useCallback(
    (
      event: KonvaEventObject<MouseEvent>,
      element?: FloorplanElement,
      layerName?: ElementLayer
    ) => {
      if (mode !== "EDIT") return;
      event.evt.preventDefault();
      event.cancelBubble = true;
      const wrapper = wrapperRef.current;
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!wrapper || !stage || !pointer) return;

      const rect = wrapper.getBoundingClientRect();
      const current = viewRef.current;
      const resolvedLayer: ElementLayer =
        layerName ?? (usingLegacyModel ? "legacy" : activeLayer);
      const source = sourceForLayer(resolvedLayer);
      const targetIds = element
        ? element.groupId
          ? source
              .filter((candidate) => candidate.groupId === element.groupId)
              .map((candidate) => candidate.id)
          : [element.id]
        : [];

      if (element) {
        onSelect?.(element.id);
        onSelectIds?.(targetIds);
      } else {
        onSelect?.(undefined);
        onSelectIds?.([]);
      }

      const localX = event.evt.clientX - rect.left;
      const localY = event.evt.clientY - rect.top;
      setContextMenu({
        kind: element ? "OBJECT" : "BACKGROUND",
        x: clamp(localX, 8, Math.max(8, rect.width - CONTEXT_MENU_WIDTH - 8)),
        y: clamp(localY, 8, Math.max(8, rect.height - CONTEXT_MENU_ESTIMATED_HEIGHT)),
        logicalX: (pointer.x - current.x) / current.scale,
        logicalY: (pointer.y - current.y) / current.scale,
        layerName: resolvedLayer,
        targetIds,
      });
    },
    [activeLayer, mode, onSelect, onSelectIds, sourceForLayer, usingLegacyModel]
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
      const touchInput = "touches" in nativeEvent;
      if (touchInput) lastTouchStartRef.current = nowMilliseconds();
      if (
        !touchInput &&
        nowMilliseconds() - lastTouchStartRef.current < SYNTHETIC_MOUSE_GUARD_MS
      ) {
        return;
      }
      if (
        "button" in nativeEvent &&
        (nativeEvent.button !== 0 || ("ctrlKey" in nativeEvent && nativeEvent.ctrlKey))
      ) {
        return;
      }

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
      closeContextMenu();
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
      const origins: PositionMap = {};
      source.forEach((candidate) => {
        if (movingIds.includes(candidate.id)) {
          origins[candidate.id] = { x: candidate.x, y: candidate.y };
        }
      });
      if (!origins[element.id]) return;

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
      lockViewport();
      setGuides({ vertical: [], horizontal: [] });
      setDragPositions(origins);
      setObjectDragging(true);
    },
    [
      activeLayer,
      closeContextMenu,
      isPanMode,
      lockViewport,
      mode,
      resolvedSelectedIds,
      selectElement,
      selectedIdSet,
      sourceForLayer,
    ]
  );

  const updateObjectDrag = useCallback(
    (point: ClientPoint) => {
      const drag = objectDragRef.current;
      if (!drag) return;
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
      if (!movingElements.length) return;
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
      const nextPositions: PositionMap = {};
      drag.movingIds.forEach((id) => {
        const origin = drag.origins[id];
        if (origin) {
          nextPositions[id] = { x: origin.x + deltaX, y: origin.y + deltaY };
        }
      });
      setDragPositions(nextPositions);
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
      restoreViewport(drag.viewport);

      if (commit) {
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
      }

      setDragPositions({});
      setGuides({ vertical: [], horizontal: [] });
      setObjectDragging(false);
      releaseViewport();
    },
    [commitLayerElements, releaseViewport, restoreViewport, sourceForLayer]
  );

  const updatePan = useCallback(
    (point: ClientPoint) => {
      const pan = panRef.current;
      if (!pan || objectDragRef.current || viewportLocked) return;
      setViewport({
        x: pan.viewport.x + point.x - pan.start.x,
        y: pan.viewport.y + point.y - pan.start.y,
        scale: pan.viewport.scale,
      });
    },
    [setViewport, viewportLocked]
  );

  const contextTargets = useMemo(() => {
    if (!contextMenu || contextMenu.kind !== "OBJECT") return [];
    const ids = new Set(contextMenu.targetIds);
    return sourceForLayer(contextMenu.layerName).filter((element) => ids.has(element.id));
  }, [contextMenu, sourceForLayer]);
  const contextTargetsAllLocked =
    contextTargets.length > 0 && contextTargets.every((element) => element.locked);

  const duplicateContextTargets = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== "OBJECT") return;
    const source = sourceForLayer(contextMenu.layerName);
    const targetSet = new Set(contextMenu.targetIds);
    const groupMap = new Map<string, string>();
    const duplicates = source
      .filter((element) => targetSet.has(element.id))
      .map((element) => {
        let nextGroupId = element.groupId;
        if (element.groupId) {
          nextGroupId = groupMap.get(element.groupId);
          if (!nextGroupId) {
            nextGroupId = makeContextToken("group");
            groupMap.set(element.groupId, nextGroupId);
          }
        }
        return {
          ...element,
          id: makeContextToken(element.type.toLowerCase()),
          groupId: nextGroupId,
          resourceId: element.resourceId
            ? `${element.resourceId}-copy-${Math.random().toString(36).slice(2, 6)}`
            : undefined,
          x: clamp(
            snap(element.x + GRID_SIZE),
            0,
            Math.max(0, contentWidth - elementWidth(element))
          ),
          y: clamp(
            snap(element.y + GRID_SIZE),
            0,
            Math.max(0, contentHeight - elementHeight(element))
          ),
          meta: element.meta ? { ...element.meta } : undefined,
          points: element.points ? [...element.points] : undefined,
        } satisfies FloorplanElement;
      });
    if (!duplicates.length) return;
    commitLayerElements(contextMenu.layerName, [...source, ...duplicates]);
    onSelect?.(duplicates[0]?.id);
    onSelectIds?.(duplicates.map((element) => element.id));
    closeContextMenu();
  }, [
    closeContextMenu,
    commitLayerElements,
    contentHeight,
    contentWidth,
    contextMenu,
    onSelect,
    onSelectIds,
    sourceForLayer,
  ]);

  const setContextTargetsLocked = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== "OBJECT") return;
    const source = sourceForLayer(contextMenu.layerName);
    const targetSet = new Set(contextMenu.targetIds);
    const nextLocked = !source
      .filter((element) => targetSet.has(element.id))
      .every((element) => element.locked);
    commitLayerElements(
      contextMenu.layerName,
      source.map((element) =>
        targetSet.has(element.id)
          ? { ...element, locked: nextLocked ? true : undefined }
          : element
      )
    );
    closeContextMenu();
  }, [closeContextMenu, commitLayerElements, contextMenu, sourceForLayer]);

  const hideContextTargets = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== "OBJECT") return;
    const source = sourceForLayer(contextMenu.layerName);
    const targetSet = new Set(contextMenu.targetIds);
    commitLayerElements(
      contextMenu.layerName,
      source.map((element) =>
        targetSet.has(element.id) ? { ...element, visible: false } : element
      )
    );
    onSelect?.(undefined);
    onSelectIds?.([]);
    closeContextMenu();
  }, [closeContextMenu, commitLayerElements, contextMenu, onSelect, onSelectIds, sourceForLayer]);

  const moveContextTargetsInLayer = useCallback(
    (direction: "FRONT" | "BACK") => {
      if (!contextMenu || contextMenu.kind !== "OBJECT") return;
      const source = sourceForLayer(contextMenu.layerName);
      const targetSet = new Set(contextMenu.targetIds);
      const zValues = source.map((element) => element.zIndex ?? 0);
      const anchor =
        direction === "FRONT" ? Math.max(0, ...zValues) + 1 : Math.min(0, ...zValues) - contextMenu.targetIds.length;
      let offset = 0;
      commitLayerElements(
        contextMenu.layerName,
        source.map((element) => {
          if (!targetSet.has(element.id)) return element;
          const zIndex = anchor + offset;
          offset += 1;
          return { ...element, zIndex };
        })
      );
      closeContextMenu();
    },
    [closeContextMenu, commitLayerElements, contextMenu, sourceForLayer]
  );

  const deleteContextTargets = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== "OBJECT") return;
    const targetSet = new Set(contextMenu.targetIds);
    commitLayerElements(
      contextMenu.layerName,
      sourceForLayer(contextMenu.layerName).filter((element) => !targetSet.has(element.id))
    );
    onSelect?.(undefined);
    onSelectIds?.([]);
    closeContextMenu();
  }, [closeContextMenu, commitLayerElements, contextMenu, onSelect, onSelectIds, sourceForLayer]);

  const addContextElement = useCallback(
    (type: ContextElementType) => {
      if (!contextMenu || contextMenu.kind !== "BACKGROUND") return;
      const defaults = contextElementDefaults(type);
      const x = clamp(
        snap(contextMenu.logicalX - defaults.width / 2),
        0,
        Math.max(0, contentWidth - defaults.width)
      );
      const y = clamp(
        snap(contextMenu.logicalY - defaults.height / 2),
        0,
        Math.max(0, contentHeight - defaults.height)
      );
      const element: FloorplanElement = {
        id: makeContextToken(type.toLowerCase()),
        type,
        shape: "RECT",
        label: defaults.label,
        x,
        y,
        width: defaults.width,
        height: defaults.height,
        rotation: 0,
        fill: defaults.fill,
        visible: true,
        resourceId:
          type === "SEAT"
            ? makeContextToken("seat-desk")
            : type === "MODE_ZONE"
              ? makeContextToken("mode-room")
              : undefined,
        meta:
          type === "SEAT"
            ? { capacity: 1, customerVisible: true, powerAvailable: true }
            : type === "MODE_ZONE"
              ? {
                  capacity: 6,
                  arrangement: "Boardroom",
                  customerVisible: true,
                  videoConferencing: false,
                  display: false,
                  whiteboard: false,
                  addOnIds: [],
                }
              : undefined,
      };
      const source = sourceForLayer(contextMenu.layerName);
      commitLayerElements(contextMenu.layerName, [...source, element]);
      onSelect?.(element.id);
      onSelectIds?.([element.id]);
      closeContextMenu();
    },
    [
      closeContextMenu,
      commitLayerElements,
      contentHeight,
      contentWidth,
      contextMenu,
      onSelect,
      onSelectIds,
      sourceForLayer,
    ]
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
      if (event.code === "Escape") {
        if (contextMenu) {
          event.preventDefault();
          closeContextMenu();
          return;
        }
        if (objectDragRef.current) {
          event.preventDefault();
          finishObjectDrag(false);
        }
      }
      if (contextMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const items = Array.from(
          contextMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []
        );
        if (!items.length) return;
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + items.length) % items.length;
        items[nextIndex]?.focus();
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
  }, [closeContextMenu, contextMenu, finishObjectDrag]);

  useEffect(() => {
    if (!contextMenu) return;
    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu]);

  useEffect(() => {
    return () => {
      if (wheelFrameRef.current !== null) window.cancelAnimationFrame(wheelFrameRef.current);
      if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const floorId = floorplan?.id ?? "floor";
    if (lastFloorIdRef.current === floorId) return;
    if (objectDragRef.current) finishObjectDrag(false);
    lastFloorIdRef.current = floorId;
    panRef.current = null;
    setDragPositions({});
    setGuides({ vertical: [], horizontal: [] });
    setContextMenu(null);
    viewportSuppressedUntilRef.current = 0;
    setViewportLocked(false);
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
  }, [dragPositions, mode, resolvedSelectedIds]);

  const handleStagePointerDown = (event: KonvaEventObject<CanvasInputEvent>) => {
    const point = readClientPoint(event.evt);
    if (!point) return;
    if (isPanMode && !viewportLocked) {
      event.evt.preventDefault();
      closeContextMenu();
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
    closeContextMenu();
    if (
      viewportLocked ||
      objectDragRef.current ||
      transformViewportRef.current ||
      nowMilliseconds() < viewportSuppressedUntilRef.current ||
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
    closeContextMenu();
    transformViewportRef.current = { ...viewRef.current };
    lockViewport();
    setObjectDragging(true);
  };

  const finishTransform = (
    event: KonvaEventObject<Event>,
    element: FloorplanElement,
    layerName: ElementLayer
  ) => {
    event.cancelBubble = true;
    const viewportSnapshot = transformViewportRef.current ?? { ...viewRef.current };
    transformViewportRef.current = null;
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
      patch.points = (element.points ?? [0, 0, element.width ?? 80, 0]).map(
        (value, index) => snap(value * (index % 2 === 0 ? scaleX : scaleY))
      );
    } else {
      patch.width = Math.max(10, snap(elementWidth(element) * scaleX));
      patch.height = Math.max(10, snap(elementHeight(element) * scaleY));
    }
    updateElement(layerName, element.id, patch);
    restoreViewport(viewportSnapshot);
    setObjectDragging(false);
    releaseViewport();
  };

  const renderElement = (element: FloorplanElement, layerName: ElementLayer) => {
    if (
      element.visible === false ||
      (mode === "SELECT" && element.meta?.customerVisible === false)
    ) {
      return null;
    }

    const position = renderedPosition(element);
    const isSelected = selectedIdSet.has(element.id);
    const editableLayer = layerName === "legacy" || layerName === activeLayer;
    const canEdit = mode === "EDIT" && editableLayer && !element.locked;
    const canContext = mode === "EDIT" && editableLayer;
    const canSelect = mode === "SELECT" ? isBookable(element) && layerName !== "shell" : canEdit;
    const interactive = mode !== "VIEW" && (canEdit || canSelect || isPanMode || canContext);
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
        x={position.x}
        y={position.y}
        rotation={element.rotation ?? 0}
        opacity={opacity}
        listening={interactive}
        draggable={false}
        onMouseDown={(event) => pointerDown(event as KonvaEventObject<CanvasInputEvent>)}
        onTouchStart={(event) => pointerDown(event as KonvaEventObject<CanvasInputEvent>)}
        onContextMenu={(event) =>
          openContextMenu(event as KonvaEventObject<MouseEvent>, element, layerName)
        }
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

  const referenceLayoutPosition = referenceLayoutElement
    ? renderedPosition(referenceLayoutElement)
    : undefined;
  const viewportCommandsAllowed = !viewportLocked && !objectDragging;
  const scaleBarFeet = view.scale < 0.6 ? 10 : view.scale > 1.6 ? 2 : 5;
  const scaleBarWidth = scaleBarFeet * GRID_SIZE * view.scale;
  const designAreaLabel = `${formatImperialLength(contentWidth)} × ${formatImperialLength(contentHeight)} · ${formatSquareFeet(contentWidth, contentHeight)}`;
  const selectedDimensionLabel =
    selectedElement && selectedElement.shape !== "LINE" && selectedElement.shape !== "POLY"
      ? `${formatImperialLength(elementWidth(selectedElement))} × ${formatImperialLength(elementHeight(selectedElement))} · ${formatSquareFeet(elementWidth(selectedElement), elementHeight(selectedElement))}`
      : undefined;
  const backgroundContextUsesShell = contextMenu?.layerName === "shell";

  return (
    <div
      ref={wrapperRef}
      className="relative h-full min-h-[280px] w-full overflow-hidden bg-slate-100 shadow-inner ring-1 ring-inset ring-slate-200"
      role="group"
      aria-label={canvasLabel}
      data-testid="floorplan-canvas"
      data-drag-model="react-pointer-delta"
      data-grid-unit="12-inches"
      data-grid-square-feet="1"
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
      data-reference-layout-id={referenceLayoutElement?.id ?? ""}
      data-reference-layout-logical-x={referenceLayoutPosition?.x.toFixed(2) ?? ""}
      data-reference-layout-logical-y={referenceLayoutPosition?.y.toFixed(2) ?? ""}
      data-reference-layout-screen-x={
        referenceLayoutPosition
          ? (view.x + referenceLayoutPosition.x * view.scale).toFixed(2)
          : ""
      }
      data-reference-layout-screen-y={
        referenceLayoutPosition
          ? (view.y + referenceLayoutPosition.y * view.scale).toFixed(2)
          : ""
      }
      style={{ touchAction: "none" }}
    >
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
        onContextMenu={(event) => openContextMenu(event as KonvaEventObject<MouseEvent>)}
        onWheel={handleWheel}
        style={{ cursor: isPanMode ? "grab" : "default", touchAction: "none" }}
      >
        <Layer>
          <Group
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

            {verticalGridLines.map((gridX, index) => {
              const major = index % MAJOR_GRID_EVERY === 0;
              return (
                <React.Fragment key={`grid-v-${gridX}`}>
                  <Line
                    points={[gridX, 0, gridX, contentHeight]}
                    stroke={major ? "#aeb9c8" : "#d8dee8"}
                    strokeWidth={(major ? 1.15 : 0.7) / view.scale}
                    opacity={major ? 0.78 : 0.72}
                    listening={false}
                  />
                  {major && index > 0 ? (
                    <Text
                      x={gridX + 4 / view.scale}
                      y={4 / view.scale}
                      text={`${index}′`}
                      fontSize={10 / view.scale}
                      fill="#64748b"
                      opacity={0.8}
                      listening={false}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
            {horizontalGridLines.map((gridY, index) => {
              const major = index % MAJOR_GRID_EVERY === 0;
              return (
                <React.Fragment key={`grid-h-${gridY}`}>
                  <Line
                    points={[0, gridY, contentWidth, gridY]}
                    stroke={major ? "#aeb9c8" : "#d8dee8"}
                    strokeWidth={(major ? 1.15 : 0.7) / view.scale}
                    opacity={major ? 0.78 : 0.72}
                    listening={false}
                  />
                  {major && index > 0 ? (
                    <Text
                      x={4 / view.scale}
                      y={gridY + 4 / view.scale}
                      text={`${index}′`}
                      fontSize={10 / view.scale}
                      fill="#64748b"
                      opacity={0.8}
                      listening={false}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}

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

      <div
        className="pointer-events-none absolute bottom-3 left-3 max-w-[min(22rem,calc(100%-7rem))] rounded-2xl bg-white/94 px-3 py-2.5 text-xs text-slate-600 shadow-lg ring-1 ring-slate-200 backdrop-blur"
        role="status"
        aria-label={`Physical scale. Each grid square is one foot by one foot. Design area ${designAreaLabel}.`}
        data-testid="floorplan-scale"
      >
        <div className="font-semibold text-slate-800">Grid · 1 square = 1 ft × 1 ft</div>
        <div className="mt-1.5 flex items-end gap-2">
          <span
            className="block border-b-2 border-x border-slate-700"
            style={{ width: `${scaleBarWidth}px`, height: "7px" }}
            aria-hidden="true"
          />
          <span className="whitespace-nowrap font-medium text-slate-700">{scaleBarFeet} ft</span>
        </div>
        <div className="mt-1 text-[11px] leading-4 text-slate-500">Design area {designAreaLabel}</div>
      </div>

      {mode === "EDIT" && resolvedSelectedIds.length > 0 ? (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[min(28rem,calc(100%-1.5rem))] rounded-2xl bg-white/92 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur">
          <div className="truncate">
            {resolvedSelectedIds.length === 1
              ? selectedElement?.label || "1 object selected"
              : `${resolvedSelectedIds.length} objects selected`}
          </div>
          {resolvedSelectedIds.length === 1 && selectedDimensionLabel ? (
            <div className="mt-0.5 text-[11px] font-normal text-slate-500">{selectedDimensionLabel}</div>
          ) : null}
        </div>
      ) : null}

      {showViewportControls ? (
        <div
          className={`absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur ${
            viewportCommandsAllowed ? "opacity-100" : "pointer-events-none opacity-45"
          }`}
          aria-label="Canvas viewport controls"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => viewportCommandsAllowed && zoomAtCenter(1 / 1.2)}
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
            onClick={() => viewportCommandsAllowed && zoomAtCenter(1.2)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => viewportCommandsAllowed && fitView()}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            aria-label="Fit floor plan in view"
            title="Fit floor plan"
          >
            Fit
          </button>
        </div>
      ) : null}

      {contextMenu ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-40 cursor-default"
            onClick={closeContextMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              closeContextMenu();
            }}
            aria-label="Close context menu"
          />
          <div
            ref={contextMenuRef}
            role="menu"
            aria-label={contextMenu.kind === "OBJECT" ? "Object actions" : "Canvas actions"}
            data-testid="floorplan-context-menu"
            className="absolute z-50 w-[232px] overflow-hidden rounded-2xl bg-white/98 py-1.5 text-sm shadow-2xl ring-1 ring-slate-200 backdrop-blur"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.kind === "BACKGROUND" ? (
              <>
                <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  {backgroundContextUsesShell ? "Floor plan" : "Setup"}
                </div>
                {backgroundContextUsesShell ? (
                  <>
                    <ContextMenuButton onClick={() => addContextElement("WALL")}>Add wall here</ContextMenuButton>
                    <ContextMenuButton onClick={() => addContextElement("ROOM")}>Add room here</ContextMenuButton>
                  </>
                ) : (
                  <>
                    <ContextMenuButton onClick={() => addContextElement("SEAT")}>Add desk here</ContextMenuButton>
                    <ContextMenuButton onClick={() => addContextElement("MODE_ZONE")}>Add room setup here</ContextMenuButton>
                  </>
                )}
                <ContextMenuSeparator />
                <ContextMenuButton
                  onClick={() => {
                    fitView();
                    closeContextMenu();
                  }}
                >
                  Fit floor plan
                </ContextMenuButton>
                <ContextMenuButton
                  onClick={() => {
                    zoomTo100();
                    closeContextMenu();
                  }}
                >
                  Zoom to 100%
                </ContextMenuButton>
              </>
            ) : (
              <>
                <ContextMenuButton onClick={duplicateContextTargets}>Duplicate</ContextMenuButton>
                <ContextMenuButton onClick={setContextTargetsLocked}>
                  {contextTargetsAllLocked ? "Unlock" : "Lock"}
                </ContextMenuButton>
                <ContextMenuButton onClick={() => moveContextTargetsInLayer("FRONT")}>
                  Bring to front
                </ContextMenuButton>
                <ContextMenuButton onClick={() => moveContextTargetsInLayer("BACK")}>
                  Send to back
                </ContextMenuButton>
                <ContextMenuButton onClick={hideContextTargets}>Hide</ContextMenuButton>
                <ContextMenuSeparator />
                <ContextMenuButton destructive onClick={deleteContextTargets}>Delete</ContextMenuButton>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ContextMenuSeparator() {
  return <div className="my-1 border-t border-slate-100" role="separator" />;
}

function ContextMenuButton({
  children,
  onClick,
  destructive = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex min-h-10 w-full items-center px-3 text-left text-sm font-medium outline-none transition focus:bg-slate-100 ${
        destructive
          ? "text-rose-700 hover:bg-rose-50 focus:bg-rose-50"
          : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
