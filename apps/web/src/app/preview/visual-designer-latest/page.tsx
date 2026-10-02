"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  Hand,
  Info,
  MousePointer2,
  Plus,
  Ruler,
  Settings2,
  X,
} from "lucide-react";
import { FloorplanCanvas } from "@/components/floorplan/FloorplanCanvas";
import type { FloorplanElement, FloorplanElementType } from "@hi/shared";

type LayerMode = "SHELL" | "LAYOUT";
type ToolMode = "SELECT" | "PAN";

const FLOORPLAN = {
  id: "preview-latest-floor",
  name: "Level 1",
  levelIndex: 0,
  canvasWidth: 1100,
  canvasHeight: 650,
  elements: [],
};

const INITIAL_SHELL: FloorplanElement[] = [
  { id: "north-wall", type: "WALL", shape: "RECT", label: "North wall", x: 80, y: 70, width: 940, height: 20, rotation: 0, fill: "#cbd5e1" },
  { id: "south-wall", type: "WALL", shape: "RECT", label: "South wall", x: 80, y: 550, width: 940, height: 20, rotation: 0, fill: "#cbd5e1" },
  { id: "west-wall", type: "WALL", shape: "RECT", label: "West wall", x: 80, y: 70, width: 20, height: 500, rotation: 0, fill: "#cbd5e1" },
  { id: "east-wall", type: "WALL", shape: "RECT", label: "East wall", x: 1000, y: 70, width: 20, height: 500, rotation: 0, fill: "#cbd5e1" },
  { id: "main-door", type: "DOOR", shape: "RECT", label: "Main entrance", x: 150, y: 545, width: 100, height: 20, rotation: 0, fill: "#94a3b8", meta: { doorType: "PIN_CODE", isAdaAccessible: true } },
];

const INITIAL_LAYOUT: FloorplanElement[] = [
  {
    id: "boardroom-zone",
    type: "MODE_ZONE",
    shape: "RECT",
    label: "Boardroom",
    resourceId: "mode-boardroom-preview-latest",
    x: 300,
    y: 150,
    width: 500,
    height: 320,
    rotation: 0,
    fill: "rgba(219,234,254,0.52)",
    stroke: "#64748b",
    strokeWidth: 2,
    meta: { capacity: 10, arrangement: "Boardroom", customerVisible: true, videoConferencing: true, display: true, whiteboard: true },
  },
  { id: "conference-table", type: "FURNITURE", shape: "RECT", label: "Conference table", x: 420, y: 260, width: 260, height: 120, rotation: 0, fill: "#e2e8f0", meta: { role: "table" } },
  { id: "window-desk", type: "SEAT", shape: "RECT", label: "Window desk", resourceId: "seat-window-preview-latest", x: 140, y: 150, width: 100, height: 60, rotation: 0, fill: "rgba(209,250,229,0.9)", meta: { capacity: 1, customerVisible: true, powerAvailable: true, monitor: true } },
  { id: "focus-desk", type: "SEAT", shape: "RECT", label: "Focus desk", resourceId: "seat-focus-preview-latest", x: 140, y: 260, width: 100, height: 60, rotation: 0, fill: "rgba(209,250,229,0.9)", meta: { capacity: 1, customerVisible: true, powerAvailable: true } },
];

const ADD_ITEMS: Array<{ type: FloorplanElementType; label: string; layer: LayerMode }> = [
  { type: "WALL", label: "Wall", layer: "SHELL" },
  { type: "ROOM", label: "Room", layer: "SHELL" },
  { type: "DOOR", label: "Door", layer: "SHELL" },
  { type: "WINDOW", label: "Window", layer: "SHELL" },
  { type: "DESK", label: "Desk", layer: "LAYOUT" },
  { type: "SEAT", label: "Bookable seat", layer: "LAYOUT" },
  { type: "MODE_ZONE", label: "Room setup", layer: "LAYOUT" },
  { type: "FURNITURE", label: "Furniture", layer: "LAYOUT" },
  { type: "AMENITY", label: "Amenity", layer: "LAYOUT" },
  { type: "POWER", label: "Power outlet", layer: "LAYOUT" },
  { type: "ACCESS_READER", label: "Access reader", layer: "LAYOUT" },
  { type: "PLANT", label: "Plant", layer: "LAYOUT" },
];

function useMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function makeElement(type: FloorplanElementType): FloorplanElement {
  const id = `${type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const base: FloorplanElement = {
    id,
    type,
    shape: "RECT",
    label: type.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase()),
    x: 240,
    y: 180,
    width: 120,
    height: 80,
    rotation: 0,
    fill: "#e2e8f0",
    visible: true,
  };

  if (type === "WALL") return { ...base, width: 240, height: 20, fill: "#cbd5e1" };
  if (type === "DOOR") return { ...base, width: 100, height: 20, fill: "#94a3b8", meta: { doorType: "STANDARD", isAdaAccessible: true } };
  if (type === "WINDOW") return { ...base, width: 120, height: 14, fill: "rgba(125,211,252,0.55)" };
  if (type === "SEAT") return { ...base, label: "Bookable desk", resourceId: `seat-${id}`, width: 100, height: 60, fill: "rgba(209,250,229,0.9)", meta: { capacity: 1, customerVisible: true, powerAvailable: true } };
  if (type === "MODE_ZONE") return { ...base, label: "Room setup", resourceId: `mode-${id}`, width: 320, height: 220, fill: "rgba(219,234,254,0.55)", meta: { capacity: 6, arrangement: "Boardroom", customerVisible: true, videoConferencing: false, display: false, whiteboard: false } };
  if (type === "DESK") return { ...base, width: 140, height: 70 };
  if (type === "FURNITURE") return { ...base, width: 140, height: 90 };
  return base;
}

function physicalSize(element?: FloorplanElement) {
  if (!element) return "";
  const feetWidth = (element.width ?? 120) / 20;
  const feetHeight = (element.height ?? 100) / 20;
  const area = feetWidth * feetHeight;
  return `${feetWidth.toFixed(1)} ft × ${feetHeight.toFixed(1)} ft · ${area.toFixed(1)} sq ft`;
}

export default function VisualDesignerLatestPreview() {
  const isPreviewBuild = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "demo-hi-coworking";
  const [activeLayer, setActiveLayer] = useState<LayerMode>("LAYOUT");
  const [tool, setTool] = useState<ToolMode>("SELECT");
  const [shell, setShell] = useState<FloorplanElement[]>(INITIAL_SHELL);
  const [layout, setLayout] = useState<FloorplanElement[]>(INITIAL_LAYOUT);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const { ref: canvasRef, size } = useMeasure();

  const allElements = useMemo(() => [...shell, ...layout], [shell, layout]);
  const selected = useMemo(
    () => allElements.find((element) => element.id === selectedIds[0]),
    [allElements, selectedIds]
  );

  function addElement(type: FloorplanElementType, layer: LayerMode) {
    const next = makeElement(type);
    if (layer === "SHELL") setShell((items) => [...items, next]);
    else setLayout((items) => [...items, next]);
    setActiveLayer(layer);
    setSelectedIds([next.id]);
    setAddOpen(false);
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy: FloorplanElement = {
      ...selected,
      id: `${selected.type.toLowerCase()}-${Date.now()}`,
      resourceId: selected.resourceId ? `${selected.resourceId}-copy-${Math.random().toString(36).slice(2, 5)}` : undefined,
      x: selected.x + 20,
      y: selected.y + 20,
      meta: selected.meta ? { ...selected.meta } : undefined,
    };
    if (shell.some((element) => element.id === selected.id)) setShell((items) => [...items, copy]);
    else setLayout((items) => [...items, copy]);
    setSelectedIds([copy.id]);
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    setShell((items) => items.filter((element) => !selectedIds.includes(element.id)));
    setLayout((items) => items.filter((element) => !selectedIds.includes(element.id)));
    setSelectedIds([]);
  }

  if (!isPreviewBuild) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <Info className="mx-auto h-8 w-8 text-slate-500" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-950">Preview route unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">This route is enabled only in isolated pull-request previews.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col overflow-hidden bg-slate-100 text-slate-950" data-preview-build="designer-scale-context-add-v2">
      <div className="flex min-h-11 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 text-sm text-amber-950">
        <Info className="h-4 w-4 shrink-0" />
        <span><strong>PR acceptance preview.</strong> Browser-only data; no production writes.</span>
      </div>

      <header className="flex min-h-16 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <div className="mr-auto min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">Hi Coworking Carrollton › Level 1</p>
          <h1 className="truncate text-base font-semibold">Visual designer</h1>
        </div>

        <div className="hidden min-h-11 items-center gap-2 rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700 md:flex" data-testid="preview-physical-scale">
          <Ruler className="h-4 w-4" />
          1 grid square = 1 ft × 1 ft = 1 sq ft
        </div>

        <div className="inline-flex min-h-11 rounded-full bg-slate-100 p-1" aria-label="Designer layer">
          <button type="button" onClick={() => { setActiveLayer("SHELL"); setSelectedIds([]); }} className={`rounded-full px-3 text-sm font-semibold ${activeLayer === "SHELL" ? "bg-white shadow-sm" : "text-slate-600"}`}>Floor plan</button>
          <button type="button" onClick={() => { setActiveLayer("LAYOUT"); setSelectedIds([]); }} className={`rounded-full px-3 text-sm font-semibold ${activeLayer === "LAYOUT" ? "bg-white shadow-sm" : "text-slate-600"}`}>Setups</button>
        </div>

        <button type="button" onClick={() => setTool("SELECT")} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${tool === "SELECT" ? "bg-slate-950 text-white" : "bg-white hover:bg-slate-100"}`} aria-label="Select tool"><MousePointer2 className="h-4 w-4" /></button>
        <button type="button" onClick={() => setTool("PAN")} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${tool === "PAN" ? "bg-slate-950 text-white" : "bg-white hover:bg-slate-100"}`} aria-label="Pan tool"><Hand className="h-4 w-4" /></button>
        <button type="button" onClick={() => setAddOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50" aria-haspopup="dialog" aria-expanded={addOpen} data-testid="desktop-add-button"><Plus className="h-4 w-4" /> Add</button>
        <button type="button" onClick={() => setPreviewMode((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white"><Eye className="h-4 w-4" /> {previewMode ? "Edit" : "Preview"}</button>
      </header>

      <div className="flex min-h-10 items-center gap-2 border-b border-slate-200 bg-white px-4 text-xs text-slate-600 md:hidden">
        <Ruler className="h-4 w-4" /> 1 grid square = 1 ft × 1 ft = 1 sq ft
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block">
          <div className="p-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Objects</h2>
            <div className="mt-2 space-y-1">
              {(activeLayer === "SHELL" ? shell : layout).map((element) => (
                <button key={element.id} type="button" onClick={() => setSelectedIds([element.id])} className={`min-h-11 w-full rounded-xl px-3 text-left text-sm ${selectedIds.includes(element.id) ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"}`}>
                  <span className="block truncate">{element.label ?? element.type}</span>
                  <span className="block text-xs font-normal text-slate-500">{physicalSize(element)}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col">
          <div ref={canvasRef} className="min-h-0 flex-1" onContextMenu={(event) => event.preventDefault()}>
            <FloorplanCanvas
              floorplan={FLOORPLAN}
              shellElements={shell}
              layoutElements={layout}
              activeLayer={activeLayer === "SHELL" ? "shell" : "layout"}
              activeTool={tool}
              mode={previewMode ? "SELECT" : "EDIT"}
              selectedId={selectedIds[0]}
              selectedIds={selectedIds}
              onSelect={(id) => setSelectedIds(id ? [id] : [])}
              onSelectIds={setSelectedIds}
              onShellElementsChange={setShell}
              onLayoutElementsChange={setLayout}
              stageWidth={size.width || undefined}
              stageHeight={size.height || undefined}
              showViewportControls
              canvasLabel="Hi Coworking physical-scale designer acceptance preview"
            />
          </div>

          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 text-xs text-slate-600">
            <span>Right-click an object for object actions. Right-click blank canvas for contextual add and viewport actions.</span>
            <span className="hidden shrink-0 font-semibold text-slate-700 sm:inline">55 ft × 32.5 ft · 1,787.5 sq ft design area</span>
          </div>
        </section>

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white xl:block">
          <div className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Settings2 className="h-4 w-4" /> Properties</div>
            {selected ? (
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold">{selected.label ?? selected.type}</p>
                  <p className="mt-1 text-xs text-slate-500">{physicalSize(selected)}</p>
                </div>
                <button type="button" onClick={duplicateSelected} className="min-h-11 w-full rounded-full border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50">Duplicate</button>
                <button type="button" onClick={deleteSelected} className="min-h-11 w-full rounded-full border border-rose-300 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">Delete</button>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-600">Select an object to see its physical size and available actions.</p>
            )}
          </div>
        </aside>
      </div>

      {addOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-label="Add to the space" data-testid="explicit-add-dialog">
          <button type="button" className="absolute inset-0" onClick={() => setAddOpen(false)} aria-label="Close Add dialog" />
          <section className="relative max-h-[82dvh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
            <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
              <div>
                <h2 className="font-semibold">Add to the space</h2>
                <p className="text-xs text-slate-500">Choose an object. It will be added at a sensible default size on the 1-ft grid.</p>
              </div>
              <button type="button" onClick={() => setAddOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-2 p-5 sm:grid-cols-2">
              {ADD_ITEMS.map((item) => (
                <button key={`${item.layer}-${item.type}`} type="button" onClick={() => addElement(item.type, item.layer)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 px-4 text-left text-sm font-semibold hover:bg-slate-50">
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>{item.label}<span className="mt-0.5 block text-xs font-normal text-slate-500">{item.layer === "SHELL" ? "Floor plan" : "Setup"}</span></span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
