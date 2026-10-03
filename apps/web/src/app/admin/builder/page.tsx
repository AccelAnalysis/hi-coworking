"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FloorplanCanvas } from "@/components/floorplan/FloorplanCanvasDynamic";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  LAYOUT_ELEMENT_TYPES,
  SHELL_ELEMENT_TYPES,
  isShellType,
  type FloorDoc,
  type FloorplanElement,
  type FloorplanElementType,
  defaultCoworkingFloor,
  layoutHasOfficeDesks,
  seatsForConference,
  shellHasOfficeRoom,
  withConferenceArrangement,
  type FloorShape,
  type LayoutVariant,
  type LocationDoc,
  type ShellDoc,
} from "@hi/shared";
import {
  deleteFloorBackground,
  deleteLayout,
  getFloors,
  getLayouts,
  getLocations,
  getShell,
  publishLayout,
  saveFloor,
  saveLayout,
  saveLocation,
  saveShell,
  uploadFloorBackground,
} from "@/lib/firestore";
import { useAuth } from "@/lib/authContext";
import {
  Plus,
  Upload,
  Trash2,
  Loader2,
  Copy,
  MapPin,
  ClipboardPaste,
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
  Layers,
} from "lucide-react";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function shapeElement(shape: FloorShape): FloorplanElement {
  return {
    id: shape.id,
    type: shape.type as FloorplanElement["type"],
    shape: "RECT",
    label: shape.label,
    resourceId: shape.resourceId,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    rotation: shape.rotation,
    fill: shape.fill,
    meta: {
      plan: "carrollton-1050",
      ...(shape.role ? { role: shape.role } : {}),
      ...(shape.shape === "ellipse" ? { shape: "ellipse" } : {}),
      ...(shape.conferenceX != null ? { conferenceX: shape.conferenceX, conferenceY: shape.conferenceY } : {}),
      ...(shape.type === "DOOR" ? { doorType: "STANDARD", isAdaAccessible: true } : {}),
      ...(shape.type === "SEAT" ? { capacity: 1 } : {}),
      ...(shape.type === "MODE_ZONE" ? { capacity: 10 } : {}),
    },
  };
}

function officeBackground(floor = defaultCoworkingFloor()) {
  return {
    downloadUrl: floor.backgroundPath,
    opacity: 0.92,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    locked: true,
  };
}

function makeDefaultFloor(locationId: string, levelIndex: number): FloorDoc {
  const floor = defaultCoworkingFloor();
  return {
    id: uid("floor"),
    locationId,
    name: levelIndex === 0 ? "Level 1" : `Level ${levelIndex + 1}`,
    levelIndex,
    canvasWidth: floor.canvasWidth,
    canvasHeight: floor.canvasHeight,
    background: officeBackground(floor),
  };
}

function makeDefaultShell(floorId: string): ShellDoc {
  const floor = defaultCoworkingFloor();
  return {
    id: "main",
    floorId,
    updatedAt: Date.now(),
    elements: floor.shell.map(shapeElement),
  };
}

function layoutElementsFor(arrangement: "open" | "conference"): FloorplanElement[] {
  const floor = defaultCoworkingFloor();
  const furniture = arrangement === "conference" ? withConferenceArrangement(floor.furniture) : floor.furniture;
  const seats = arrangement === "conference" ? seatsForConference(floor.seats) : floor.seats;
  return [
    ...furniture.map(shapeElement),
    ...seats.map((seat) => shapeElement({
      id: seat.resourceId,
      type: "SEAT",
      label: seat.label,
      resourceId: seat.resourceId,
      x: seat.x,
      y: seat.y,
      width: seat.width,
      height: seat.height,
      rotation: 0,
      fill: "rgba(16,185,129,0.28)",
      conferenceX: seat.conferenceX,
      conferenceY: seat.conferenceY,
    })),
  ];
}

function makeDefaultLayout(floorId: string): LayoutVariant {
  return {
    id: uid("layout"),
    floorId,
    name: "Open floor",
    status: "PUBLISHED",
    updatedAt: Date.now(),
    elements: layoutElementsFor("open"),
  };
}

function makeConferenceLayout(floorId: string): LayoutVariant {
  return {
    id: uid("layout"),
    floorId,
    name: "Conference mode",
    status: "DRAFT",
    updatedAt: Date.now(),
    elements: layoutElementsFor("conference"),
  };
}

