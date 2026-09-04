"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  CheckCircle2,
  DoorOpen,
  Eye,
  Hand,
  Info,
  ListTree,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { FloorplanCanvas } from "@/components/floorplan/FloorplanCanvas";
import type { FloorplanElement, FloorplanElementType } from "@hi/shared";

type ActiveLayer = "SHELL" | "LAYOUT";
type ActiveTool = "SELECT" | "PAN";
type MobilePanel = "NONE" | "BROWSE" | "ADD" | "PROPERTIES";

const FLOORPLAN = {
  id: "preview-floor",
  name: "Level 1",
  levelIndex: 0,
  canvasWidth: 1100,
  canvasHeight: 650,
  elements: [],
};

const INITIAL_SHELL: FloorplanElement[] = [
  { id: "wall-top", type: "WALL", shape: "RECT", label: "North wall", x: 90, y: 70, width: 920, height: 20, rotation: 0, fill: "#cbd5e1" },
  { id: "wall-left", type: "WALL", shape: "RECT", label: "West wall", x: 90, y: 70, width: 20, height: 500, rotation: 0, fill: "#cbd5e1" },
  { id: "wall-right", type: "WALL", shape: "RECT", label: "East wall", x: 990, y: 70, width: 20, height: 500, rotation: 0, fill: "#cbd5e1" },
  { id: "wall-bottom", type: "WALL", shape: "RECT", label: "South wall", x: 90, y: 550, width: 920, height: 20, rotation: 0, fill: "#cbd5e1" },
  {
    id: "entry",
    type: "DOOR",
    shape: "RECT",
    label: "Main entrance",
    x: 150,
    y: 545,
    width: 100,
    height: 20,
    rotation: 0,
    fill: "#94a3b8",
    meta: { doorType: "PIN_CODE", isAdaAccessible: true },
  },
];

const BOARDROOM: FloorplanElement[] = [
  {
    id: "conference-boardroom",
    type: "MODE_ZONE",
    shape: "RECT",
    label: "Boardroom",
    resourceId: "mode-boardroom-preview",
    x: 250,
    y: 130,
    width: 600,
    height: 350,
    rotation: 0,
    fill: "rgba(219,234,254,0.55)",
    stroke: "#64748b",
    strokeWidth: 2,
    meta: {
      capacity: 10,
      arrangement: "Boardroom",
      customerVisible: true,
      videoConferencing: true,
      display: true,
      whiteboard: true,
      addOnIds: ["video-conferencing"],
    },
  },
  {
    id: "boardroom-table",
    type: "FURNITURE",
    shape: "RECT",
    label: "Conference table",
    x: 390,
    y: 245,
    width: 320,
    height: 125,
    rotation: 0,
    fill: "#e2e8f0",
    meta: { role: "table" },
  },
  ...Array.from({ length: 8 }, (_, index): FloorplanElement => ({
    id: `boardroom-chair-${index + 1}`,
    type: "FURNITURE",
    shape: "RECT",
    label: `Chair ${index + 1}`,
    x: index < 4 ? 405 + index * 78 : 405 + (index - 4) * 78,
    y: index < 4 ? 185 : 390,
    width: 48,
    height: 42,
    rotation: 0,
    fill: "#f8fafc",
    meta: { role: "chair" },
  })),
  { id: "boardroom-chair-9", type: "FURNITURE", shape: "RECT", label: "Chair 9", x: 315, y: 285, width: 48, height: 42, rotation: 0, fill: "#f8fafc", meta: { role: "chair" } },
  { id: "boardroom-chair-10", type: "FURNITURE", shape: "RECT", label: "Chair 10", x: 735, y: 285, width: 48, height: 42, rotation: 0, fill: "#f8fafc", meta: { role: "chair" } },
];

const DESKS: FloorplanElement[] = [
  {
    id: "desk-one",
    type: "SEAT",
    shape: "RECT",
    label: "Window desk",
    resourceId: "seat-window-preview",
    x: 150,
    y: 135,
    width: 90,
    height: 70,
    rotation: 0,
    fill: "rgba(209,250,229,0.85)",
    meta: { capacity: 1, customerVisible: true, powerAvailable: true, monitor: true },
  },
  {
    id: "desk-two",
    type: "SEAT",
    shape: "RECT",
    label: "Focus desk",
    resourceId: "seat-focus-preview",
    x: 150,
    y: 250,
    width: 90,
    height: 70,
    rotation: 0,
    fill: "rgba(209,250,229,0.85)",
    meta: { capacity: 1, customerVisible: true, powerAvailable: true },
  },
];

