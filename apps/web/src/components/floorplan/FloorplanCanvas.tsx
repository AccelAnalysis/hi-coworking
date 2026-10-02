"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { FloorplanElement } from "@hi/shared";
import "./FloorplanCanvasViewportDiagnostic";
import { FloorplanCanvas as PointerStateCanvas } from "./FloorplanCanvasPointerState";

type FloorplanCanvasProps = ComponentProps<typeof PointerStateCanvas>;
type FallbackMenu = {
  x: number;
  y: number;
  logicalX: number;
  logicalY: number;
};

const GRID_SIZE = 20;
const FALLBACK_MENU_WIDTH = 232;
const FALLBACK_MENU_HEIGHT = 360;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function elementWidth(element: FloorplanElement) {
  return Math.max(1, element.width ?? 120);
}

function elementHeight(element: FloorplanElement) {
  return Math.max(1, element.height ?? 100);
}

export function FloorplanCanvas(props: FloorplanCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const [fallbackMenu, setFallbackMenu] = useState<FallbackMenu | null>(null);

  const selectedIds = props.selectedIds?.length
    ? props.selectedIds
    : props.selectedId
      ? [props.selectedId]
      : [];
  const usingLegacyModel = !props.shellElements && !props.layoutElements;
  const activeLayer = usingLegacyModel ? "legacy" : props.activeLayer ?? "layout";
  const source =
    activeLayer === "legacy"
      ? props.floorplan?.elements ?? []
      : activeLayer === "shell"
        ? props.shellElements ?? []
        : props.layoutElements ?? [];
  const selectedElements = source.filter((element) => selectedIds.includes(element.id));

  useEffect(() => {
    const close = () => setFallbackMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  function commit(next: FloorplanElement[]) {
    if (activeLayer === "legacy") {
      if (props.onChange && props.floorplan) props.onChange({ ...props.floorplan, elements: next });
      return;
    }
    if (activeLayer === "shell") props.onShellElementsChange?.(next);
    else props.onLayoutElementsChange?.(next);
  }

  function select(ids: string[]) {
    props.onSelect?.(ids[0]);
    props.onSelectIds?.(ids);
  }

  function duplicateSelected() {
    if (!selectedElements.length) return;
    const groupMap = new Map<string, string>();
    const duplicates = selectedElements.map((element) => {
      let groupId = element.groupId;
      if (element.groupId) {
        groupId = groupMap.get(element.groupId);
        if (!groupId) {
          groupId = uid("group");
          groupMap.set(element.groupId, groupId);
        }
      }
      return {
        ...element,
        id: uid(element.type.toLowerCase()),
        groupId,
        resourceId: element.resourceId ? `${element.resourceId}-copy-${Math.random().toString(36).slice(2, 6)}` : undefined,
        x: element.x + GRID_SIZE,
        y: element.y + GRID_SIZE,
        meta: element.meta ? { ...element.meta } : undefined,
        points: element.points ? [...element.points] : undefined,
      } satisfies FloorplanElement;
    });
    commit([...source, ...duplicates]);
    select(duplicates.map((element) => element.id));
    setFallbackMenu(null);
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    const targetIds = new Set(selectedIds);
    commit(source.filter((element) => !targetIds.has(element.id)));
    select([]);
    setFallbackMenu(null);
  }

  function toggleSelectedLocked() {
    if (!selectedElements.length) return;
    const targetIds = new Set(selectedIds);
    const nextLocked = !selectedElements.every((element) => element.locked);
    commit(
      source.map((element) =>
        targetIds.has(element.id)
          ? { ...element, locked: nextLocked ? true : undefined }
          : element
      )
    );
    setFallbackMenu(null);
  }

  function addAtContext(type: "WALL" | "ROOM" | "SEAT" | "MODE_ZONE") {
    if (!fallbackMenu) return;
    const defaults =
      type === "WALL"
        ? { width: 240, height: 20, label: "Wall", fill: "rgba(148,163,184,0.65)" }
        : type === "ROOM"
          ? { width: 260, height: 180, label: "Room", fill: "rgba(226,232,240,0.45)" }
          : type === "SEAT"
            ? { width: 100, height: 60, label: "Bookable desk", fill: "rgba(186,230,253,0.72)" }
            : { width: 300, height: 220, label: "Room setup", fill: "rgba(191,219,254,0.52)" };
    const contentWidth = props.floorplan?.canvasWidth ?? 1100;
    const contentHeight = props.floorplan?.canvasHeight ?? 650;
    const element: FloorplanElement = {
      id: uid(type.toLowerCase()),
      type,
      shape: "RECT",
      label: defaults.label,
      x: clamp(snap(fallbackMenu.logicalX - defaults.width / 2), 0, Math.max(0, contentWidth - defaults.width)),
      y: clamp(snap(fallbackMenu.logicalY - defaults.height / 2), 0, Math.max(0, contentHeight - defaults.height)),
      width: defaults.width,
      height: defaults.height,
      rotation: 0,
      fill: defaults.fill,
      visible: true,
      resourceId:
        type === "SEAT"
          ? uid("seat-desk")
          : type === "MODE_ZONE"
            ? uid("mode-room")
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
    commit([...source, element]);
    select([element.id]);
    setFallbackMenu(null);
  }

  function handleNativeContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (props.mode !== "EDIT") return;
    const wrapper = wrapperRef.current;
    const canvas = wrapper?.querySelector<HTMLElement>("[data-testid='floorplan-canvas']");
    if (!wrapper || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const viewX = Number(canvas.dataset.viewportX ?? 0);
    const viewY = Number(canvas.dataset.viewportY ?? 0);
    const scale = Number(canvas.dataset.viewportScale ?? 1) || 1;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const logicalX = (localX - viewX) / scale;
    const logicalY = (localY - viewY) / scale;

    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null;
      if (wrapper.querySelector("[data-testid='floorplan-context-menu']")) return;
      setFallbackMenu({
        x: clamp(localX, 8, Math.max(8, rect.width - FALLBACK_MENU_WIDTH - 8)),
        y: clamp(localY, 8, Math.max(8, rect.height - FALLBACK_MENU_HEIGHT)),
        logicalX,
        logicalY,
      });
    }, 32);
  }

  const selectedAllLocked = selectedElements.length > 0 && selectedElements.every((element) => element.locked);
  const shellContext = activeLayer === "shell";

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      data-testid="floorplan-browser-context-guard"
      onContextMenu={handleNativeContextMenu}
    >
      <PointerStateCanvas {...props} />

      {fallbackMenu ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-[60] cursor-default"
            onClick={() => setFallbackMenu(null)}
            aria-label="Close fallback context menu"
          />
          <div
            role="menu"
            aria-label="Canvas context actions"
            data-testid="floorplan-native-context-fallback"
            className="absolute z-[70] w-[232px] overflow-hidden rounded-2xl bg-white py-1.5 text-sm shadow-2xl ring-1 ring-slate-200"
            style={{ left: fallbackMenu.x, top: fallbackMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {selectedElements.length ? (
              <>
                <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Selected object</div>
                <FallbackItem onClick={duplicateSelected}>Duplicate</FallbackItem>
                <FallbackItem onClick={toggleSelectedLocked}>{selectedAllLocked ? "Unlock" : "Lock"}</FallbackItem>
                <FallbackItem destructive onClick={deleteSelected}>Delete</FallbackItem>
                <div className="my-1 border-t border-slate-100" role="separator" />
              </>
            ) : null}

            <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{shellContext ? "Floor plan" : "Setup"}</div>
            {shellContext ? (
              <>
                <FallbackItem onClick={() => addAtContext("WALL")}>Add wall here</FallbackItem>
                <FallbackItem onClick={() => addAtContext("ROOM")}>Add room here</FallbackItem>
              </>
            ) : (
              <>
                <FallbackItem onClick={() => addAtContext("SEAT")}>Add desk here</FallbackItem>
                <FallbackItem onClick={() => addAtContext("MODE_ZONE")}>Add room setup here</FallbackItem>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function FallbackItem({
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
      className={`flex min-h-11 w-full items-center px-3 text-left text-sm font-medium outline-none transition focus-visible:bg-slate-100 ${
        destructive ? "text-rose-700 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