async function ensureOfficePlan(
  locationId: string,
  floor: FloorDoc,
  shell: ShellDoc | null,
  floorLayouts: LayoutVariant[],
) {
  const ready = Boolean(
    shell
    && shellHasOfficeRoom(shell.elements)
    && floorLayouts.some((layout) => layoutHasOfficeDesks(layout.elements)),
  );
  if (ready && shell) {
    return { floor, shell, layouts: floorLayouts };
  }

  const plan = defaultCoworkingFloor();
  const nextFloor: FloorDoc = {
    ...floor,
    canvasWidth: plan.canvasWidth,
    canvasHeight: plan.canvasHeight,
    background: officeBackground(plan),
  };
  const nextShell = makeDefaultShell(floor.id);
  const published = floorLayouts.find((layout) => layout.status === "PUBLISHED") ?? floorLayouts[0];
  const openLayout: LayoutVariant = published
    ? {
        ...published,
        name: "Open floor",
        status: "PUBLISHED",
        updatedAt: Date.now(),
        elements: layoutElementsFor("open"),
      }
    : makeDefaultLayout(floor.id);
  const existingConference = floorLayouts.find((layout) => layout.id !== openLayout.id && /conference/i.test(layout.name));
  const conferenceLayout: LayoutVariant = existingConference
    ? {
        ...existingConference,
        name: "Conference mode",
        status: "DRAFT",
        updatedAt: Date.now(),
        elements: layoutElementsFor("conference"),
      }
    : makeConferenceLayout(floor.id);
  const retired = floorLayouts
    .filter((layout) => layout.id !== openLayout.id && layout.id !== conferenceLayout.id)
    .map((layout) => (
      layout.status === "PUBLISHED"
        ? { ...layout, status: "DRAFT" as const, updatedAt: Date.now() }
        : layout
    ));

  await saveFloor(locationId, nextFloor);
  await saveShell(locationId, floor.id, nextShell);
  await saveLayout(locationId, floor.id, openLayout);
  await saveLayout(locationId, floor.id, conferenceLayout);
  for (const layout of retired) {
    const previous = floorLayouts.find((item) => item.id === layout.id);
    if (previous && previous.status !== layout.status) {
      await saveLayout(locationId, floor.id, layout);
    }
  }

  return {
    floor: nextFloor,
    shell: nextShell,
    layouts: [openLayout, conferenceLayout, ...retired],
  };
}

function createElement(type: FloorplanElementType): FloorplanElement {
  const base: FloorplanElement = {
    id: uid(type.toLowerCase()),
    type,
    shape: "RECT",
    x: 120,
    y: 120,
    width: type === "WALL" ? 260 : 140,
    height: type === "WALL" ? 20 : 100,
    rotation: 0,
    label: type,
  };

  if (type === "DOOR") {
    return {
      ...base,
      width: 90,
      height: 16,
      fill: "rgba(99,102,241,0.35)",
      label: "Door",
      meta: { doorType: "STANDARD", isAdaAccessible: true, isEgress: false },
    };
  }

  if (type === "WINDOW") {
    return {
      ...base,
      width: 120,
      height: 14,
      fill: "rgba(56,189,248,0.25)",
      label: "Window",
    };
  }

  if (type === "WALL") {
    return {
      ...base,
      fill: "rgba(255,255,255,0.25)",
      label: "Wall",
    };
  }

  if (type === "SEAT") {
    return {
      ...base,
      label: "Seat",
      resourceId: "seat-1",
      fill: "rgba(16,185,129,0.18)",
      meta: { capacity: 1 },
    };
  }

  if (type === "MODE_ZONE") {
    return {
      ...base,
      label: "Mode",
      resourceId: "mode-conference",
      fill: "rgba(99,102,241,0.20)",
      meta: { capacity: 6 },
    };
  }

  if (type === "BATHROOM") {
    return {
      ...base,
      label: "Bathroom",
      fill: "rgba(14,165,233,0.2)",
      meta: { bathroomType: "ALL_GENDER", isAdaAccessible: true },
    };
  }

  if (type === "ELEVATOR") {
    return {
      ...base,
      label: "Elevator",
      fill: "rgba(148,163,184,0.2)",
      meta: { direction: "BOTH", isAdaAccessible: true },
    };
  }

  if (type === "STAIRS") {
    return {
      ...base,
      label: "Stairs",
      fill: "rgba(148,163,184,0.2)",
      meta: { direction: "UP" },
    };
  }

  return base;
}