const ADD_GROUPS: Array<{ title: string; items: Array<{ type: FloorplanElementType; label: string }> }> = [
  { title: "Structure", items: [{ type: "WALL", label: "Wall" }, { type: "ROOM", label: "Room" }, { type: "DOOR", label: "Door" }, { type: "WINDOW", label: "Window" }] },
  { title: "Workspace", items: [{ type: "DESK", label: "Desk" }, { type: "SEAT", label: "Bookable seat" }, { type: "MODE_ZONE", label: "Room setup" }, { type: "FURNITURE", label: "Furniture" }] },
  { title: "Amenities", items: [{ type: "AMENITY", label: "Amenity" }, { type: "POWER", label: "Power" }, { type: "ACCESS_READER", label: "Access reader" }, { type: "PLANT", label: "Plant" }] },
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

function titleCase(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createElement(type: FloorplanElementType): FloorplanElement {
  const now = Date.now();
  const bookable = type === "SEAT" || type === "MODE_ZONE";
  return {
    id: `${type.toLowerCase()}-${now}`,
    type,
    shape: "RECT",
    label: type === "MODE_ZONE" ? "New room setup" : type === "SEAT" ? "New desk" : titleCase(type),
    resourceId: bookable ? `${type === "SEAT" ? "seat" : "mode"}-preview-${now}` : undefined,
    x: 300,
    y: 180,
    width: type === "WALL" ? 260 : type === "MODE_ZONE" ? 360 : 120,
    height: type === "WALL" ? 20 : type === "MODE_ZONE" ? 240 : 90,
    rotation: 0,
    fill: bookable ? "rgba(219,234,254,0.55)" : "#e2e8f0",
    meta: bookable ? { capacity: type === "SEAT" ? 1 : 6, customerVisible: true } : undefined,
  };
}

function LayerStatus({ active }: { active: boolean }) {
  return active ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : null;
}

export default function VisualDesignerPreviewPage() {
  const isPreviewBuild = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "demo-hi-coworking";
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>("LAYOUT");
  const [activeTool, setActiveTool] = useState<ActiveTool>("SELECT");
  const [shell, setShell] = useState<FloorplanElement[]>(INITIAL_SHELL);
  const [layout, setLayout] = useState<FloorplanElement[]>([...BOARDROOM, ...DESKS]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("NONE");
  const [customerPreview, setCustomerPreview] = useState(false);
  const { ref: canvasRef, size } = useMeasure();

  const allElements = useMemo(() => [...shell, ...layout], [shell, layout]);
  const selected = useMemo(
    () => allElements.find((element) => element.id === selectedIds[0]),
    [allElements, selectedIds]
  );

  const selectedIsShell = selected ? shell.some((element) => element.id === selected.id) : false;
  const currentElements = activeLayer === "SHELL" ? shell : layout;

  function chooseLayer(next: ActiveLayer) {
    setActiveLayer(next);
    setSelectedIds([]);
    setMobilePanel("NONE");
  }

  function addElement(type: FloorplanElementType) {
    const architectural = ["WALL", "ROOM", "DOOR", "WINDOW", "STAIRS", "ELEVATOR", "BATHROOM", "COLUMN", "RECEPTION", "ENTRANCE", "EXIT", "FIRE_EXIT", "UTILITY"].includes(type);
    const element = createElement(type);
    if (architectural) {
      setShell((items) => [...items, element]);
      setActiveLayer("SHELL");
    } else {
      setLayout((items) => [...items, element]);
      setActiveLayer("LAYOUT");
    }
    setSelectedIds([element.id]);
    setMobilePanel("NONE");
  }

  function updateSelected(patch: Partial<FloorplanElement>) {
    if (!selected) return;
    const updater = (items: FloorplanElement[]) =>
      items.map((element) => (element.id === selected.id ? { ...element, ...patch } : element));
    if (selectedIsShell) setShell(updater);
    else setLayout(updater);
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    setShell((items) => items.filter((element) => !selectedIds.includes(element.id)));
    setLayout((items) => items.filter((element) => !selectedIds.includes(element.id)));
    setSelectedIds([]);
  }

  function loadTemplate(name: "Boardroom" | "Classroom" | "U-shape" | "Theater") {
    const zone = BOARDROOM[0];
    const capacity = name === "Classroom" ? 16 : name === "U-shape" ? 12 : name === "Theater" ? 20 : 10;
    const nextZone: FloorplanElement = {
      ...zone,
      id: `mode-${name.toLowerCase().replace(/\W/g, "-")}`,
      label: name,
      resourceId: `mode-${name.toLowerCase().replace(/\W/g, "-")}-preview`,
      meta: { ...(zone.meta ?? {}), capacity, arrangement: name },
    };
    const furniture =
      name === "Boardroom"
        ? BOARDROOM.slice(1)
        : Array.from({ length: capacity }, (_, index): FloorplanElement => ({
            id: `${name.toLowerCase()}-seat-${index}`,
            type: "FURNITURE",
            shape: "RECT",
            label: `Chair ${index + 1}`,
            x: 310 + (index % 5) * 100,
            y: 180 + Math.floor(index / 5) * 70,
            width: 54,
            height: 42,
            rotation: 0,
            fill: "#f8fafc",
            meta: { role: "chair" },
          }));
    setLayout([...DESKS, nextZone, ...furniture]);
    setSelectedIds([nextZone.id]);
    setActiveLayer("LAYOUT");
  }

  const navigator = (
    <div className="space-y-7 p-4">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Floor</h2>
          <button className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Add floor">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <button className="mt-1 flex min-h-11 w-full items-center justify-between rounded-xl bg-slate-950 px-3 text-left text-sm font-semibold text-white">
          Level 1 <CheckCircle2 className="h-4 w-4" />
        </button>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Setups</h2>
        <div className="mt-2 space-y-1">
          {(["Boardroom", "Classroom", "U-shape", "Theater"] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => loadTemplate(name)}
              className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${
                layout.some((element) => element.type === "MODE_ZONE" && element.label === name)
                  ? "bg-blue-50 font-semibold text-blue-900 ring-1 ring-blue-200"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {name}
              <LayerStatus active={layout.some((element) => element.type === "MODE_ZONE" && element.label === name)} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Objects</h2>
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {currentElements.map((element) => (
            <button
              key={element.id}
              type="button"
              onClick={() => setSelectedIds([element.id])}
              className={`min-h-11 w-full rounded-xl px-3 text-left text-sm ${
                selectedIds.includes(element.id) ? "bg-slate-100 font-semibold text-slate-950" : "text-slate-700 hover:bg-slate-50"
              }`}
              aria-label={`${element.label ?? titleCase(element.type)}${element.resourceId ? `, bookable, capacity ${Number(element.meta?.capacity ?? 1)}` : ""}`}
            >
              <span className="block truncate">{element.label ?? titleCase(element.type)}</span>
              <span className="block text-xs font-normal text-slate-500">{titleCase(element.type)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const addLibrary = (
    <div className="space-y-6 p-4">
      {ADD_GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{group.title}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {group.items.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => addElement(item.type)}
                className="flex min-h-14 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                {item.type === "DOOR" ? <DoorOpen className="h-4 w-4" /> : item.type === "FURNITURE" ? <Armchair className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {item.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const inspector = (
    <div className="space-y-5 p-4">
      {!selected ? (
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Nothing selected</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">Choose an object on the canvas or in the object list to edit its customer-facing properties.</p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{titleCase(selected.type)}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{selected.label ?? "Object"}</h2>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Customer-facing name
            <input
              value={selected.label ?? ""}
              onChange={(event) => updateSelected({ label: event.target.value })}
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
            />
          </label>
          {(selected.type === "SEAT" || selected.type === "MODE_ZONE") ? (
            <>
              <label className="block text-sm font-medium text-slate-700">
                Capacity
                <input
                  type="number"
                  min={1}
                  value={Number(selected.meta?.capacity ?? 1)}
                  onChange={(event) => updateSelected({ meta: { ...(selected.meta ?? {}), capacity: Number(event.target.value) } })}
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                />
              </label>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selected.meta?.customerVisible !== false}
                  onChange={(event) => updateSelected({ meta: { ...(selected.meta ?? {}), customerVisible: event.target.checked } })}
                />
                Visible to customers
              </label>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(selected.meta?.videoConferencing)}
                  onChange={(event) => updateSelected({ meta: { ...(selected.meta ?? {}), videoConferencing: event.target.checked } })}
                />
                Video conferencing
              </label>
            </>
          ) : null}
          <details className="rounded-2xl border border-slate-200">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-slate-800">Advanced</summary>
            <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-3">
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {field}
                  <input
                    type="number"
                    value={Number(selected[field] ?? 0)}
                    onChange={(event) => updateSelected({ [field]: Number(event.target.value) } as Partial<FloorplanElement>)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900"
                  />
                </label>
              ))}
            </div>
          </details>
          <button type="button" onClick={deleteSelected} className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-rose-300 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50">
            Remove selected object
          </button>
        </>
      )}
    </div>
  );

  if (!isPreviewBuild) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <Info className="mx-auto h-8 w-8 text-slate-500" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-950">Preview route unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">This isolated designer harness is enabled only in pull-request preview builds and never connects to production data.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col overflow-hidden bg-slate-100 text-slate-950">
      <div className="flex min-h-12 items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-950 ring-1 ring-inset ring-amber-200">
        <Info className="h-4 w-4 shrink-0" />
        <span><strong>Isolated PR preview.</strong> No login is required; changes stay in this browser and never touch Hi Coworking production data.</span>
      </div>

      <header className="flex min-h-16 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <div className="mr-auto min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">Hi Coworking Carrollton › Level 1</p>
          <h1 className="truncate text-base font-semibold text-slate-950">Visual designer preview</h1>
        </div>

        <div className="inline-flex min-h-11 rounded-full bg-slate-100 p-1">
          <button type="button" onClick={() => chooseLayer("SHELL")} className={`rounded-full px-4 text-sm font-semibold ${activeLayer === "SHELL" ? "bg-white shadow-sm" : "text-slate-600"}`}>
            Floor plan
          </button>
          <button type="button" onClick={() => chooseLayer("LAYOUT")} className={`rounded-full px-4 text-sm font-semibold ${activeLayer === "LAYOUT" ? "bg-white shadow-sm" : "text-slate-600"}`}>
            Setups
          </button>
        </div>

        <div className="hidden items-center gap-1 sm:flex">
          <button type="button" onClick={() => setActiveTool("SELECT")} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${activeTool === "SELECT" ? "bg-slate-950 text-white" : "hover:bg-slate-100"}`} aria-label="Select tool">
            <MousePointer2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setActiveTool("PAN")} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${activeTool === "PAN" ? "bg-slate-950 text-white" : "hover:bg-slate-100"}`} aria-label="Pan tool">
            <Hand className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setMobilePanel("ADD")} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add
          </button>
          <button type="button" onClick={() => setCustomerPreview((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">
            <Eye className="h-4 w-4" /> {customerPreview ? "Edit" : "Preview"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block" aria-label="Floors, setups, and objects">
            <div className="flex min-h-12 items-center justify-between border-b border-slate-100 px-4">
              <span className="text-sm font-semibold">Browse</span>
              <button type="button" onClick={() => setLeftOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Hide navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
            {navigator}
          </aside>
        ) : (
          <div className="hidden w-12 shrink-0 justify-center border-r border-slate-200 bg-white pt-2 lg:flex">
            <button type="button" onClick={() => setLeftOpen(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Show navigation">
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Designer canvas">
          <div ref={canvasRef} className="min-h-0 flex-1">
            <FloorplanCanvas
              floorplan={FLOORPLAN}
              shellElements={shell}
              layoutElements={layout}
              activeLayer={activeLayer === "SHELL" ? "shell" : "layout"}
              activeTool={activeTool}
              mode={customerPreview ? "SELECT" : "EDIT"}
              selectedId={selectedIds[0]}
              selectedIds={selectedIds}
              onSelect={(id) => setSelectedIds(id ? [id] : [])}
              onSelectIds={setSelectedIds}
              onShellElementsChange={setShell}
              onLayoutElementsChange={setLayout}
              stageWidth={size.width || undefined}
              stageHeight={size.height || undefined}
              showViewportControls
              canvasLabel={`Level 1, ${activeLayer === "SHELL" ? "floor plan" : "setup"} preview`}
            />
          </div>

          <div className="grid min-h-16 grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
            <button type="button" onClick={() => setMobilePanel("BROWSE")} className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium"><ListTree className="h-5 w-5" /> Browse</button>
            <button type="button" onClick={() => { setActiveTool("SELECT"); setMobilePanel("NONE"); }} className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium ${activeTool === "SELECT" ? "text-blue-700" : ""}`}><MousePointer2 className="h-5 w-5" /> Select</button>
            <button type="button" onClick={() => setMobilePanel("ADD")} className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium"><Plus className="h-5 w-5" /> Add</button>
            <button type="button" onClick={() => setMobilePanel("PROPERTIES")} className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium"><Settings2 className="h-5 w-5" /> Properties</button>
          </div>
        </section>

        {rightOpen ? (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white xl:block" aria-label="Properties">
            <div className="flex min-h-12 items-center justify-between border-b border-slate-100 px-4">
              <span className="text-sm font-semibold">Properties</span>
              <button type="button" onClick={() => setRightOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Hide properties">
                <X className="h-4 w-4" />
              </button>
            </div>
            {inspector}
          </aside>
        ) : (
          <div className="hidden w-12 shrink-0 justify-center border-l border-slate-200 bg-white pt-2 xl:flex">
            <button type="button" onClick={() => setRightOpen(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Show properties">
              <PanelRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {mobilePanel !== "NONE" ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35 lg:hidden" role="dialog" aria-modal="true" aria-label={mobilePanel.toLowerCase()}>
          <button className="absolute inset-0" onClick={() => setMobilePanel("NONE")} aria-label="Close panel" />
          <section className="relative max-h-[82dvh] w-full overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
              <h2 className="font-semibold">{mobilePanel === "BROWSE" ? "Floors, setups, and objects" : mobilePanel === "ADD" ? "Add to the space" : "Properties"}</h2>
              <button type="button" onClick={() => setMobilePanel("NONE")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            {mobilePanel === "BROWSE" ? navigator : mobilePanel === "ADD" ? addLibrary : inspector}
          </section>
        </div>
      ) : null}
    </main>
  );
}
