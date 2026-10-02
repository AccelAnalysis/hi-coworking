"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { FloorplanCanvas } from "@/components/floorplan/FloorplanCanvas";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  isShellType,
  type FloorDoc,
  type FloorplanElement,
  type FloorplanElementType,
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
import { functions } from "@/lib/firebase";
import {
  Accessibility,
  AlertCircle,
  AlertTriangle,
  Armchair,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  DoorOpen,
  Eye,
  Hand,
  LayoutTemplate,
  ListTree,
  Loader2,
  Lock,
  MapPin,
  Menu,
  Monitor,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Settings2,
  Shapes,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";

type ActiveTab = "SHELL" | "LAYOUT";
type ActiveTool = "SELECT" | "PAN";
type MobilePanel = "NONE" | "NAV" | "ADD" | "PROPERTIES";
type SaveState = "SAVED" | "SAVING" | "ERROR";
type ValidationIssue = { severity: "ERROR" | "WARNING"; message: string };

type CatalogAddOn = {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  serviceTypes: Array<"DESK" | "CONFERENCE">;
  published: boolean;
};

type CatalogResponse = {
  publishedLayouts: Array<{ layoutPath: string }>;
  setups: Array<{ id: string; layoutPath: string; resourceId: string; published: boolean }>;
  addOns: CatalogAddOn[];
};

type SetupTemplate = {
  id: "BOARDROOM" | "CLASSROOM" | "U_SHAPE" | "THEATER" | "INTERVIEW";
  name: string;
  description: string;
  arrangement: string;
  capacity: number;
};

const getCatalog = httpsCallable<Record<string, never>, CatalogResponse>(functions, "space_adminGetCatalog");
const saveCustomerSetup = httpsCallable<Record<string, unknown>, Record<string, unknown>>(functions, "space_adminUpsertSetup");
const setCustomerSetupPublished = httpsCallable<{ setupId: string; published: boolean }, { success: boolean }>(
  functions,
  "space_adminSetSetupPublished"
);

const SETUP_TEMPLATES: SetupTemplate[] = [
  {
    id: "BOARDROOM",
    name: "Boardroom",
    description: "One central table for focused meetings and decisions.",
    arrangement: "Boardroom",
    capacity: 10,
  },
  {
    id: "CLASSROOM",
    name: "Classroom",
    description: "Forward-facing tables for training and workshops.",
    arrangement: "Classroom",
    capacity: 16,
  },
  {
    id: "U_SHAPE",
    name: "U-shape",
    description: "Open center for facilitation, discussion, and demonstrations.",
    arrangement: "U-shape",
    capacity: 12,
  },
  {
    id: "THEATER",
    name: "Theater",
    description: "Rows of seating for presentations and larger groups.",
    arrangement: "Theater",
    capacity: 20,
  },
  {
    id: "INTERVIEW",
    name: "Interview",
    description: "A compact two-person setup with video and recording space.",
    arrangement: "Interview",
    capacity: 2,
  },
];

const ELEMENT_LABELS: Record<FloorplanElementType, string> = {
  WALL: "Wall",
  ROOM: "Room",
  DOOR: "Door",
  WINDOW: "Window",
  STAIRS: "Stairs",
  ELEVATOR: "Elevator",
  BATHROOM: "Bathroom",
  COLUMN: "Column",
  RECEPTION: "Reception",
  ENTRANCE: "Entrance",
  EXIT: "Exit",
  FIRE_EXIT: "Fire exit",
  UTILITY: "Utility area",
  DESK: "Desk",
  SEAT: "Bookable seat",
  MODE_ZONE: "Bookable room setup",
  AMENITY: "Amenity",
  FURNITURE: "Furniture",
  SIGNAGE: "Sign",
  POWER: "Power outlet",
  ACCESS_READER: "Access reader",
  CAMERA: "Camera",
  FIRE_EXTINGUISHER: "Fire extinguisher",
  TRASH: "Waste station",
  PLANT: "Plant",
};

const SHELL_GROUPS: Array<{ name: string; types: FloorplanElementType[] }> = [
  { name: "Structure", types: ["WALL", "ROOM", "DOOR", "WINDOW", "COLUMN"] },
  { name: "Navigation", types: ["ENTRANCE", "EXIT", "FIRE_EXIT", "STAIRS", "ELEVATOR"] },
  { name: "Facilities", types: ["BATHROOM", "RECEPTION", "UTILITY"] },
];

const LAYOUT_GROUPS: Array<{ name: string; types: FloorplanElementType[] }> = [
  { name: "Workspace", types: ["DESK", "SEAT", "MODE_ZONE", "FURNITURE"] },
  { name: "Amenities", types: ["AMENITY", "POWER", "SIGNAGE", "PLANT", "TRASH"] },
  { name: "Access and safety", types: ["ACCESS_READER", "CAMERA", "FIRE_EXTINGUISHER"] },
];

const DAY_OPTIONS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" },
];

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

function titleCaseType(type: FloorplanElementType) {
  return ELEMENT_LABELS[type] ?? type.toLowerCase().replaceAll("_", " ");
}

function isBookableElement(element: FloorplanElement) {
  return element.type === "SEAT" || element.type === "MODE_ZONE";
}

function bookableResourcePrefix(element: FloorplanElement) {
  return element.type === "MODE_ZONE" ? "mode" : "seat";
}