function useMeasure(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const element = ref.current;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setBounds({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  return { ref, bounds };
}

export default function BuilderPage() {
  return (
    <RequireAuth requiredRole="admin">
      <BuilderContent />
    </RequireAuth>
  );
}

function BuilderContent() {
  const { user } = useAuth();
  const [locations, setLocations] = useState<LocationDoc[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | undefined>(undefined);
  const [floors, setFloors] = useState<FloorDoc[]>([]);
  const [activeFloorId, setActiveFloorIdState] = useState<string | undefined>(undefined);
  const [shellDoc, setShellDoc] = useState<ShellDoc | null>(null);
  const [layouts, setLayouts] = useState<LayoutVariant[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<"SHELL" | "LAYOUT">("SHELL");
  const [activeTool, setActiveTool] = useState<"SELECT" | "PAN">("SELECT");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboardElements, setClipboardElements] = useState<FloorplanElement[]>([]);
  const [history, setHistory] = useState<{ past: FloorplanElement[][]; future: FloorplanElement[][] }>({
    past: [],
    future: [],
  });
  const [isInitializing, setIsInitializing] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const pasteCounterRef = useRef(0);

  const { ref: canvasContainerRef, bounds: canvasBounds } = useMeasure(!isInitializing);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? floors[0],
    [floors, activeFloorId]
  );

  const activeLayout = useMemo(
    () => layouts.find((layout) => layout.id === activeLayoutId) ?? layouts[0],
    [layouts, activeLayoutId]
  );

  const selectedEl = useMemo(() => {
    if (!selectedId) return undefined;
    if (activeTab === "SHELL") {
      return shellDoc?.elements.find((e) => e.id === selectedId);
    }
    return activeLayout?.elements.find((e) => e.id === selectedId);
  }, [activeTab, selectedId, shellDoc?.elements, activeLayout?.elements]);

  const currentElements = useMemo(() => {
    if (activeTab === "SHELL") return shellDoc?.elements ?? [];
    return activeLayout?.elements ?? [];
  }, [activeTab, shellDoc?.elements, activeLayout?.elements]);

  const normalizedSelectedIds = useMemo(() => {
    if (selectedIds.length) return selectedIds;
    return selectedId ? [selectedId] : [];
  }, [selectedId, selectedIds]);

  const cloneElements = (elements: FloorplanElement[]) => elements.map((el) => ({ ...el, meta: el.meta ? { ...el.meta } : undefined }));

  const resetSelection = () => {
    setSelectedId(undefined);
    setSelectedIds([]);
  };

  const resetHistory = () => {
    setHistory({ past: [], future: [] });
  };

  const pushHistorySnapshot = (snapshot: FloorplanElement[]) => {
    setHistory((prev) => ({
      past: [...prev.past.slice(-49), cloneElements(snapshot)],
      future: [],
    }));
  };

  const loadFloorContext = async (locationId: string, floorId?: string) => {
    const loadedFloors = await getFloors(locationId);
    setFloors(loadedFloors);
    const floor = loadedFloors.find((f) => f.id === floorId) ?? loadedFloors[0];
    if (!floor) {
      setActiveFloorIdState(undefined);
      setShellDoc(null);
      setLayouts([]);
      setActiveLayoutId(undefined);
      resetSelection();
      resetHistory();
      return;
    }

    setActiveFloorIdState(floor.id);

    const [shell, floorLayouts] = await Promise.all([
      getShell(locationId, floor.id),
      getLayouts(locationId, floor.id),
    ]);
    const prepared = await ensureOfficePlan(locationId, floor, shell, floorLayouts);
    setFloors(loadedFloors.map((item) => (item.id === prepared.floor.id ? prepared.floor : item)));
    setShellDoc(prepared.shell);
    setLayouts(prepared.layouts);
    setActiveLayoutId(
      prepared.layouts.find((layout) => layout.status === "PUBLISHED")?.id ?? prepared.layouts[0]?.id,
    );

    resetSelection();
    resetHistory();
  };

  useEffect(() => {
    if (!user) return;

    async function load() {
      try {
        let loadedLocations = await getLocations();

        if (!loadedLocations.length) {
          const defaultLocation: LocationDoc = {
            id: uid("location"),
            name: "Hi Coworking Carrollton",
            slug: "hi-coworking-carrollton",
            address: "Carrollton, VA",
            timezone: "America/New_York",
            createdAt: Date.now(),
          };
          await saveLocation(defaultLocation);
          loadedLocations = [defaultLocation];
        }

        setLocations(loadedLocations);

        const firstLocationId = loadedLocations[0].id;
        setSelectedLocationId(firstLocationId);

        const loadedFloors = await getFloors(firstLocationId);
        if (!loadedFloors.length) {
          const firstFloor = makeDefaultFloor(firstLocationId, 0);
          const firstShell = makeDefaultShell(firstFloor.id);
          const firstLayout = makeDefaultLayout(firstFloor.id);
          const conferenceLayout = makeConferenceLayout(firstFloor.id);

          await saveFloor(firstLocationId, firstFloor);
          await saveShell(firstLocationId, firstFloor.id, firstShell);
          await saveLayout(firstLocationId, firstFloor.id, firstLayout);
          await saveLayout(firstLocationId, firstFloor.id, conferenceLayout);

          setFloors([firstFloor]);
          setActiveFloorIdState(firstFloor.id);
          setShellDoc(firstShell);
          setLayouts([firstLayout, conferenceLayout]);
          setActiveLayoutId(firstLayout.id);
        } else {
          await loadFloorContext(firstLocationId, loadedFloors[0]?.id);
        }
      } catch (err) {
        console.error("Failed to initialize space designer:", err);
      } finally {
        setIsInitializing(false);
      }
    }

    load();
  }, [user]);

  const reportSave = async (work: () => Promise<void>) => {
    setSaveState("saving");
    setSaveMessage(null);
    try {
      await work();
      setSaveState("saved");
    } catch (error) {
      console.error(error);
      setSaveState("error");
      setSaveMessage("The layout could not be saved. Confirm you are signed in as an admin and try again.");
    }
  };

  const updateShell = async (elements: FloorplanElement[]) => {
    if (!selectedLocationId || !activeFloor || !shellDoc) return;
    const next: ShellDoc = {
      ...shellDoc,
      floorId: activeFloor.id,
      elements,
      updatedAt: Date.now(),
      updatedBy: user?.uid,
    };
    setShellDoc(next);
    await reportSave(() => saveShell(selectedLocationId, activeFloor.id, next));
  };

  const updateLayout = async (nextLayout: LayoutVariant) => {
    if (!selectedLocationId || !activeFloor) return;
    const updatedLayout: LayoutVariant = {
      ...nextLayout,
      floorId: activeFloor.id,
      updatedAt: Date.now(),
      updatedBy: user?.uid,
    };
    setLayouts((prev) => prev.map((layout) => (layout.id === updatedLayout.id ? updatedLayout : layout)));
    await reportSave(() => saveLayout(selectedLocationId, activeFloor.id, updatedLayout));
  };

  const applyElements = (nextElements: FloorplanElement[], options?: { recordHistory?: boolean }) => {
    const recordHistory = options?.recordHistory ?? true;
    if (recordHistory) {
      pushHistorySnapshot(currentElements);
    }

    if (activeTab === "SHELL") {
      if (!shellDoc) return;
      void updateShell(nextElements);
      return;
    }
    if (!activeLayout) return;
    void updateLayout({ ...activeLayout, elements: nextElements });
  };

  const handleUndo = () => {
    setHistory((prev) => {
      if (!prev.past.length) return prev;
      const previous = prev.past[prev.past.length - 1];
      const remainingPast = prev.past.slice(0, -1);
      applyElements(cloneElements(previous), { recordHistory: false });
      return {
        past: remainingPast,
        future: [cloneElements(currentElements), ...prev.future],
      };
    });
    resetSelection();
  };

  const handleRedo = () => {
    setHistory((prev) => {
      if (!prev.future.length) return prev;
      const next = prev.future[0];
      const remainingFuture = prev.future.slice(1);
      applyElements(cloneElements(next), { recordHistory: false });
      return {
        past: [...prev.past, cloneElements(currentElements)],
        future: remainingFuture,
      };
    });
    resetSelection();
  };

  const handleCopy = () => {
    const ids = normalizedSelectedIds;
    if (!ids.length) return;
    const copied = currentElements.filter((el) => ids.includes(el.id));
    setClipboardElements(cloneElements(copied));
  };

  const handlePaste = () => {
    if (!clipboardElements.length) return;
    const pasteOffset = 24 * (pasteCounterRef.current + 1);
    pasteCounterRef.current += 1;
    const pasted = clipboardElements.map((el) => ({
      ...el,
      id: uid(el.type.toLowerCase()),
      x: el.x + pasteOffset,
      y: el.y + pasteOffset,
    }));
    const next = [...currentElements, ...pasted];
    applyElements(next, { recordHistory: true });
    setSelectedIds(pasted.map((el) => el.id));
    setSelectedId(pasted[0]?.id);
  };

  const updateSelected = (patch: Partial<FloorplanElement>) => {
    const ids = normalizedSelectedIds;
    if (!ids.length) return;
    applyElements(
      currentElements.map((el) => (ids.includes(el.id) ? { ...el, ...patch } : el)),
      { recordHistory: true }
    );
  };

  const handleAddFloor = async () => {
    if (!selectedLocationId) return;
    const next = makeDefaultFloor(selectedLocationId, floors.length);
    const nextShell = makeDefaultShell(next.id);
    const nextLayout = makeDefaultLayout(next.id);
    const conferenceLayout = makeConferenceLayout(next.id);
    await saveFloor(selectedLocationId, next);
    await saveShell(selectedLocationId, next.id, nextShell);
    await saveLayout(selectedLocationId, next.id, nextLayout);
    await saveLayout(selectedLocationId, next.id, conferenceLayout);

    setFloors((prev) => [...prev, next]);
    setActiveFloorIdState(next.id);
    setShellDoc(nextShell);
    setLayouts([nextLayout, conferenceLayout]);
    setActiveLayoutId(nextLayout.id);
    resetSelection();
    resetHistory();
  };

  const handleAddElement = (type: FloorplanElementType) => {
    const created = createElement(type);
    if (activeTab === "SHELL") {
      if (!shellDoc || !isShellType(type)) return;
      applyElements([...shellDoc.elements, created], { recordHistory: true });
      setSelectedId(created.id);
      setSelectedIds([created.id]);
      return;
    }
    if (!activeLayout || isShellType(type)) return;
    applyElements([...activeLayout.elements, created], { recordHistory: true });
    setSelectedId(created.id);
    setSelectedIds([created.id]);
  };

  const handleDeleteSelected = () => {
    const ids = normalizedSelectedIds;
    if (!ids.length) return;
    applyElements(currentElements.filter((e) => !ids.includes(e.id)), { recordHistory: true });
    resetSelection();
  };

  const handleBgUpload = async (file: File) => {
    if (!selectedLocationId || !activeFloor) return;

    const uploaded = await uploadFloorBackground(selectedLocationId, activeFloor.id, file);
    const nextFloor: FloorDoc = {
      ...activeFloor,
      background: {
        ...(activeFloor.background ?? {
          opacity: 1,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          locked: true,
        }),
        storagePath: uploaded.storagePath,
        downloadUrl: uploaded.downloadUrl,
      },
    };

    await saveFloor(selectedLocationId, nextFloor);
    setFloors((prev) => prev.map((floor) => (floor.id === nextFloor.id ? nextFloor : floor)));
  };

  const handleRemoveBg = async () => {
    if (!selectedLocationId || !activeFloor?.background?.storagePath) return;
    await deleteFloorBackground(activeFloor.background.storagePath);
    const nextFloor: FloorDoc = {
      ...activeFloor,
      background: {
        ...(activeFloor.background ?? { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, locked: true }),
        storagePath: undefined,
        downloadUrl: undefined,
      },
    };
    await saveFloor(selectedLocationId, nextFloor);
    setFloors((prev) => prev.map((floor) => (floor.id === nextFloor.id ? nextFloor : floor)));
  };

  const updateFloorBackgroundMeta = async (patch: Partial<NonNullable<FloorDoc["background"]>>) => {
    if (!selectedLocationId || !activeFloor) return;
    const nextFloor: FloorDoc = {
      ...activeFloor,
      background: {
        ...(activeFloor.background ?? { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, locked: true }),
        ...patch,
      },
    };
    await saveFloor(selectedLocationId, nextFloor);
    setFloors((prev) => prev.map((floor) => (floor.id === nextFloor.id ? nextFloor : floor)));
  };

  const handleCreateLayout = async () => {
    if (!selectedLocationId || !activeFloor) return;
    const nextLayout: LayoutVariant = {
      id: uid("layout"),
      floorId: activeFloor.id,
      name: `Layout ${layouts.length + 1}`,
      status: "DRAFT",
      updatedAt: Date.now(),
      updatedBy: user?.uid,
      elements: [],
    };
    await saveLayout(selectedLocationId, activeFloor.id, nextLayout);
    setLayouts((prev) => [...prev, nextLayout]);
    setActiveLayoutId(nextLayout.id);
    resetSelection();
    resetHistory();
  };

  const handleDuplicateLayout = async () => {
    if (!selectedLocationId || !activeFloor || !activeLayout) return;
    const clone: LayoutVariant = {
      ...activeLayout,
      id: uid("layout"),
      name: `${activeLayout.name} Copy`,
      status: "DRAFT",
      updatedAt: Date.now(),
      updatedBy: user?.uid,
      elements: activeLayout.elements.map((el) => ({ ...el, id: uid(el.type.toLowerCase()) })),
    };
    await saveLayout(selectedLocationId, activeFloor.id, clone);
    setLayouts((prev) => [...prev, clone]);
    setActiveLayoutId(clone.id);
    resetSelection();
    resetHistory();
  };

  const handlePublishLayout = async () => {
    if (!selectedLocationId || !activeFloor || !activeLayout) return;
    await publishLayout(selectedLocationId, activeFloor.id, activeLayout.id);
    const refreshed = await getLayouts(selectedLocationId, activeFloor.id);
    setLayouts(refreshed);
    setActiveLayoutId(activeLayout.id);
  };

  const handleDeleteLayout = async () => {
    if (!selectedLocationId || !activeFloor || !activeLayout) return;
    if (layouts.length <= 1) return;
    await deleteLayout(selectedLocationId, activeFloor.id, activeLayout.id);
    const refreshed = await getLayouts(selectedLocationId, activeFloor.id);
    setLayouts(refreshed);
    setActiveLayoutId(refreshed[0]?.id);
    resetSelection();
    resetHistory();
  };

  const handleLocationChange = async (locationId: string) => {
    setSelectedLocationId(locationId);
    resetSelection();
    resetHistory();
    await loadFloorContext(locationId);
  };

  const createNewLocation = async () => {
    const name = window.prompt("Location name", "New Location");
    if (!name) return;
    const location: LocationDoc = {
      id: uid("location"),
      name,
      slug: slugify(name),
      createdAt: Date.now(),
      timezone: "America/New_York",
    };
    await saveLocation(location);
    const nextLocations = [...locations, location].sort((a, b) => a.name.localeCompare(b.name));
    setLocations(nextLocations);
    await handleLocationChange(location.id);
  };

  const elementOptions = activeTab === "SHELL" ? SHELL_ELEMENT_TYPES : LAYOUT_ELEMENT_TYPES;

  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      const target = evt.target as HTMLElement | null;
      const typing = Boolean(
        target
        && (
          target.tagName === "INPUT"
          || target.tagName === "TEXTAREA"
          || target.tagName === "SELECT"
          || target.isContentEditable
        ),
      );
      if (typing) return;

      const key = evt.key.toLowerCase();
      const mod = evt.metaKey || evt.ctrlKey;

      if (mod && key === "c") {
        evt.preventDefault();
        handleCopy();
        return;
      }

      if (mod && key === "v") {
        evt.preventDefault();
        handlePaste();
        return;
      }

      if (mod && key === "z" && !evt.shiftKey) {
        evt.preventDefault();
        handleUndo();
        return;
      }

      if (mod && (key === "y" || (evt.shiftKey && key === "z"))) {
        evt.preventDefault();
        handleRedo();
        return;
      }

      if (key === "delete" || key === "backspace") {
        evt.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (isInitializing) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden">
        {/* ── Top Toolbar ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          {/* Location selector */}
          <div className="flex items-center gap-2 border-r border-slate-200 pr-3 mr-1">
            <MapPin className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={selectedLocationId}
              onChange={(e) => void handleLocationChange(e.target.value)}
              className="rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-900"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
            <button
              onClick={createNewLocation}
              className="rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="Add location"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Layer toggle (Shell / Layout) */}
          <div className="inline-flex rounded-md bg-slate-100 p-0.5 border-r border-slate-200 pr-3 mr-1">
            <button
              onClick={() => { setActiveTab("SHELL"); resetSelection(); }}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                activeTab === "SHELL" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Shell
            </button>
            <button
              onClick={() => { setActiveTab("LAYOUT"); resetSelection(); }}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                activeTab === "LAYOUT" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Layout
            </button>
          </div>

          {/* Tools */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1">
            <button
              onClick={() => setActiveTool("SELECT")}
              className={`rounded-md p-1.5 transition ${
                activeTool === "SELECT" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
              title="Select (V)"
            >
              <MousePointer2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTool("PAN")}
              className={`rounded-md p-1.5 transition ${
                activeTool === "PAN" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
              title="Pan (Space)"
            >
              <Hand className="h-4 w-4" />
            </button>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1">
            <button
              onClick={handleUndo}
              disabled={history.past.length === 0}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo (Cmd+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={history.future.length === 0}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Redo (Cmd+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>

          {/* Copy / Paste / Delete */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-3 mr-1">
            <button
              onClick={handleCopy}
              disabled={normalizedSelectedIds.length === 0}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Copy (Cmd+C)"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={handlePaste}
              disabled={clipboardElements.length === 0}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Paste (Cmd+V)"
            >
              <ClipboardPaste className="h-4 w-4" />
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={normalizedSelectedIds.length === 0}
              className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Delete (Backspace)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* Add element dropdown area */}
          <div className="flex max-w-full items-center gap-1 overflow-x-auto">
            {elementOptions.map((t) => (
              <button
                key={t}
                onClick={() => handleAddElement(t)}
                className="rounded-md px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
              >
                {t}
              </button>
            ))}
          </div>

          {/* Right-aligned spacer + zoom indicator */}
          <div className="ml-auto flex items-center gap-2 text-[11px] font-medium text-slate-400">
            <Layers className="h-3.5 w-3.5" />
            {activeTab === "SHELL" ? "Shell" : activeLayout?.name ?? "Layout"}
            <span className={saveState === "error" ? "text-rose-600" : "text-emerald-600"}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : ""}
            </span>
          </div>
        </div>
        {saveMessage ? (
          <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
            {saveMessage}
          </div>
        ) : null}

        {/* ── Main Content Area ── */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ─ Left Sidebar: Project Tree ─ */}
          <div className="max-h-40 w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-white lg:max-h-none lg:w-56 lg:border-b-0 lg:border-r">
            <div className="p-3 space-y-4">
              {/* Floors */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Floors</span>
                  <button
                    onClick={handleAddFloor}
                    className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    title="Add floor"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5">
                  {floors.map((f) => {
                    const active = f.id === activeFloor?.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => void loadFloorContext(selectedLocationId ?? f.locationId, f.id)}
                        className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition ${
                          active
                            ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {f.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Layouts (visible when on Layout tab) */}
              {activeTab === "LAYOUT" ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Layouts</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={handleCreateLayout}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title="New layout"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={handleDuplicateLayout}
                        disabled={!activeLayout}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                        title="Duplicate layout"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {layouts.map((layout) => {
                      const active = layout.id === activeLayout?.id;
                      return (
                        <button
                          key={layout.id}
                          onClick={() => {
                            setActiveLayoutId(layout.id);
                            resetSelection();
                            resetHistory();
                          }}
                          className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition ${
                            active
                              ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                              : "text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="truncate">{layout.name}</span>
                            <span className={`text-[9px] uppercase tracking-wide ${
                              layout.status === "PUBLISHED" ? "text-emerald-500" : "text-slate-400"
                            }`}>
                              {layout.status}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {activeLayout ? (
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={handlePublishLayout}
                        className="flex-1 rounded-md px-2 py-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition"
                      >
                        Publish
                      </button>
                      <button
                        onClick={handleDeleteLayout}
                        disabled={layouts.length <= 1}
                        className="rounded-md px-2 py-1 text-[10px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-30 transition"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* ─ Center: Canvas ─ */}
          <div className="flex min-h-[320px] min-w-0 flex-1 flex-col">
            <div ref={canvasContainerRef} className="flex-1 min-h-0 relative">
              {activeFloor && shellDoc ? (
                <FloorplanCanvas
                  floorplan={{
                    id: activeFloor.id,
                    name: activeFloor.name,
                    levelIndex: activeFloor.levelIndex,
                    canvasWidth: activeFloor.canvasWidth,
                    canvasHeight: activeFloor.canvasHeight,
                    backgroundImageDataUrl: activeFloor.background?.downloadUrl,
                    elements: [],
                  }}
                  shellElements={shellDoc.elements}
                  layoutElements={activeLayout?.elements ?? []}
                  activeLayer={activeTab === "SHELL" ? "shell" : "layout"}
                  activeTool={activeTool}
                  backgroundOpacity={activeFloor.background?.opacity ?? 1}
                  stageWidth={canvasBounds.width || undefined}
                  stageHeight={canvasBounds.height || undefined}
                  mode="EDIT"
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setSelectedIds(id ? [id] : []);
                  }}
                  onSelectIds={(ids) => {
                    setSelectedIds(ids);
                    setSelectedId(ids[0]);
                  }}
                  onShellElementsChange={(elements) => void updateShell(elements)}
                  onLayoutElementsChange={(elements) => {
                    if (!activeLayout) return;
                    void updateLayout({ ...activeLayout, elements });
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-slate-400">
                  No floor selected
                </div>
              )}
            </div>

            {/* Bottom Status Bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-white border-t border-slate-200 text-[11px] text-slate-500 shrink-0">
              <div className="flex items-center gap-3">
                <span>{activeFloor?.name ?? "—"}</span>
                <span className="text-slate-300">|</span>
                <span>{activeTab === "SHELL" ? "Shell" : activeLayout?.name ?? "—"}</span>
                <span className="text-slate-300">|</span>
                <span>{currentElements.length} elements</span>
              </div>
              <div className="flex items-center gap-3">
                {normalizedSelectedIds.length > 0 ? (
                  <span className="text-indigo-600 font-medium">{normalizedSelectedIds.length} selected</span>
                ) : null}
                <span className="hidden md:inline">⌘Z undo · ⌘⇧Z redo · ⌘C copy · ⌘V paste · ⌫ delete</span>
              </div>
            </div>
          </div>

          {/* ─ Right Sidebar: Inspector ─ */}
          <div className="max-h-72 w-full shrink-0 overflow-y-auto border-t border-slate-200 bg-white lg:max-h-none lg:w-64 lg:border-l lg:border-t-0">
            <div className="p-3 space-y-4">
              {/* Properties */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Properties</div>
                {!selectedEl ? (
                  <div className="text-xs text-slate-400 italic">Select an element to edit</div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">Type</span>
                      <span className="text-xs font-medium text-slate-900">{selectedEl.type}</span>
                    </div>

                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">Label</span>
                      <input
                        value={selectedEl.label ?? ""}
                        onChange={(e) => updateSelected({ label: e.target.value })}
                        className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                        placeholder="Seat 1"
                      />
                    </label>

                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">Resource ID</span>
                      <select
                        value={["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "mode-conference"].includes(selectedEl.resourceId ?? "") ? selectedEl.resourceId : "custom"}
                        onChange={(e) => {
                          if (e.target.value !== "custom") updateSelected({ resourceId: e.target.value });
                        }}
                        className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900"
                      >
                        {["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "mode-conference"].map((resourceId) => (
                          <option key={resourceId} value={resourceId}>{resourceId}</option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                      <input
                        value={selectedEl.resourceId ?? ""}
                        onChange={(e) => updateSelected({ resourceId: e.target.value || undefined })}
                        className="mt-1 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                        placeholder="seat-1 / mode-conference"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Opacity</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={selectedEl.opacity ?? 1}
                          onChange={(e) => updateSelected({ opacity: Number(e.target.value) })}
                          className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">z-Index</span>
                        <input
                          type="number"
                          value={selectedEl.zIndex ?? 0}
                          onChange={(e) => updateSelected({ zIndex: Number(e.target.value) })}
                          className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">Fill</span>
                      <input
                        value={selectedEl.fill ?? ""}
                        onChange={(e) => updateSelected({ fill: e.target.value || undefined })}
                        className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                        placeholder="rgba(255,255,255,0.2)"
                      />
                    </label>

                    {selectedEl.type === "DOOR" ? (
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Door Type</span>
                        <select
                          value={String(selectedEl.meta?.doorType ?? "STANDARD")}
                          onChange={(e) =>
                            updateSelected({ meta: { ...(selectedEl.meta ?? {}), doorType: e.target.value } })
                          }
                          className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900"
                        >
                          {["OPENING", "STANDARD", "KEY_ENTRY", "SCAN_TO_ENTER", "PIN_CODE", "PUSH_BAR", "EMERGENCY_EXIT"].map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {selectedEl.type === "BATHROOM" ? (
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Bathroom Type</span>
                        <select
                          value={String(selectedEl.meta?.bathroomType ?? "ALL_GENDER")}
                          onChange={(e) =>
                            updateSelected({ meta: { ...(selectedEl.meta ?? {}), bathroomType: e.target.value } })
                          }
                          className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900"
                        >
                          {["M", "F", "ALL_GENDER"].map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {selectedEl.type === "SEAT" || selectedEl.type === "MODE_ZONE" ? (
                      <label className="block">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Capacity</span>
                        <input
                          type="number"
                          min={1}
                          value={Number(selectedEl.meta?.capacity ?? 1)}
                          onChange={(e) =>
                            updateSelected({ meta: { ...(selectedEl.meta ?? {}), capacity: Number(e.target.value) } })
                          }
                          className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900"
                        />
                      </label>
                    ) : null}

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={!!selectedEl.locked}
                          onChange={(e) => updateSelected({ locked: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Locked
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedEl.visible ?? true}
                          onChange={(e) => updateSelected({ visible: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Visible
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Background */}
              <div className="border-t border-slate-100 pt-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Background</div>
                <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 transition">
                  <Upload className="h-3.5 w-3.5" />
                  Upload image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleBgUpload(file);
                    }}
                  />
                </label>
                <div className="mt-2 space-y-1.5">
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Opacity</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={activeFloor?.background?.opacity ?? 1}
                      onChange={(e) => void updateFloorBackgroundMeta({ opacity: Number(e.target.value) })}
                      className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Scale</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={activeFloor?.background?.scale ?? 1}
                      onChange={(e) => void updateFloorBackgroundMeta({ scale: Number(e.target.value) })}
                      className="mt-0.5 w-full rounded-md border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                    />
                  </label>
                  <button
                    onClick={() => void handleRemoveBg()}
                    disabled={!activeFloor?.background?.storagePath}
                    className="w-full rounded-md px-2 py-1 text-[10px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-30 transition"
                  >
                    Remove background
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