function makeResourceId(element: FloorplanElement) {
  const label = slugify(element.label || titleCaseType(element.type)) || bookableResourcePrefix(element);
  return `${bookableResourcePrefix(element)}-${label}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneElements(elements: FloorplanElement[]) {
  return elements.map((element) => ({
    ...element,
    meta: element.meta ? { ...element.meta } : undefined,
    points: element.points ? [...element.points] : undefined,
  }));
}

function makeDefaultFloor(locationId: string, levelIndex: number): FloorDoc {
  return {
    id: uid("floor"),
    locationId,
    name: levelIndex === 0 ? "Level 1" : `Level ${levelIndex + 1}`,
    levelIndex,
    canvasWidth: 1100,
    canvasHeight: 650,
    background: { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, locked: true },
  };
}

function makeDefaultShell(floorId: string): ShellDoc {
  return {
    id: "main",
    floorId,
    updatedAt: Date.now(),
    elements: [
      {
        id: uid("wall"),
        type: "WALL",
        label: "Main wall",
        shape: "RECT",
        x: 80,
        y: 80,
        width: 920,
        height: 20,
        rotation: 0,
        fill: "rgba(148,163,184,0.65)",
      },
      {
        id: uid("door"),
        type: "DOOR",
        label: "Main entrance",
        shape: "RECT",
        x: 90,
        y: 100,
        width: 90,
        height: 16,
        rotation: 0,
        fill: "rgba(71,85,105,0.32)",
        meta: { doorType: "STANDARD", isAdaAccessible: true, isEgress: false },
      },
    ],
  };
}

function makeDefaultLayout(floorId: string): LayoutVariant {
  return {
    id: uid("layout"),
    floorId,
    name: "Default setup",
    status: "DRAFT",
    updatedAt: Date.now(),
    elements: [
      {
        id: uid("seat"),
        type: "SEAT",
        shape: "RECT",
        label: "Desk 1",
        resourceId: "seat-desk-1",
        x: 140,
        y: 180,
        width: 120,
        height: 90,
        rotation: 0,
        fill: "rgba(186,230,253,0.72)",
        meta: { capacity: 1, customerVisible: true, accessible: false, powerAvailable: true },
      },
    ],
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
    label: titleCaseType(type),
    visible: true,
  };

  if (type === "DOOR") {
    return {
      ...base,
      width: 90,
      height: 16,
      fill: "rgba(71,85,105,0.32)",
      meta: { doorType: "STANDARD", isAdaAccessible: true, isEgress: false },
    };
  }
  if (type === "WINDOW") return { ...base, width: 120, height: 14, fill: "rgba(125,211,252,0.42)" };
  if (type === "WALL") return { ...base, fill: "rgba(148,163,184,0.65)" };
  if (type === "SEAT") {
    return {
      ...base,
      label: "Bookable desk",
      resourceId: `seat-desk-${Math.random().toString(36).slice(2, 7)}`,
      fill: "rgba(186,230,253,0.72)",
      meta: { capacity: 1, customerVisible: true, accessible: false, powerAvailable: true },
    };
  }
  if (type === "MODE_ZONE") {
    return {
      ...base,
      label: "Conference room",
      resourceId: `mode-conference-${Math.random().toString(36).slice(2, 7)}`,
      width: 320,
      height: 220,
      fill: "rgba(191,219,254,0.52)",
      meta: {
        capacity: 6,
        arrangement: "Boardroom",
        customerVisible: true,
        videoConferencing: false,
        display: false,
        whiteboard: false,
        cateringAvailable: false,
        addOnIds: [],
      },
    };
  }
  if (type === "BATHROOM") {
    return {
      ...base,
      fill: "rgba(186,230,253,0.58)",
      meta: { bathroomType: "ALL_GENDER", isAdaAccessible: true },
    };
  }
  if (type === "ELEVATOR") return { ...base, fill: "rgba(203,213,225,0.55)", meta: { direction: "BOTH", isAdaAccessible: true } };
  if (type === "STAIRS") return { ...base, fill: "rgba(203,213,225,0.55)", meta: { direction: "UP" } };
  if (type === "FURNITURE") return { ...base, fill: "rgba(226,232,240,0.9)" };
  if (type === "DESK") return { ...base, width: 140, height: 70, fill: "rgba(226,232,240,0.9)" };
  return base;
}

function makeFurniture(label: string, x: number, y: number, width: number, height: number, meta?: Record<string, unknown>): FloorplanElement {
  return {
    id: uid("furniture"),
    type: "FURNITURE",
    shape: "RECT",
    label,
    x,
    y,
    width,
    height,
    rotation: 0,
    fill: "rgba(226,232,240,0.92)",
    meta,
  };
}

function createTemplateElements(template: SetupTemplate): FloorplanElement[] {
  const resourceId = `mode-${slugify(template.name)}-${Math.random().toString(36).slice(2, 7)}`;
  const zone: FloorplanElement = {
    id: uid("mode"),
    type: "MODE_ZONE",
    shape: "RECT",
    label: template.name,
    resourceId,
    x: 190,
    y: 100,
    width: 720,
    height: 450,
    rotation: 0,
    fill: "rgba(219,234,254,0.38)",
    stroke: "#64748b",
    strokeWidth: 2,
    meta: {
      capacity: template.capacity,
      arrangement: template.arrangement,
      customerVisible: true,
      videoConferencing: template.id === "INTERVIEW",
      display: template.id === "CLASSROOM" || template.id === "THEATER",
      whiteboard: template.id === "BOARDROOM" || template.id === "U_SHAPE" || template.id === "CLASSROOM",
      cateringAvailable: false,
      addOnIds: [],
    },
  };

  const furniture: FloorplanElement[] = [];
  if (template.id === "BOARDROOM") {
    furniture.push(makeFurniture("Boardroom table", 360, 240, 380, 150, { role: "table" }));
    for (let index = 0; index < 4; index += 1) {
      furniture.push(makeFurniture("Chair", 385 + index * 86, 175, 54, 44, { role: "chair" }));
      furniture.push(makeFurniture("Chair", 385 + index * 86, 410, 54, 44, { role: "chair" }));
    }
    furniture.push(makeFurniture("Chair", 285, 285, 54, 44, { role: "chair" }));
    furniture.push(makeFurniture("Chair", 760, 285, 54, 44, { role: "chair" }));
  }
  if (template.id === "CLASSROOM") {
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        furniture.push(makeFurniture("Training table", 285 + column * 135, 190 + row * 78, 104, 50, { role: "table", seats: 1 }));
      }
    }
    furniture.push(makeFurniture("Presentation display", 430, 120, 250, 34, { role: "display" }));
  }
  if (template.id === "U_SHAPE") {
    furniture.push(makeFurniture("Left table", 300, 190, 90, 260, { role: "table" }));
    furniture.push(makeFurniture("Top table", 390, 175, 320, 90, { role: "table" }));
    furniture.push(makeFurniture("Right table", 710, 190, 90, 260, { role: "table" }));
    for (let index = 0; index < 4; index += 1) {
      furniture.push(makeFurniture("Chair", 420 + index * 80, 120, 50, 42, { role: "chair" }));
      furniture.push(makeFurniture("Chair", 235, 220 + index * 58, 50, 42, { role: "chair" }));
      furniture.push(makeFurniture("Chair", 815, 220 + index * 58, 50, 42, { role: "chair" }));
    }
  }
  if (template.id === "THEATER") {
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        furniture.push(makeFurniture("Chair", 300 + column * 100, 205 + row * 68, 58, 44, { role: "chair" }));
      }
    }
    furniture.push(makeFurniture("Presentation display", 400, 120, 300, 36, { role: "display" }));
  }
  if (template.id === "INTERVIEW") {
    furniture.push(makeFurniture("Interview table", 430, 260, 240, 110, { role: "table" }));
    furniture.push(makeFurniture("Chair", 470, 185, 58, 48, { role: "chair" }));
    furniture.push(makeFurniture("Chair", 570, 395, 58, 48, { role: "chair" }));
    furniture.push(makeFurniture("Camera position", 745, 285, 64, 54, { role: "camera" }));
  }

  return [zone, ...furniture];
}

function validateLayout(layout: LayoutVariant | undefined): ValidationIssue[] {
  if (!layout) return [{ severity: "ERROR", message: "Choose a setup before publishing." }];

  const issues: ValidationIssue[] = [];
  const bookable = layout.elements.filter(isBookableElement);
  if (!layout.name.trim()) issues.push({ severity: "ERROR", message: "Give the setup a customer-facing name." });
  if (!bookable.length) issues.push({ severity: "ERROR", message: "Add at least one bookable room setup or desk." });

  const resourceIds = new Set<string>();
  bookable.forEach((element) => {
    const name = element.label?.trim() || titleCaseType(element.type);
    if (!element.label?.trim()) issues.push({ severity: "ERROR", message: `${name} needs a customer-facing name.` });
    if (!element.resourceId?.trim()) issues.push({ severity: "ERROR", message: `${name} is not connected to a booking resource.` });
    if (element.resourceId && resourceIds.has(element.resourceId)) {
      issues.push({ severity: "ERROR", message: `${name} shares a booking resource with another object.` });
    }
    if (element.resourceId) resourceIds.add(element.resourceId);
    if (Number(element.meta?.capacity ?? 0) < 1) issues.push({ severity: "ERROR", message: `${name} needs a capacity of at least one.` });
    if (element.visible === false || element.meta?.customerVisible === false) {
      issues.push({ severity: "WARNING", message: `${name} is hidden from customers and will not be offered.` });
    }
  });

  if (bookable.some((element) => element.type === "MODE_ZONE") && !bookable.some((element) => Array.isArray(element.meta?.addOnIds) && element.meta.addOnIds.length > 0)) {
    issues.push({ severity: "WARNING", message: "No optional add-ons are attached to this conference setup." });
  }

  return issues;
}

function useDialogFocus(open: boolean) {
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autofocus = dialog.querySelector<HTMLElement>("[autofocus]");
      const firstControl = dialog.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (autofocus ?? firstControl ?? dialog).focus();
    });

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((control) => control.getClientRects().length > 0);
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trapFocus);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  return dialogRef;
}

function useMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

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
  const [selectedLocationId, setSelectedLocationId] = useState<string>();
  const [floors, setFloors] = useState<FloorDoc[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string>();
  const [shellDoc, setShellDoc] = useState<ShellDoc | null>(null);
  const [layouts, setLayouts] = useState<LayoutVariant[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<string>();
  const [activeTab, setActiveTab] = useState<ActiveTab>("SHELL");
  const [activeTool, setActiveTool] = useState<ActiveTool>("SELECT");
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboardElements, setClipboardElements] = useState<FloorplanElement[]>([]);
  const [history, setHistory] = useState<{ past: FloorplanElement[][]; future: FloorplanElement[][] }>({ past: [], future: [] });
  const [isInitializing, setIsInitializing] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("SAVED");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("NONE");
  const [desktopAddOpen, setDesktopAddOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSelectedId, setPreviewSelectedId] = useState<string>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newLocationOpen, setNewLocationOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [recentlyDeleted, setRecentlyDeleted] = useState<LayoutVariant | null>(null);
  const [notice, setNotice] = useState<{ tone: "SUCCESS" | "ERROR" | "INFO"; message: string } | null>(null);
  const [catalogAddOns, setCatalogAddOns] = useState<CatalogAddOn[]>([]);
  const [catalogSetups, setCatalogSetups] = useState<CatalogResponse["setups"]>([]);
  const pasteCounterRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveErrorRef = useRef<string | null>(null);
  const revisionSourceRef = useRef<Record<string, string>>({});

  const { ref: canvasContainerRef, bounds: canvasBounds } = useMeasure();
  const { ref: previewCanvasRef, bounds: previewCanvasBounds } = useMeasure();

  const activeLocation = useMemo(
    () => locations.find((location) => location.id === selectedLocationId) ?? locations[0],
    [locations, selectedLocationId]
  );
  const activeFloor = useMemo(() => floors.find((floor) => floor.id === activeFloorId) ?? floors[0], [floors, activeFloorId]);
  const activeLayout = useMemo(
    () => layouts.find((layout) => layout.id === activeLayoutId) ?? layouts[0],
    [layouts, activeLayoutId]
  );
  const currentElements = useMemo(
    () => (activeTab === "SHELL" ? shellDoc?.elements ?? [] : activeLayout?.elements ?? []),
    [activeTab, shellDoc?.elements, activeLayout?.elements]
  );
  const normalizedSelectedIds = useMemo(
    () => (selectedIds.length ? selectedIds : selectedId ? [selectedId] : []),
    [selectedId, selectedIds]
  );
  const selectedEl = useMemo(() => {
    if (!selectedId) return undefined;
    return currentElements.find((element) => element.id === selectedId);
  }, [currentElements, selectedId]);
  const layoutReadOnly = activeTab === "LAYOUT" && activeLayout?.status === "PUBLISHED";
  const validationIssues = useMemo(() => validateLayout(activeLayout), [activeLayout]);
  const validationErrors = validationIssues.filter((issue) => issue.severity === "ERROR");
  const bookableElements = useMemo(
    () => activeLayout?.elements.filter(isBookableElement) ?? [],
    [activeLayout?.elements]
  );
  const previewSelected = useMemo(
    () => activeLayout?.elements.find((element) => element.id === previewSelectedId),
    [activeLayout?.elements, previewSelectedId]
  );

  const resetSelection = () => {
    setSelectedId(undefined);
    setSelectedIds([]);
  };

  const resetHistory = () => setHistory({ past: [], future: [] });

  const pushHistorySnapshot = (snapshot: FloorplanElement[]) => {
    setHistory((previous) => ({ past: [...previous.past.slice(-49), cloneElements(snapshot)], future: [] }));
  };

  const runSave = async (operation: () => Promise<void>, failureMessage: string) => {
    const revision = ++saveRevisionRef.current;
    setSaveState("SAVING");

    const queuedSave = saveQueueRef.current.catch(() => undefined).then(operation);
    saveQueueRef.current = queuedSave.then(
      () => undefined,
      () => undefined
    );

    try {
      await queuedSave;
      if (revision === saveRevisionRef.current) {
        saveErrorRef.current = null;
        setSaveState("SAVED");
      }
      return true;
    } catch (error) {
      console.error(error);
      if (revision === saveRevisionRef.current) {
        saveErrorRef.current = failureMessage;
        setSaveState("ERROR");
      }
      setNotice({ tone: "ERROR", message: failureMessage });
      return false;
    }
  };

  const loadFloorContext = async (locationId: string, floorId?: string) => {
    const loadedFloors = await getFloors(locationId);
    setFloors(loadedFloors);
    const floor = loadedFloors.find((candidate) => candidate.id === floorId) ?? loadedFloors[0];
    if (!floor) {
      setActiveFloorId(undefined);
      setShellDoc(null);
      setLayouts([]);
      setActiveLayoutId(undefined);
      resetSelection();
      resetHistory();
      return;
    }

    setActiveFloorId(floor.id);
    const [shell, floorLayouts] = await Promise.all([getShell(locationId, floor.id), getLayouts(locationId, floor.id)]);

    if (shell) setShellDoc(shell);
    else {
      const nextShell = makeDefaultShell(floor.id);
      await saveShell(locationId, floor.id, nextShell);
      setShellDoc(nextShell);
    }

    if (floorLayouts.length) {
      setLayouts(floorLayouts);
      setActiveLayoutId(floorLayouts[0].id);
    } else {
      const nextLayout = makeDefaultLayout(floor.id);
      await saveLayout(locationId, floor.id, nextLayout);
      setLayouts([nextLayout]);
      setActiveLayoutId(nextLayout.id);
    }

    resetSelection();
    resetHistory();
    setSaveState("SAVED");
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
          await saveFloor(firstLocationId, firstFloor);
          await saveShell(firstLocationId, firstFloor.id, firstShell);
          await saveLayout(firstLocationId, firstFloor.id, firstLayout);
          setFloors([firstFloor]);
          setActiveFloorId(firstFloor.id);
          setShellDoc(firstShell);
          setLayouts([firstLayout]);
          setActiveLayoutId(firstLayout.id);
        } else {
          await loadFloorContext(firstLocationId, loadedFloors[0]?.id);
        }
      } catch (error) {
        console.error("Failed to initialize space designer:", error);
        setNotice({ tone: "ERROR", message: "The visual designer could not be loaded." });
      } finally {
        setIsInitializing(false);
      }
    }

    async function loadAddOns() {
      try {
        const result = await getCatalog({});
        setCatalogSetups(result.data.setups);
        setCatalogAddOns(result.data.addOns.filter((addOn) => addOn.published));
      } catch (error) {
        console.error("Failed to load space add-ons:", error);
      }
    }

    void load();
    void loadAddOns();
  }, [user]);

  useEffect(() => {
    if (!recentlyDeleted) return;
    const timer = window.setTimeout(() => setRecentlyDeleted(null), 10000);
    return () => window.clearTimeout(timer);
  }, [recentlyDeleted]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewOpen) setPreviewOpen(false);
      else if (publishOpen) setPublishOpen(false);
      else if (deleteOpen) setDeleteOpen(false);
      else if (newLocationOpen) setNewLocationOpen(false);
      else if (mobilePanel !== "NONE") setMobilePanel("NONE");
      else if (desktopAddOpen) setDesktopAddOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteOpen, desktopAddOpen, mobilePanel, newLocationOpen, previewOpen, publishOpen]);

  const updateShell = async (elements: FloorplanElement[]) => {
    if (!selectedLocationId || !activeFloor || !shellDoc) return;
    const next: ShellDoc = { ...shellDoc, floorId: activeFloor.id, elements, updatedAt: Date.now(), updatedBy: user?.uid };
    setShellDoc(next);
    await runSave(
      () => saveShell(selectedLocationId, activeFloor.id, next),
      "The floor plan was not saved. Try again before leaving this screen."
    );
  };

  const updateLayout = async (nextLayout: LayoutVariant) => {
    if (!selectedLocationId || !activeFloor || nextLayout.status === "PUBLISHED") return;
    const updatedLayout: LayoutVariant = {
      ...nextLayout,
      floorId: activeFloor.id,
      updatedAt: Date.now(),
      updatedBy: user?.uid,
      status: "DRAFT",
    };
    setLayouts((previous) => previous.map((layout) => (layout.id === updatedLayout.id ? updatedLayout : layout)));
    await runSave(
      () => saveLayout(selectedLocationId, activeFloor.id, updatedLayout),
      "The setup was not saved. Try again before publishing."
    );
  };

  const applyElements = (nextElements: FloorplanElement[], options?: { recordHistory?: boolean }) => {
    if (layoutReadOnly) return;
    if (options?.recordHistory ?? true) pushHistorySnapshot(currentElements);
    if (activeTab === "SHELL") void updateShell(nextElements);
    else if (activeLayout) void updateLayout({ ...activeLayout, elements: nextElements });
  };

  const handleUndo = () => {
    if (layoutReadOnly) return;
    setHistory((previous) => {
      if (!previous.past.length) return previous;
      const snapshot = previous.past[previous.past.length - 1];
      applyElements(cloneElements(snapshot), { recordHistory: false });
      return { past: previous.past.slice(0, -1), future: [cloneElements(currentElements), ...previous.future] };
    });
    resetSelection();
  };

  const handleRedo = () => {
    if (layoutReadOnly) return;
    setHistory((previous) => {
      if (!previous.future.length) return previous;
      const snapshot = previous.future[0];
      applyElements(cloneElements(snapshot), { recordHistory: false });
      return { past: [...previous.past, cloneElements(currentElements)], future: previous.future.slice(1) };
    });
    resetSelection();
  };

  const handleCopy = () => {
    const copied = currentElements.filter((element) => normalizedSelectedIds.includes(element.id));
    if (!copied.length) return;
    setClipboardElements(cloneElements(copied));
  };

  const handlePaste = () => {
    if (!clipboardElements.length || layoutReadOnly) return;
    const pasteOffset = 24 * (pasteCounterRef.current + 1);
    pasteCounterRef.current += 1;
    const pasted = clipboardElements.map((element) => ({
      ...element,
      id: uid(element.type.toLowerCase()),
      resourceId: isBookableElement(element) && element.resourceId ? `${element.resourceId}-copy-${Math.random().toString(36).slice(2, 5)}` : element.resourceId,
      x: element.x + pasteOffset,
      y: element.y + pasteOffset,
    }));
    applyElements([...currentElements, ...pasted]);
    setSelectedIds(pasted.map((element) => element.id));
    setSelectedId(pasted[0]?.id);
  };

  const updateSelected = (patch: Partial<FloorplanElement>) => {
    if (!normalizedSelectedIds.length || layoutReadOnly) return;
    applyElements(currentElements.map((element) => (normalizedSelectedIds.includes(element.id) ? { ...element, ...patch } : element)));
  };

  const updateSelectedMeta = (patch: Record<string, unknown>) => {
    if (!selectedEl) return;
    updateSelected({ meta: { ...(selectedEl.meta ?? {}), ...patch } });
  };

  const handleGroupSelected = () => {
    if (layoutReadOnly || normalizedSelectedIds.length < 2) return;
    const groupId = uid("group");
    applyElements(
      currentElements.map((element) =>
        normalizedSelectedIds.includes(element.id) ? { ...element, groupId } : element
      )
    );
  };

  const handleUngroupSelected = () => {
    if (layoutReadOnly || !normalizedSelectedIds.length) return;
    const selectedGroupIds = new Set(
      currentElements
        .filter((element) => normalizedSelectedIds.includes(element.id) && element.groupId)
        .map((element) => element.groupId)
    );
    applyElements(
      currentElements.map((element) =>
        normalizedSelectedIds.includes(element.id) || (element.groupId && selectedGroupIds.has(element.groupId))
          ? { ...element, groupId: undefined }
          : element
      )
    );
  };

  const nudgeElement = (elementId: string, deltaX: number, deltaY: number) => {
    if (layoutReadOnly) return;
    const target = currentElements.find((element) => element.id === elementId);
    const ids = target?.groupId
      ? currentElements.filter((element) => element.groupId === target.groupId).map((element) => element.id)
      : [elementId];
    setSelectedId(elementId);
    setSelectedIds(ids);
    applyElements(
      currentElements.map((element) =>
        ids.includes(element.id) ? { ...element, x: element.x + deltaX, y: element.y + deltaY } : element
      )
    );
  };

  const handleAddFloor = async () => {
    if (!selectedLocationId) return;
    const next = makeDefaultFloor(selectedLocationId, floors.length);
    const nextShell = makeDefaultShell(next.id);
    const nextLayout = makeDefaultLayout(next.id);
    const saved = await runSave(async () => {
      await saveFloor(selectedLocationId, next);
      await saveShell(selectedLocationId, next.id, nextShell);
      await saveLayout(selectedLocationId, next.id, nextLayout);
    }, "The new floor could not be created.");
    if (!saved) return;
    setFloors((previous) => [...previous, next]);
    setActiveFloorId(next.id);
    setShellDoc(nextShell);
    setLayouts([nextLayout]);
    setActiveLayoutId(nextLayout.id);
    resetSelection();
    resetHistory();
  };

  const handleAddElement = (type: FloorplanElementType) => {
    if (layoutReadOnly) return;
    const created = createElement(type);
    if (activeTab === "SHELL") {
      if (!shellDoc || !isShellType(type)) return;
      applyElements([...shellDoc.elements, created]);
    } else {
      if (!activeLayout || isShellType(type)) return;
      applyElements([...activeLayout.elements, created]);
    }
    setSelectedId(created.id);
    setSelectedIds([created.id]);
    setDesktopAddOpen(false);
    setMobilePanel("NONE");
    setRightOpen(true);
  };


  const handleDuplicateSelected = () => {
    if (!normalizedSelectedIds.length || layoutReadOnly) return;
    const source = currentElements.filter((element) => normalizedSelectedIds.includes(element.id));
    const duplicated = source.map((element) => ({
      ...element,
      id: uid(element.type.toLowerCase()),
      resourceId: isBookableElement(element) && element.resourceId
        ? `${element.resourceId}-copy-${Math.random().toString(36).slice(2, 5)}`
        : element.resourceId,
      x: element.x + 24,
      y: element.y + 24,
      meta: element.meta ? { ...element.meta } : undefined,
    }));
    applyElements([...currentElements, ...duplicated]);
    setSelectedIds(duplicated.map((element) => element.id));
    setSelectedId(duplicated[0]?.id);
  };

  const handleDeleteSelected = () => {
    if (!normalizedSelectedIds.length || layoutReadOnly) return;
    applyElements(currentElements.filter((element) => !normalizedSelectedIds.includes(element.id)));
    resetSelection();
  };

  const handleBgUpload = async (file: File) => {
    if (!selectedLocationId || !activeFloor) return;
    setSaveState("SAVING");
    try {
      const uploaded = await uploadFloorBackground(selectedLocationId, activeFloor.id, file);
      const nextFloor: FloorDoc = {
        ...activeFloor,
        background: {
          ...(activeFloor.background ?? { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, locked: true }),
          storagePath: uploaded.storagePath,
          downloadUrl: uploaded.downloadUrl,
        },
      };
      await saveFloor(selectedLocationId, nextFloor);
      setFloors((previous) => previous.map((floor) => (floor.id === nextFloor.id ? nextFloor : floor)));
      setSaveState("SAVED");
    } catch (error) {
      console.error(error);
      setSaveState("ERROR");
      setNotice({ tone: "ERROR", message: "The floor-plan image could not be uploaded." });
    }
  };

  const handleRemoveBg = async () => {
    if (!selectedLocationId || !activeFloor?.background?.storagePath) return;
    const storagePath = activeFloor.background.storagePath;
    const nextFloor: FloorDoc = {
      ...activeFloor,
      background: { ...activeFloor.background, storagePath: undefined, downloadUrl: undefined },
    };
    const saved = await runSave(async () => {
      await deleteFloorBackground(storagePath);
      await saveFloor(selectedLocationId, nextFloor);
    }, "The floor-plan background could not be removed.");
    if (saved) setFloors((previous) => previous.map((floor) => (floor.id === nextFloor.id ? nextFloor : floor)));
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
    setFloors((previous) => previous.map((floor) => (floor.id === nextFloor.id ? nextFloor : floor)));
    await runSave(() => saveFloor(selectedLocationId, nextFloor), "The background settings were not saved.");
  };

  const handleCreateLayout = async () => {
    if (!selectedLocationId || !activeFloor) return;
    const nextLayout: LayoutVariant = {
      id: uid("layout"),
      floorId: activeFloor.id,
      name: `Untitled setup ${layouts.length + 1}`,
      status: "DRAFT",
      updatedAt: Date.now(),
      updatedBy: user?.uid,
      elements: [],
    };
    const saved = await runSave(() => saveLayout(selectedLocationId, activeFloor.id, nextLayout), "The new setup could not be created.");
    if (!saved) return;
    setLayouts((previous) => [...previous, nextLayout]);
    setActiveLayoutId(nextLayout.id);
    setActiveTab("LAYOUT");
    resetSelection();
    resetHistory();
    setMobilePanel("NONE");
    setDesktopAddOpen(false);
  };

  const handleCreateTemplateLayout = async (template: SetupTemplate) => {
    if (!selectedLocationId || !activeFloor) return;
    const elements = createTemplateElements(template);
    const nextLayout: LayoutVariant = {
      id: uid("layout"),
      floorId: activeFloor.id,
      name: template.name,
      status: "DRAFT",
      updatedAt: Date.now(),
      updatedBy: user?.uid,
      effectiveRules: {
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "08:00",
        endTime: "18:00",
        precedence: "SCHEDULED",
        priority: 0,
        oneOffOverrideWindows: [],
      },
      elements,
    };
    const saved = await runSave(() => saveLayout(selectedLocationId, activeFloor.id, nextLayout), "The setup template could not be created.");
    if (!saved) return;
    setLayouts((previous) => [...previous, nextLayout]);
    setActiveLayoutId(nextLayout.id);
    setActiveTab("LAYOUT");
    setSelectedId(elements[0]?.id);
    setSelectedIds(elements[0]?.id ? [elements[0].id] : []);
    resetHistory();
    setDesktopAddOpen(false);
    setMobilePanel("NONE");
    setRightOpen(true);
  };

  const handleDuplicateLayout = async (source = activeLayout) => {
    if (!selectedLocationId || !activeFloor || !source) return;
    const isLiveRevision = source.status === "PUBLISHED";
    const copyToken = Math.random().toString(36).slice(2, 7);
    const clone: LayoutVariant = {
      ...source,
      id: uid("layout"),
      name: isLiveRevision ? source.name : `${source.name} Copy`,
      status: "DRAFT",
      updatedAt: Date.now(),
      updatedBy: user?.uid,
      elements: source.elements.map((element) => ({
        ...element,
        id: uid(element.type.toLowerCase()),
        resourceId:
          !isLiveRevision && isBookableElement(element) && element.resourceId
            ? `${element.resourceId}-copy-${copyToken}`
            : element.resourceId,
        meta: element.meta ? { ...element.meta } : undefined,
      })),
    };
    const saved = await runSave(() => saveLayout(selectedLocationId, activeFloor.id, clone), "The setup draft could not be created.");
    if (!saved) return;
    if (isLiveRevision) {
      revisionSourceRef.current[clone.id] = source.id;
      window.sessionStorage.setItem(`hi-designer-revision:${clone.id}`, source.id);
    }
    setLayouts((previous) => [...previous, clone]);
    setActiveLayoutId(clone.id);
    setActiveTab("LAYOUT");
    resetSelection();
    resetHistory();
    setNotice({ tone: "INFO", message: "A draft copy was created. The live setup remains unchanged until you publish." });
  };

  const updateActiveLayoutDetails = (patch: Partial<LayoutVariant>) => {
    if (!activeLayout || activeLayout.status === "PUBLISHED") return;
    void updateLayout({ ...activeLayout, ...patch });
  };

  const handlePreparePublish = () => {
    setPublishOpen(true);
    setDesktopAddOpen(false);
  };

  const handlePublishLayout = async () => {
    if (!selectedLocationId || !activeFloor || !activeLayout || validationErrors.length) return;
    setPublishing(true);
    setNotice(null);

    try {
      await saveQueueRef.current.catch(() => undefined);
      if (saveErrorRef.current) {
        throw new Error(saveErrorRef.current);
      }

      const revisionSourceLayoutId =
        revisionSourceRef.current[activeLayout.id] ??
        window.sessionStorage.getItem(`hi-designer-revision:${activeLayout.id}`) ??
        undefined;
      const revisionSourcePath = revisionSourceLayoutId
        ? `locations/${selectedLocationId}/floors/${activeFloor.id}/layouts/${revisionSourceLayoutId}`
        : undefined;

      await publishLayout(selectedLocationId, activeFloor.id, activeLayout.id);
      const layoutPath = `locations/${selectedLocationId}/floors/${activeFloor.id}/layouts/${activeLayout.id}`;
      const visibleBookables = activeLayout.elements.filter(
        (element) => isBookableElement(element) && element.resourceId && element.visible !== false && element.meta?.customerVisible !== false
      );
      const visibleResourceIds = new Set(visibleBookables.map((element) => element.resourceId).filter(Boolean));

      const upsertResults = await Promise.allSettled(
        visibleBookables.map((element) => {
          const existingRevisionSetup = revisionSourcePath
            ? catalogSetups.find(
                (setup) => setup.layoutPath === revisionSourcePath && setup.resourceId === element.resourceId
              )
            : undefined;
          return saveCustomerSetup({
            id:
              existingRevisionSetup?.id ??
              `${selectedLocationId}-${activeFloor.id}-${activeLayout.id}-${element.resourceId}`,
            layoutPath,
            name: element.label || activeLayout.name,
            serviceType: element.type === "MODE_ZONE" ? "CONFERENCE" : "DESK",
            resourceId: element.resourceId,
            capacity: Math.max(1, Number(element.meta?.capacity ?? 1)),
            arrangement: String(element.meta?.arrangement ?? ""),
            description: element.notes || "",
            addOnIds: Array.isArray(element.meta?.addOnIds) ? element.meta.addOnIds : [],
            published: true,
          });
        })
      );

      const staleRevisionSetups = revisionSourcePath
        ? catalogSetups.filter(
            (setup) =>
              setup.layoutPath === revisionSourcePath &&
              setup.published &&
              !visibleResourceIds.has(setup.resourceId)
          )
        : [];
      const retireResults = await Promise.allSettled(
        staleRevisionSetups.map((setup) =>
          setCustomerSetupPublished({ setupId: setup.id, published: false })
        )
      );
      const catalogResults = [...upsertResults, ...retireResults];
      const catalogSucceeded = catalogResults.every((result) => result.status === "fulfilled");

      if (revisionSourceLayoutId && catalogSucceeded) {
        const previousLiveLayout = layouts.find((layout) => layout.id === revisionSourceLayoutId);
        if (previousLiveLayout) {
          await saveLayout(selectedLocationId, activeFloor.id, {
            ...previousLiveLayout,
            status: "DRAFT",
            updatedAt: Date.now(),
            updatedBy: user?.uid,
          });
        }
        delete revisionSourceRef.current[activeLayout.id];
        window.sessionStorage.removeItem(`hi-designer-revision:${activeLayout.id}`);
      }

      const [refreshed, refreshedCatalog] = await Promise.all([
        getLayouts(selectedLocationId, activeFloor.id),
        getCatalog({}),
      ]);
      setLayouts(refreshed);
      setCatalogSetups(refreshedCatalog.data.setups);
      setCatalogAddOns(refreshedCatalog.data.addOns.filter((addOn) => addOn.published));
      setActiveLayoutId(activeLayout.id);
      setPublishOpen(false);
      setSaveState("SAVED");

      if (!catalogSucceeded) {
        setNotice({
          tone: "ERROR",
          message: "The visual setup is live, but one or more customer booking choices could not be updated. The previous live setup was kept as a fallback.",
        });
      } else {
        setNotice({
          tone: "SUCCESS",
          message: `${activeLayout.name} is live. ${visibleBookables.length} customer choice${visibleBookables.length === 1 ? "" : "s"} published.`,
        });
      }
    } catch (error) {
      console.error(error);
      setNotice({ tone: "ERROR", message: "The setup could not be published. Your draft is still saved." });
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteLayout = async () => {
    if (!selectedLocationId || !activeFloor || !activeLayout || layouts.length <= 1) return;
    setDeleting(true);
    try {
      await deleteLayout(selectedLocationId, activeFloor.id, activeLayout.id);
      const deleted = activeLayout;
      const refreshed = await getLayouts(selectedLocationId, activeFloor.id);
      setLayouts(refreshed);
      setActiveLayoutId(refreshed[0]?.id);
      setRecentlyDeleted(deleted);
      setDeleteOpen(false);
      resetSelection();
      resetHistory();
      setNotice({ tone: "INFO", message: `${deleted.name} was removed. You can undo this action for a short time.` });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "ERROR", message: "The setup could not be removed." });
    } finally {
      setDeleting(false);
    }
  };

  const undoDeleteLayout = async () => {
    if (!recentlyDeleted || !selectedLocationId || !activeFloor) return;
    const restored = { ...recentlyDeleted, status: "DRAFT" as const, updatedAt: Date.now(), updatedBy: user?.uid };
    const saved = await runSave(() => saveLayout(selectedLocationId, activeFloor.id, restored), "The setup could not be restored.");
    if (!saved) return;
    setLayouts((previous) => [...previous, restored]);
    setActiveLayoutId(restored.id);
    setRecentlyDeleted(null);
    setNotice({ tone: "SUCCESS", message: `${restored.name} was restored as a draft.` });
  };

  const handleLocationChange = async (locationId: string) => {
    setSelectedLocationId(locationId);
    resetSelection();
    resetHistory();
    await loadFloorContext(locationId);
  };

  const createNewLocation = async () => {
    const name = newLocationName.trim();
    if (!name) return;
    const location: LocationDoc = {
      id: uid("location"),
      name,
      slug: slugify(name),
      createdAt: Date.now(),
      timezone: "America/New_York",
    };
    const saved = await runSave(() => saveLocation(location), "The location could not be created.");
    if (!saved) return;
    setLocations((previous) => [...previous, location].sort((a, b) => a.name.localeCompare(b.name)));
    setNewLocationName("");
    setNewLocationOpen(false);
    await handleLocationChange(location.id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (isTyping) return;

      if (mod && key === "c") {
        event.preventDefault();
        handleCopy();
      } else if (mod && key === "v") {
        event.preventDefault();
        handlePaste();
      } else if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if (mod && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        handleRedo();
      } else if (mod && key === "g" && event.shiftKey) {
        event.preventDefault();
        handleUngroupSelected();
      } else if (mod && key === "g") {
        event.preventDefault();
        handleGroupSelected();
      } else if (key === "delete" || key === "backspace") {
        event.preventDefault();
        handleDeleteSelected();
      } else if (key === "v") {
        setActiveTool("SELECT");
      } else if (key === "h") {
        setActiveTool("PAN");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (isInitializing) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50" role="status" aria-label="Loading visual designer">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    resetSelection();
    setMobilePanel("NONE");
  };

  const selectObject = (id: string) => {
    const target = currentElements.find((element) => element.id === id);
    const ids = target?.groupId
      ? currentElements.filter((element) => element.groupId === target.groupId).map((element) => element.id)
      : [id];
    setSelectedId(id);
    setSelectedIds(ids);
    setRightOpen(true);
    setMobilePanel("NONE");
  };

  const addLibrary = (
    <AddLibrary
      activeTab={activeTab}
      onAddElement={handleAddElement}
      onCreateBlank={() => void handleCreateLayout()}
      onCreateTemplate={(template) => void handleCreateTemplateLayout(template)}
      onClose={() => {
        setDesktopAddOpen(false);
        setMobilePanel("NONE");
      }}
    />
  );

  const navigator = (
    <ProjectNavigator
      floors={floors}
      activeFloor={activeFloor}
      layouts={layouts}
      activeLayout={activeLayout}
      activeTab={activeTab}
      currentElements={currentElements}
      selectedIds={normalizedSelectedIds}
      onAddFloor={() => void handleAddFloor()}
      onAddLocation={() => setNewLocationOpen(true)}
      onSelectFloor={(floor) => void loadFloorContext(selectedLocationId ?? floor.locationId, floor.id)}
      onSelectLayout={(layout) => {
        setActiveLayoutId(layout.id);
        setActiveTab("LAYOUT");
        resetSelection();
        resetHistory();
        setMobilePanel("NONE");
      }}
      onNewSetup={() => { setDesktopAddOpen(true); setMobilePanel("ADD"); }}
      onDuplicate={() => void handleDuplicateLayout()}
      onEditDraft={() => void handleDuplicateLayout()}
      onDelete={() => setDeleteOpen(true)}
      onSelectObject={selectObject}
      onNudgeObject={nudgeElement}
    />
  );

  const inspector = (
    <Inspector
      activeTab={activeTab}
      activeLayout={activeLayout}
      selectedEl={selectedEl}
      selectedIds={normalizedSelectedIds}
      readOnly={layoutReadOnly}
      catalogAddOns={catalogAddOns}
      activeFloor={activeFloor}
      advancedOpen={advancedOpen}
      onAdvancedChange={setAdvancedOpen}
      onUpdateElement={updateSelected}
      onUpdateMeta={updateSelectedMeta}
      onUpdateLayout={updateActiveLayoutDetails}
      onUploadBackground={(file) => void handleBgUpload(file)}
      onUpdateBackground={(patch) => void updateFloorBackgroundMeta(patch)}
      onRemoveBackground={() => void handleRemoveBg()}
      onCreateDraft={() => void handleDuplicateLayout()}
      onGroupSelection={handleGroupSelected}
      onUngroupSelection={handleUngroupSelected}
      onDuplicateElement={handleDuplicateSelected}
      onRemoveElement={handleDeleteSelected}
    />
  );

  return (
    <AppShell fullWidth>
      <div className="flex h-[calc(100dvh-4rem)] min-h-[540px] flex-col overflow-hidden bg-slate-100">
        <header className="relative z-30 flex min-h-16 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:px-3">
          <button
            type="button"
            onClick={() => setMobilePanel("NAV")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 lg:hidden"
            aria-label="Open floors, setups, and objects"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 items-center gap-2 lg:min-w-[270px]">
            <MapPin className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden="true" />
            <select
              value={selectedLocationId}
              onChange={(event) => void handleLocationChange(event.target.value)}
              className="min-h-11 min-w-0 max-w-[150px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 focus:border-slate-900 focus:ring-slate-900 sm:max-w-[230px]"
              aria-label="Location"
            >
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setNewLocationOpen(true)}
              className="hidden min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 sm:inline-flex"
              aria-label="Add location"
              title="Add location"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

          <div className="inline-flex min-h-11 rounded-full bg-slate-100 p-1" aria-label="Designer mode">
            <button
              type="button"
              onClick={() => selectTab("SHELL")}
              className={`rounded-full px-3 text-sm font-semibold transition sm:px-4 ${activeTab === "SHELL" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              aria-pressed={activeTab === "SHELL"}
            >
              <span className="sm:hidden">Plan</span><span className="hidden sm:inline">Floor plan</span>
            </button>
            <button
              type="button"
              onClick={() => selectTab("LAYOUT")}
              className={`rounded-full px-3 text-sm font-semibold transition sm:px-4 ${activeTab === "LAYOUT" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              aria-pressed={activeTab === "LAYOUT"}
            >
              Setups
            </button>
          </div>

          <div className="hidden items-center gap-1 border-l border-slate-200 pl-2 md:flex">
            <ToolButton label="Select objects (V)" active={activeTool === "SELECT"} onClick={() => setActiveTool("SELECT")}>
              <MousePointer2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Move around canvas (H or Space)" active={activeTool === "PAN"} onClick={() => setActiveTool("PAN")}>
              <Hand className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Undo (Command Z)" disabled={!history.past.length || layoutReadOnly} onClick={handleUndo}>
              <Undo2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Redo (Command Shift Z)" disabled={!history.future.length || layoutReadOnly} onClick={handleRedo}>
              <Redo2 className="h-4 w-4" />
            </ToolButton>
          </div>

          <div className="relative hidden lg:block">
            <button
              type="button"
              onClick={() => setDesktopAddOpen((open) => !open)}
              disabled={layoutReadOnly}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              aria-expanded={desktopAddOpen}
              aria-haspopup="dialog"
            >
              <Plus className="h-4 w-4" /> Add <ChevronDown className="h-4 w-4" />
            </button>
            {desktopAddOpen ? (
              <div className="absolute left-0 top-[calc(100%+10px)] w-[420px] overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
                {addLibrary}
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <SaveIndicator state={saveState} />
            <button
              type="button"
              onClick={() => {
                setPreviewSelectedId(undefined);
                setPreviewOpen(true);
              }}
              disabled={!activeLayout}
              className="hidden min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 sm:inline-flex"
            >
              <Eye className="h-4 w-4" /> Preview
            </button>
            {activeLayout?.status === "PUBLISHED" ? (
              <button
                type="button"
                onClick={() => void handleDuplicateLayout()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-3 text-sm font-semibold text-white sm:px-4"
              >
                <Copy className="h-4 w-4" /><span className="hidden sm:inline">Edit as draft</span><span className="sm:hidden">Draft</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePreparePublish}
                disabled={!activeLayout || activeTab !== "LAYOUT" || saveState === "SAVING"}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
              >
                <CheckCircle2 className="h-4 w-4" /> Publish
              </button>
            )}
          </div>
        </header>

        {notice ? (
          <div
            className={`z-20 flex min-h-11 shrink-0 items-center gap-3 border-b px-4 py-2 text-sm ${notice.tone === "ERROR" ? "border-rose-200 bg-rose-50 text-rose-900" : notice.tone === "SUCCESS" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}
            role={notice.tone === "ERROR" ? "alert" : "status"}
          >
            {notice.tone === "ERROR" ? <AlertCircle className="h-4 w-4 shrink-0" /> : notice.tone === "SUCCESS" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{notice.message}</span>
            {recentlyDeleted ? (
              <button type="button" onClick={() => void undoDeleteLayout()} className="min-h-11 rounded-full border border-current px-3 font-semibold">Undo</button>
            ) : null}
            {notice.message.includes("Customer setups") ? (
              <Link href="/admin/spaces/catalog" className="min-h-11 rounded-full border border-current px-3 py-2 font-semibold">Open catalog</Link>
            ) : null}
            <button type="button" onClick={() => setNotice(null)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-black/5" aria-label="Dismiss message">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          {leftOpen ? (
            <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block" aria-label="Floors, setups, and objects">
              <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b border-slate-100 bg-white px-4">
                <span className="text-sm font-semibold text-slate-900">{activeFloor?.name ?? "Space"}</span>
                <button type="button" onClick={() => setLeftOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Hide navigation panel">
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              {navigator}
            </aside>
          ) : (
            <div className="hidden w-12 shrink-0 border-r border-slate-200 bg-white lg:flex lg:justify-center lg:pt-2">
              <button type="button" onClick={() => setLeftOpen(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Show navigation panel">
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          )}

          <main className="relative flex min-w-0 flex-1 flex-col" aria-label="Visual designer canvas">
            <div ref={canvasContainerRef} className="relative min-h-0 flex-1">
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
                  backgroundScale={activeFloor.background?.scale ?? 1}
                  backgroundOffsetX={activeFloor.background?.offsetX ?? 0}
                  backgroundOffsetY={activeFloor.background?.offsetY ?? 0}
                  stageWidth={canvasBounds.width || undefined}
                  stageHeight={canvasBounds.height || undefined}
                  mode={layoutReadOnly ? "VIEW" : "EDIT"}
                  showViewportControls
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  canvasLabel={`${activeFloor.name}, ${activeTab === "SHELL" ? "floor plan" : activeLayout?.name ?? "setup"}`}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setSelectedIds(id ? [id] : []);
                  }}
                  onSelectIds={(ids) => {
                    setSelectedIds(ids);
                    setSelectedId(ids[0]);
                  }}
                  onShellElementsChange={(elements) => applyElements(elements)}
                  onLayoutElementsChange={(elements) => applyElements(elements)}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">No floor selected</div>
              )}

              {layoutReadOnly ? (
                <div className="absolute inset-x-4 top-4 z-10 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-white/95 p-4 shadow-xl ring-1 ring-slate-200 backdrop-blur">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950">This setup is live and protected.</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-600">Create a draft to make changes without altering what customers currently see.</p>
                  </div>
                  <button type="button" onClick={() => void handleDuplicateLayout()} className="min-h-11 shrink-0 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">Edit as draft</button>
                </div>
              ) : null}
            </div>

            <footer className="hidden min-h-11 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-xs text-slate-500 md:flex">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700">{activeLocation?.name ?? "—"}</span>
                <span aria-hidden="true">›</span>
                <span>{activeFloor?.name ?? "—"}</span>
                <span aria-hidden="true">›</span>
                <span>{activeTab === "SHELL" ? "Floor plan" : activeLayout?.name ?? "Setup"}</span>
              </div>
              <div className="flex items-center gap-3">
                <span>{currentElements.length} object{currentElements.length === 1 ? "" : "s"}</span>
                {normalizedSelectedIds.length ? <span className="font-semibold text-slate-800">{normalizedSelectedIds.length} selected</span> : null}
              </div>
            </footer>

            <div className="grid min-h-16 shrink-0 grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
              <MobileTool label="Browse" active={mobilePanel === "NAV"} onClick={() => setMobilePanel("NAV")}><ListTree className="h-5 w-5" /></MobileTool>
              <MobileTool label="Select" active={activeTool === "SELECT"} onClick={() => { setActiveTool("SELECT"); setMobilePanel("NONE"); }}><MousePointer2 className="h-5 w-5" /></MobileTool>
              <MobileTool label="Add" active={mobilePanel === "ADD"} disabled={layoutReadOnly} onClick={() => setMobilePanel("ADD")}><Plus className="h-5 w-5" /></MobileTool>
              <MobileTool label="Properties" active={mobilePanel === "PROPERTIES"} onClick={() => setMobilePanel("PROPERTIES")}><Settings2 className="h-5 w-5" /></MobileTool>
            </div>
          </main>

          {rightOpen ? (
            <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white xl:block" aria-label="Properties">
              <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b border-slate-100 bg-white px-4">
                <span className="text-sm font-semibold text-slate-900">Properties</span>
                <button type="button" onClick={() => setRightOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Hide properties panel">
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
              {inspector}
            </aside>
          ) : (
            <div className="hidden w-12 shrink-0 border-l border-slate-200 bg-white xl:flex xl:justify-center xl:pt-2">
              <button type="button" onClick={() => setRightOpen(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Show properties panel">
                <PanelRightOpen className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <MobileSheet open={mobilePanel === "NAV"} title="Floors, setups, and objects" onClose={() => setMobilePanel("NONE")}>
        {navigator}
      </MobileSheet>
      <MobileSheet open={mobilePanel === "ADD"} title="Add to the space" onClose={() => setMobilePanel("NONE")}>
        {addLibrary}
      </MobileSheet>
      <MobileSheet open={mobilePanel === "PROPERTIES"} title="Properties" onClose={() => setMobilePanel("NONE")}>
        {inspector}
      </MobileSheet>

      <Modal open={previewOpen} title="Customer preview" onClose={() => setPreviewOpen(false)} size="WIDE">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">{activeLayout?.name ?? "Setup"}</p>
                <p className="mt-1 text-sm text-slate-600">This is how customers can inspect and choose a bookable desk or room arrangement.</p>
              </div>
              <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700">
                {activeLayout?.status === "PUBLISHED" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {activeLayout?.status === "PUBLISHED" ? "Live" : "Draft preview"}
              </span>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_280px]">
            <div ref={previewCanvasRef} className="min-h-[400px]">
              {activeFloor && shellDoc && activeLayout ? (
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
                  layoutElements={activeLayout.elements}
                  backgroundOpacity={activeFloor.background?.opacity ?? 1}
                  backgroundScale={activeFloor.background?.scale ?? 1}
                  backgroundOffsetX={activeFloor.background?.offsetX ?? 0}
                  backgroundOffsetY={activeFloor.background?.offsetY ?? 0}
                  stageWidth={previewCanvasBounds.width || undefined}
                  stageHeight={previewCanvasBounds.height || 500}
                  mode="SELECT"
                  selectedId={previewSelectedId}
                  onSelect={setPreviewSelectedId}
                  canvasLabel={`Customer preview of ${activeLayout.name}`}
                />
              ) : null}
            </div>
            <aside className="border-t border-slate-200 bg-white p-5 lg:border-l lg:border-t-0">
              <h3 className="text-sm font-semibold text-slate-950">Selected choice</h3>
              {previewSelected && isBookableElement(previewSelected) ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{previewSelected.label}</p>
                    <p className="mt-1 text-sm text-slate-600">{String(previewSelected.meta?.arrangement ?? (previewSelected.type === "MODE_ZONE" ? "Conference room" : "Desk"))}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                    <p><span className="font-semibold">Capacity:</span> {Number(previewSelected.meta?.capacity ?? 1)}</p>
                    {Array.isArray(previewSelected.meta?.addOnIds) && previewSelected.meta.addOnIds.length ? (
                      <p className="mt-2"><span className="font-semibold">Optional upgrades:</span> {previewSelected.meta.addOnIds.length}</p>
                    ) : null}
                  </div>
                  <div className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white" role="status"><Check className="h-4 w-4" /> Selection ready</div>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-600">Select an available desk or room setup on the floor plan to review its details.</p>
              )}
            </aside>
          </div>
        </div>
      </Modal>

      <Modal open={publishOpen} title="Review and publish" onClose={() => { if (!publishing) setPublishOpen(false); }}>
        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-slate-950">Make {activeLayout?.name ?? "this setup"} available to customers?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Publishing creates customer booking choices for every visible bookable object in this setup. The live version remains protected from accidental editing.</p>
          </div>

          <div className="space-y-2">
            {validationIssues.length ? validationIssues.map((issue, index) => (
              <div key={`${issue.message}-${index}`} className={`flex gap-3 rounded-2xl p-3 text-sm ${issue.severity === "ERROR" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
                {issue.severity === "ERROR" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{issue.message}</span>
              </div>
            )) : (
              <div className="flex gap-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4 shrink-0" /> Ready to publish.</div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-950">Customer choices</h4>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {bookableElements.map((element) => (
                <div key={element.id} className="flex items-center gap-3 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100"><Armchair className="h-5 w-5 text-slate-600" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-950">{element.label || titleCaseType(element.type)}</p>
                    <p className="text-xs text-slate-500">Capacity {Number(element.meta?.capacity ?? 1)} · {String(element.meta?.arrangement ?? (element.type === "MODE_ZONE" ? "Conference" : "Desk"))}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                    {element.visible !== false && element.meta?.customerVisible !== false ? <><Check className="h-4 w-4" /> Visible</> : <><X className="h-4 w-4" /> Hidden</>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setPublishOpen(false)} disabled={publishing} className="min-h-11 rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700">Keep editing</button>
            <button type="button" onClick={() => void handlePublishLayout()} disabled={publishing || validationErrors.length > 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-45">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Publish setup
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} title="Remove setup" onClose={() => { if (!deleting) setDeleteOpen(false); }}>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-700"><Trash2 className="h-5 w-5" /></div>
          <div>
            <h3 className="text-xl font-semibold text-slate-950">Remove {activeLayout?.name ?? "this setup"}?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">The setup will be removed from this floor. An Undo option will remain available briefly.</p>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDeleteOpen(false)} disabled={deleting} className="min-h-11 rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700">Cancel</button>
            <button type="button" onClick={() => void handleDeleteLayout()} disabled={deleting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-rose-700 px-5 text-sm font-semibold text-white">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove setup
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={newLocationOpen} title="Add location" onClose={() => setNewLocationOpen(false)}>
        <form
          className="space-y-5 p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void createNewLocation();
          }}
        >
          <div>
            <label htmlFor="new-location-name" className="text-sm font-semibold text-slate-800">Location name</label>
            <input
              id="new-location-name"
              autoFocus
              value={newLocationName}
              onChange={(event) => setNewLocationName(event.target.value)}
              placeholder="Hi Coworking Downtown"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base focus:border-slate-900 focus:ring-slate-900"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setNewLocationOpen(false)} className="min-h-11 rounded-full border border-slate-300 px-5 text-sm font-semibold text-slate-700">Cancel</button>
            <button type="submit" disabled={!newLocationName.trim()} className="min-h-11 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-45">Create location</button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-35 ${active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function MobileTool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold disabled:opacity-35 ${active ? "text-slate-950" : "text-slate-500"}`}
      aria-pressed={active}
    >
      {children}<span>{label}</span>
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <div className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-2 text-xs font-semibold md:px-3 ${state === "ERROR" ? "text-rose-700" : "text-slate-500"}`} role="status" aria-live="polite">
      {state === "SAVING" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "ERROR" ? <AlertCircle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      <span className="hidden md:inline">{state === "SAVING" ? "Saving…" : state === "ERROR" ? "Not saved" : "Saved"}</span>
    </div>
  );
}

function AddLibrary({
  activeTab,
  onAddElement,
  onCreateBlank,
  onCreateTemplate,
  onClose,
}: {
  activeTab: ActiveTab;
  onAddElement: (type: FloorplanElementType) => void;
  onCreateBlank: () => void;
  onCreateTemplate: (template: SetupTemplate) => void;
  onClose: () => void;
}) {
  const groups = activeTab === "SHELL" ? SHELL_GROUPS : LAYOUT_GROUPS;
  return (
    <div className="max-h-[70dvh] overflow-y-auto p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{activeTab === "SHELL" ? "Add to floor plan" : "Add to setup"}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Choose a ready-made arrangement or place an individual object.</p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close add menu"><X className="h-4 w-4" /></button>
      </div>

      {activeTab === "LAYOUT" ? (
        <section className="mt-5">
          <div className="flex items-center gap-2"><LayoutTemplate className="h-4 w-4 text-slate-500" /><h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Setup templates</h3></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {SETUP_TEMPLATES.map((template) => (
              <button key={template.id} type="button" onClick={() => onCreateTemplate(template)} className="min-h-24 rounded-2xl border border-slate-200 p-3 text-left hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
                <span className="text-sm font-semibold text-slate-950">{template.name}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{template.description}</span>
                <span className="mt-2 block text-xs font-semibold text-slate-700">Up to {template.capacity}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onCreateBlank} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Blank setup</button>
        </section>
      ) : null}

      <section className={activeTab === "LAYOUT" ? "mt-6 border-t border-slate-200 pt-5" : "mt-5"}>
        {groups.map((group) => (
          <div key={group.name} className="mb-5 last:mb-0">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{group.name}</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {group.types.map((type) => (
                <button key={type} type="button" onClick={() => onAddElement(type)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-left text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
                  <Shapes className="h-4 w-4 shrink-0 text-slate-400" /> {titleCaseType(type)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function ProjectNavigator({
  floors,
  activeFloor,
  layouts,
  activeLayout,
  activeTab,
  currentElements,
  selectedIds,
  onAddFloor,
  onAddLocation,
  onSelectFloor,
  onSelectLayout,
  onNewSetup,
  onDuplicate,
  onEditDraft,
  onDelete,
  onSelectObject,
  onNudgeObject,
}: {
  floors: FloorDoc[];
  activeFloor?: FloorDoc;
  layouts: LayoutVariant[];
  activeLayout?: LayoutVariant;
  activeTab: ActiveTab;
  currentElements: FloorplanElement[];
  selectedIds: string[];
  onAddFloor: () => void;
  onAddLocation: () => void;
  onSelectFloor: (floor: FloorDoc) => void;
  onSelectLayout: (layout: LayoutVariant) => void;
  onNewSetup: () => void;
  onDuplicate: () => void;
  onEditDraft: () => void;
  onDelete: () => void;
  onSelectObject: (id: string) => void;
  onNudgeObject: (id: string, deltaX: number, deltaY: number) => void;
}) {
  return (
    <div className="space-y-7 p-4">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Floors</h2>
          <button type="button" onClick={onAddFloor} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Add floor"><Plus className="h-4 w-4" /></button>
        </div>
        <div className="mt-2 space-y-1">
          {floors.map((floor) => (
            <button key={floor.id} type="button" onClick={() => onSelectFloor(floor)} className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold ${floor.id === activeFloor?.id ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`} aria-current={floor.id === activeFloor?.id ? "page" : undefined}>
              {floor.name}
            </button>
          ))}
        </div>
        <button type="button" onClick={onAddLocation} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"><MapPin className="h-4 w-4" /> Add location</button>
      </section>

      {activeTab === "LAYOUT" ? (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Setups</h2>
            <button type="button" onClick={onNewSetup} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Add setup"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 space-y-1">
            {layouts.map((layout) => (
              <button key={layout.id} type="button" onClick={() => onSelectLayout(layout)} className={`min-h-12 w-full rounded-xl px-3 py-2 text-left ${layout.id === activeLayout?.id ? "bg-slate-100 ring-1 ring-slate-300" : "hover:bg-slate-50"}`} aria-current={layout.id === activeLayout?.id ? "page" : undefined}>
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{layout.name}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${layout.status === "PUBLISHED" ? "text-emerald-700" : "text-slate-500"}`}>
                    {layout.status === "PUBLISHED" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    {layout.status === "PUBLISHED" ? "Live" : "Draft"}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {activeLayout ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={activeLayout.status === "PUBLISHED" ? onEditDraft : onDuplicate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Copy className="h-4 w-4" /> {activeLayout.status === "PUBLISHED" ? "Edit draft" : "Duplicate"}</button>
              <button type="button" onClick={onDelete} disabled={layouts.length <= 1} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-35"><Trash2 className="h-4 w-4" /> Remove</button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <div className="flex items-center gap-2"><ListTree className="h-4 w-4 text-slate-500" /><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Objects</h2></div>
        <p id="object-list-help" className="mt-2 text-xs leading-5 text-slate-500">Select an object here when the canvas is difficult to use. Arrow keys move it; hold Shift for a larger step.</p>
        <div className="mt-3 space-y-1" aria-describedby="object-list-help">
          {currentElements.map((element) => {
            const selected = selectedIds.includes(element.id);
            return (
              <button
                key={element.id}
                type="button"
                onClick={() => onSelectObject(element.id)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 20 : 5;
                  if (event.key === "ArrowLeft") { event.preventDefault(); onNudgeObject(element.id, -step, 0); }
                  if (event.key === "ArrowRight") { event.preventDefault(); onNudgeObject(element.id, step, 0); }
                  if (event.key === "ArrowUp") { event.preventDefault(); onNudgeObject(element.id, 0, -step); }
                  if (event.key === "ArrowDown") { event.preventDefault(); onNudgeObject(element.id, 0, step); }
                }}
                className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm ${selected ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                aria-pressed={selected}
                aria-label={`${element.label || titleCaseType(element.type)}, ${titleCaseType(element.type)}${element.locked ? ", locked" : ""}${element.visible === false ? ", hidden" : ""}${isBookableElement(element) && element.resourceId ? `, bookable, capacity ${Number(element.meta?.capacity ?? 1)}` : ""}`}
              >
                {element.locked ? <Lock className="h-4 w-4 shrink-0" /> : element.visible === false ? <Eye className="h-4 w-4 shrink-0 opacity-50" /> : <Shapes className="h-4 w-4 shrink-0 opacity-60" />}
                <span className="min-w-0 flex-1 truncate">{element.label || titleCaseType(element.type)}</span>
                <span className={`text-[11px] ${selected ? "text-white/70" : "text-slate-400"}`}>{titleCaseType(element.type)}</span>
              </button>
            );
          })}
          {!currentElements.length ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No objects have been added yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

function Inspector({
  activeTab,
  activeLayout,
  selectedEl,
  selectedIds,
  readOnly,
  catalogAddOns,
  activeFloor,
  advancedOpen,
  onAdvancedChange,
  onUpdateElement,
  onUpdateMeta,
  onUpdateLayout,
  onUploadBackground,
  onUpdateBackground,
  onRemoveBackground,
  onCreateDraft,
  onGroupSelection,
  onUngroupSelection,
  onDuplicateElement,
  onRemoveElement,
}: {
  activeTab: ActiveTab;
  activeLayout?: LayoutVariant;
  selectedEl?: FloorplanElement;
  selectedIds: string[];
  readOnly: boolean;
  catalogAddOns: CatalogAddOn[];
  activeFloor?: FloorDoc;
  advancedOpen: boolean;
  onAdvancedChange: (open: boolean) => void;
  onUpdateElement: (patch: Partial<FloorplanElement>) => void;
  onUpdateMeta: (patch: Record<string, unknown>) => void;
  onUpdateLayout: (patch: Partial<LayoutVariant>) => void;
  onUploadBackground: (file: File) => void;
  onUpdateBackground: (patch: Partial<NonNullable<FloorDoc["background"]>>) => void;
  onRemoveBackground: () => void;
  onCreateDraft: () => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  onDuplicateElement: () => void;
  onRemoveElement: () => void;
}) {
  const inputClass = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-slate-900 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";
  const metaAddOnIds = Array.isArray(selectedEl?.meta?.addOnIds) ? selectedEl.meta.addOnIds.map(String) : [];
  const isBookable = selectedEl ? isBookableElement(selectedEl) : false;
  const isConference = selectedEl?.type === "MODE_ZONE";

  return (
    <div className="space-y-7 p-4 pb-10">
      {activeTab === "LAYOUT" && activeLayout ? (
        <section>
          <div className="flex items-center gap-2"><LayoutTemplate className="h-4 w-4 text-slate-500" /><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Setup details</h2></div>
          {readOnly ? (
            <div className="mt-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Live and protected</div>
              <p className="mt-2 text-xs leading-5">Make changes in a draft so customers continue seeing a stable setup.</p>
              <button type="button" onClick={onCreateDraft} className="mt-3 min-h-11 w-full rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">Create editable draft</button>
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">Setup name
                <input value={activeLayout.name} onChange={(event) => onUpdateLayout({ name: event.target.value })} className={inputClass} />
              </label>
              <div>
                <p className="text-sm font-semibold text-slate-700">Available days</p>
                <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="Available days">
                  {DAY_OPTIONS.map((day, index) => {
                    const selected = activeLayout.effectiveRules?.daysOfWeek?.includes(day.value) ?? false;
                    return (
                      <button
                        key={`${day.value}-${index}`}
                        type="button"
                        onClick={() => {
                          const current = activeLayout.effectiveRules?.daysOfWeek ?? [];
                          const daysOfWeek = selected ? current.filter((value) => value !== day.value) : [...current, day.value];
                          onUpdateLayout({
                            effectiveRules: {
                              daysOfWeek,
                              startTime: activeLayout.effectiveRules?.startTime ?? "08:00",
                              endTime: activeLayout.effectiveRules?.endTime ?? "18:00",
                              precedence: activeLayout.effectiveRules?.precedence ?? "SCHEDULED",
                              priority: activeLayout.effectiveRules?.priority ?? 0,
                              oneOffOverrideWindows: activeLayout.effectiveRules?.oneOffOverrideWindows ?? [],
                            },
                          });
                        }}
                        className={`min-h-11 rounded-full text-xs font-semibold ${selected ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                        aria-pressed={selected}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-semibold text-slate-700">From<input type="time" value={activeLayout.effectiveRules?.startTime ?? "08:00"} onChange={(event) => onUpdateLayout({ effectiveRules: { daysOfWeek: activeLayout.effectiveRules?.daysOfWeek ?? [1,2,3,4,5], startTime: event.target.value, endTime: activeLayout.effectiveRules?.endTime ?? "18:00", precedence: activeLayout.effectiveRules?.precedence ?? "SCHEDULED", priority: activeLayout.effectiveRules?.priority ?? 0, oneOffOverrideWindows: activeLayout.effectiveRules?.oneOffOverrideWindows ?? [] } })} className={inputClass} /></label>
                <label className="text-sm font-semibold text-slate-700">Until<input type="time" value={activeLayout.effectiveRules?.endTime ?? "18:00"} onChange={(event) => onUpdateLayout({ effectiveRules: { daysOfWeek: activeLayout.effectiveRules?.daysOfWeek ?? [1,2,3,4,5], startTime: activeLayout.effectiveRules?.startTime ?? "08:00", endTime: event.target.value, precedence: activeLayout.effectiveRules?.precedence ?? "SCHEDULED", priority: activeLayout.effectiveRules?.priority ?? 0, oneOffOverrideWindows: activeLayout.effectiveRules?.oneOffOverrideWindows ?? [] } })} className={inputClass} /></label>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section className={activeTab === "LAYOUT" ? "border-t border-slate-200 pt-6" : ""}>
        <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-slate-500" /><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Selected object</h2></div>
        {selectedIds.length > 1 ? (
          <div className="mt-3 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{selectedIds.length} objects selected</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Group objects to move and select them as one arrangement.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={onGroupSelection} disabled={readOnly} className="min-h-11 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-40">Group</button>
              <button type="button" onClick={onUngroupSelection} disabled={readOnly} className="min-h-11 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-40">Ungroup</button>
            </div>
          </div>
        ) : null}
        {!selectedEl ? (
          <div className="mt-3 rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Select an object to edit it.</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">You can select directly on the canvas or use the accessible Objects list.</p>
          </div>
        ) : selectedIds.length > 1 ? null : (
          <div className="mt-3 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-base font-semibold text-slate-950">{selectedEl.label || titleCaseType(selectedEl.type)}</p><p className="mt-1 text-xs text-slate-500">{titleCaseType(selectedEl.type)}</p></div>
              <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-xs font-semibold text-slate-600">{selectedEl.locked ? <Lock className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{selectedEl.locked ? "Locked" : "Editable"}</span>
            </div>

            <label className="block text-sm font-semibold text-slate-700">Name
              <input value={selectedEl.label ?? ""} onChange={(event) => onUpdateElement({ label: event.target.value })} disabled={readOnly} className={inputClass} />
            </label>

            {isBookable ? (
              <ToggleRow
                label="Bookable"
                description="Customers can select this desk or room setup."
                checked={Boolean(selectedEl.resourceId)}
                disabled={readOnly}
                onChange={(checked) => onUpdateElement({ resourceId: checked ? selectedEl.resourceId || makeResourceId(selectedEl) : undefined })}
              />
            ) : null}

            <ToggleRow
              label="Customer visible"
              description="Show this object in the customer floor-plan view."
              checked={selectedEl.visible !== false && selectedEl.meta?.customerVisible !== false}
              disabled={readOnly}
              onChange={(checked) => onUpdateElement({ visible: checked, meta: { ...(selectedEl.meta ?? {}), customerVisible: checked } })}
            />

            {isBookable ? (
              <label className="block text-sm font-semibold text-slate-700">Capacity
                <input type="number" min={1} max={100} value={Number(selectedEl.meta?.capacity ?? 1)} onChange={(event) => onUpdateMeta({ capacity: Math.max(1, Number(event.target.value)) })} disabled={readOnly} className={inputClass} />
              </label>
            ) : null}

            {isConference ? (
              <>
                <label className="block text-sm font-semibold text-slate-700">Arrangement
                  <select value={String(selectedEl.meta?.arrangement ?? "Boardroom")} onChange={(event) => onUpdateMeta({ arrangement: event.target.value })} disabled={readOnly} className={inputClass}>
                    {SETUP_TEMPLATES.map((template) => <option key={template.id} value={template.arrangement}>{template.name}</option>)}
                    <option value="Custom">Custom</option>
                  </select>
                </label>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Included features</p>
                  <div className="mt-2 space-y-2">
                    <CompactCheck label="Video conferencing" checked={Boolean(selectedEl.meta?.videoConferencing)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ videoConferencing: checked })} icon={<Monitor className="h-4 w-4" />} />
                    <CompactCheck label="Display or TV" checked={Boolean(selectedEl.meta?.display)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ display: checked })} icon={<Monitor className="h-4 w-4" />} />
                    <CompactCheck label="Whiteboard" checked={Boolean(selectedEl.meta?.whiteboard)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ whiteboard: checked })} icon={<Shapes className="h-4 w-4" />} />
                    <CompactCheck label="Catering available" checked={Boolean(selectedEl.meta?.cateringAvailable)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ cateringAvailable: checked })} icon={<Sparkles className="h-4 w-4" />} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-700">Optional add-ons</p><Link href="/admin/spaces/catalog" className="inline-flex min-h-11 items-center text-xs font-semibold text-slate-600 underline underline-offset-2">Manage</Link></div>
                  <div className="mt-2 space-y-2">
                    {catalogAddOns.filter((addOn) => addOn.serviceTypes.includes("CONFERENCE")).map((addOn) => {
                      const checked = metaAddOnIds.includes(addOn.id);
                      return <CompactCheck key={addOn.id} label={`${addOn.name} · $${(addOn.priceCents / 100).toFixed(2)}`} checked={checked} disabled={readOnly} onChange={(nextChecked) => onUpdateMeta({ addOnIds: nextChecked ? [...metaAddOnIds, addOn.id] : metaAddOnIds.filter((id) => id !== addOn.id) })} icon={<Plus className="h-4 w-4" />} />;
                    })}
                    {!catalogAddOns.some((addOn) => addOn.serviceTypes.includes("CONFERENCE")) ? <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">No conference add-ons have been created yet. Add video conferencing, catering, or other upgrades in Customer setups & add-ons.</p> : null}
                  </div>
                </div>
              </>
            ) : null}

            {(selectedEl.type === "SEAT" || selectedEl.type === "DESK") ? (
              <div className="space-y-2">
                <CompactCheck label="Power available" checked={Boolean(selectedEl.meta?.powerAvailable)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ powerAvailable: checked })} icon={<Sparkles className="h-4 w-4" />} />
                <CompactCheck label="Monitor included" checked={Boolean(selectedEl.meta?.monitorIncluded)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ monitorIncluded: checked })} icon={<Monitor className="h-4 w-4" />} />
                <CompactCheck label="Accessible workstation" checked={Boolean(selectedEl.meta?.accessible)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ accessible: checked })} icon={<Accessibility className="h-4 w-4" />} />
              </div>
            ) : null}

            {selectedEl.type === "DOOR" ? (
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-slate-700">Access type
                  <select value={String(selectedEl.meta?.doorType ?? "STANDARD")} onChange={(event) => onUpdateMeta({ doorType: event.target.value })} disabled={readOnly} className={inputClass}>
                    <option value="OPENING">Open doorway</option><option value="STANDARD">Standard door</option><option value="KEY_ENTRY">Key entry</option><option value="SCAN_TO_ENTER">Scan to enter</option><option value="PIN_CODE">PIN code</option><option value="PUSH_BAR">Push bar</option><option value="EMERGENCY_EXIT">Emergency exit</option>
                  </select>
                </label>
                <CompactCheck label="Accessible entrance" checked={Boolean(selectedEl.meta?.isAdaAccessible)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ isAdaAccessible: checked })} icon={<Accessibility className="h-4 w-4" />} />
                <CompactCheck label="Emergency egress" checked={Boolean(selectedEl.meta?.isEgress)} disabled={readOnly} onChange={(checked) => onUpdateMeta({ isEgress: checked })} icon={<DoorOpen className="h-4 w-4" />} />
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={readOnly} onClick={() => onUpdateElement({ locked: !selectedEl.locked })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-40">{selectedEl.locked ? <Lock className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}{selectedEl.locked ? "Unlock" : "Lock"}</button>
              <button type="button" disabled={readOnly} onClick={() => onUpdateElement({ visible: selectedEl.visible === false })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-40"><Eye className="h-4 w-4" />{selectedEl.visible === false ? "Show" : "Hide"}</button>
              <button type="button" disabled={readOnly} onClick={onDuplicateElement} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-40"><Copy className="h-4 w-4" /> Duplicate</button>
              <button type="button" disabled={readOnly} onClick={onRemoveElement} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /> Remove</button>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <button type="button" onClick={() => onAdvancedChange(!advancedOpen)} className="flex min-h-11 w-full items-center justify-between rounded-xl px-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" aria-expanded={advancedOpen}>
                Advanced positioning <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
              </button>
              {advancedOpen ? (
                <div className="mt-3 space-y-4">
                  {isBookable ? <label className="block text-sm font-semibold text-slate-700">Booking resource ID<input value={selectedEl.resourceId ?? ""} onChange={(event) => onUpdateElement({ resourceId: event.target.value || undefined })} disabled={readOnly} className={inputClass} /></label> : null}
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Layer order</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" disabled={readOnly} onClick={() => onUpdateElement({ zIndex: (selectedEl.zIndex ?? 0) - 1 })} className="min-h-11 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-40">Send backward</button>
                      <button type="button" disabled={readOnly} onClick={() => onUpdateElement({ zIndex: (selectedEl.zIndex ?? 0) + 1 })} className="min-h-11 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-40">Bring forward</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="X" value={selectedEl.x} disabled={readOnly} onChange={(value) => onUpdateElement({ x: value })} />
                    <NumberField label="Y" value={selectedEl.y} disabled={readOnly} onChange={(value) => onUpdateElement({ y: value })} />
                    <NumberField label="Width" value={selectedEl.width ?? 120} disabled={readOnly} onChange={(value) => onUpdateElement({ width: value })} />
                    <NumberField label="Height" value={selectedEl.height ?? 100} disabled={readOnly} onChange={(value) => onUpdateElement({ height: value })} />
                    <NumberField label="Rotation" value={selectedEl.rotation ?? 0} disabled={readOnly} onChange={(value) => onUpdateElement({ rotation: value })} />
                    <NumberField label="Layer order" value={selectedEl.zIndex ?? 0} disabled={readOnly} onChange={(value) => onUpdateElement({ zIndex: value })} />
                  </div>
                  <label className="block text-sm font-semibold text-slate-700">Opacity<input type="range" min={0.1} max={1} step={0.05} value={selectedEl.opacity ?? 1} onChange={(event) => onUpdateElement({ opacity: Number(event.target.value) })} disabled={readOnly} className="mt-3 w-full" /></label>
                  <label className="block text-sm font-semibold text-slate-700">Fill color<input value={selectedEl.fill ?? ""} onChange={(event) => onUpdateElement({ fill: event.target.value || undefined })} disabled={readOnly} className={inputClass} /></label>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {activeTab === "SHELL" ? (
        <section className="border-t border-slate-200 pt-6">
          <div className="flex items-center gap-2"><Upload className="h-4 w-4 text-slate-500" /><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Floor-plan image</h2></div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Upload className="h-4 w-4" /> Upload image
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadBackground(file); }} />
          </label>
          <div className="mt-4 space-y-4">
            <label className="block text-sm font-semibold text-slate-700">Image opacity<input type="range" min={0} max={1} step={0.05} value={activeFloor?.background?.opacity ?? 1} onChange={(event) => onUpdateBackground({ opacity: Number(event.target.value) })} className="mt-3 w-full" /></label>
            <label className="block text-sm font-semibold text-slate-700">Image scale<input type="number" min={0.1} step={0.1} value={activeFloor?.background?.scale ?? 1} onChange={(event) => onUpdateBackground({ scale: Number(event.target.value) })} className={inputClass} /></label>
            <button type="button" onClick={onRemoveBackground} disabled={!activeFloor?.background?.storagePath} className="min-h-11 w-full rounded-full border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-35">Remove image</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 p-3 ${disabled ? "opacity-55" : "cursor-pointer hover:bg-slate-50"}`}>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-slate-950" : "bg-slate-300"}`} aria-hidden="true"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`} /></span>
    </label>
  );
}

function CompactCheck({ label, checked, disabled, onChange, icon }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; icon: React.ReactNode }) {
  return (
    <label className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm ${checked ? "border-slate-400 bg-slate-50 text-slate-900" : "border-slate-200 text-slate-600"} ${disabled ? "opacity-55" : "cursor-pointer hover:border-slate-400"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-900" />
      <span className="text-slate-500">{icon}</span><span className="min-w-0 flex-1">{label}</span>{checked ? <Check className="h-4 w-4" /> : null}
    </label>
  );
}

function NumberField({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">{label}
      <input type="number" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm focus:border-slate-900 focus:ring-slate-900 disabled:bg-slate-100" />
    </label>
  );
}

function MobileSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const sheetRef = useDialogFocus(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]" onClick={onClose} aria-label={`Close ${title}`} />
      <section ref={sheetRef} tabIndex={-1} className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[28px] bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={`Close ${title}`}><X className="h-5 w-5" /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Modal({ open, title, onClose, size = "DEFAULT", children }: { open: boolean; title: string; onClose: () => void; size?: "DEFAULT" | "WIDE"; children: React.ReactNode }) {
  const modalRef = useDialogFocus(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={onClose} aria-label={`Close ${title}`} />
      <section ref={modalRef} tabIndex={-1} className={`relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl outline-none sm:rounded-[28px] ${size === "WIDE" ? "h-[90dvh] max-w-6xl" : "max-w-xl"}`}>
        <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={`Close ${title}`}><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
