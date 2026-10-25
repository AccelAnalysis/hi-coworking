"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FloorplanCanvas, type CanvasView } from "@/components/floorplan/FloorplanCanvas";
import { DesignerDialog, dialogButton } from "@/components/floorplan/DesignerDialog";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  LAYOUT_ELEMENT_TYPES,
  SHELL_ELEMENT_TYPES,
  isShellType,
  type FloorDoc,
  type FloorplanElement,
  type FloorplanElementType,
  type LayoutVariant,
  type LocationDoc,
  type ShellDoc,
} from "@hi/shared";
import {
  countUpcomingBookingsForResources,
  deleteFloorBackground,
  deleteFloorCascade,
  deleteLayout,
  deleteLocationCascade,
  ensureDefaultLocation,
  getFloors,
  getLayouts,
  getLocations,
  getShell,
  saveFloor,
  saveLayout,
  saveLocation,
  saveShell,
  uploadFloorBackground,
} from "@/lib/firestore";
import { useAuth } from "@/lib/authContext";
import {
  EMPTY_HISTORY,
  cloneElement,
  createSingleFlight,
  deleteBlockers,
  duplicateLayoutAsDraft,
  elementTypeLabel,
  enumLabel,
  findResourceIdConflict,
  generateResourceId,
  makeDraftLayout,
  needsResourceId,
  nextLayoutName,
  placeElement,
  pushHistory,
  redoHistory,
  resourceIndexForLayout,
  screenToCanvas,
  slugify,
  uid,
  undoHistory,
  type HistoryStacks,
  type ResourceIndexEntry,
} from "@/lib/floorplanBuilder";
import { createDesignerElement, makeEmptyShell, makeFloor } from "@/lib/designerElements";
import { createSaveQueue, type SaveQueueState } from "@/lib/designerSaveQueue";
import {
  DEFAULT_PX_PER_FOOT,
  GRID_PRESETS,
  SNAP_SETTINGS_STORAGE_KEY,
  clampGridFeet,
  gridStepPx,
  parseSnapSettings,
  type SnapSettings,
} from "@/lib/designerSnap";
import {
  AlertCircle,
  Check,
  ClipboardPaste,
  Copy,
  Eye,
  Hand,
  Loader2,
  MapPin,
  MousePointer2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types and constants                                                 */
/* ------------------------------------------------------------------ */

type Tab = "shell" | "layout";
type SaveItem =
  | { kind: "shell"; locationId: string; floorId: string; doc: ShellDoc }
  | { kind: "layout"; locationId: string; floorId: string; doc: LayoutVariant };

type ConfirmDialog = {
  kind: "confirm";
  title: string;
  description: ReactNode;
  items?: string[];
  blockers: string[];
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => Promise<void>;
};
type DialogState = { kind: "add-location" } | { kind: "add-floor" } | { kind: "loading"; title: string } | ConfirmDialog | null;

const LOCATION_STORAGE_KEY = "hi.designer.location";
const shellKey = (locationId: string, floorId: string) => `shell:${locationId}/${floorId}`;
const layoutKey = (locationId: string, floorId: string, layoutId: string) => `layout:${locationId}/${floorId}/${layoutId}`;
const defaultLocationOnce = createSingleFlight();

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-35";
const inputCls =
  "mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 aria-[invalid=true]:border-red-500";
const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-slate-500";

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function formatFeet(px: number) {
  return String(Math.round((px / DEFAULT_PX_PER_FOOT) * 10) / 10);
}

function useMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, bounds };
}

/* ------------------------------------------------------------------ */
/* Small accessible controls                                           */
/* ------------------------------------------------------------------ */

/** Text field that edits a draft and commits on blur or Enter. */
function CommitField({
  label,
  value,
  onCommit,
  validate,
  suffix,
  inputMode,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
  suffix?: string;
  inputMode?: "decimal" | "text";
  hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const commit = () => {
    if (draft === null) return true;
    const problem = validate?.(draft) ?? null;
    setError(problem);
    if (problem) return false;
    if (draft !== value) onCommit(draft);
    setDraft(null);
    return true;
  };
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
        {suffix ? <span className="text-slate-400"> ({suffix})</span> : null}
      </label>
      <input
        id={id}
        value={draft ?? value}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onFocus={() => setDraft(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => {
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
        className={inputCls}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onCommit,
  suffix,
  min,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  suffix: string;
  min?: number;
}) {
  return (
    <CommitField
      label={label}
      suffix={suffix}
      inputMode="decimal"
      value={String(value)}
      validate={(v) => {
        const n = Number(v);
        if (!v.trim() || !Number.isFinite(n)) return "Enter a number.";
        if (min !== undefined && n < min) return `Must be at least ${min}.`;
        return null;
      }}
      onCommit={(v) => onCommit(Number(v))}
    />
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 ${disabled ? "opacity-40" : "hover:bg-slate-50"}`}>
      <span className="text-sm text-slate-800">
        {label}
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
      />
    </label>
  );
}

function ViewMenu({ settings, onChange }: { settings: SnapSettings; onChange: (next: SnapSettings) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const preset = GRID_PRESETS.find((p) => p.feet === settings.gridFeet)?.id ?? "custom";
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const set = (patch: Partial<SnapSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="relative" ref={wrapRef}>
      <button type="button" className={btn} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <Eye className="h-4 w-4" aria-hidden />
        View
      </button>
      {open ? (
        <div role="dialog" aria-label="Grid and snapping" className="absolute right-0 z-30 mt-1 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className={sectionTitle}>Grid</div>
          <ToggleRow label="Show grid" hint="Shortcut: G" checked={settings.showGrid} onChange={(v) => set({ showGrid: v })} />
          <div className="px-2 pb-2">
            <label className="text-xs font-medium text-slate-600" htmlFor="grid-size">
              Grid size
            </label>
            <div className="mt-1 flex gap-2">
              <select
                id="grid-size"
                className={`${inputCls} mt-0`}
                value={preset}
                onChange={(e) => {
                  const p = GRID_PRESETS.find((x) => x.id === e.target.value);
                  if (p) set({ gridFeet: p.feet });
                }}
              >
                {GRID_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <input
                aria-label="Custom grid size in feet"
                type="number"
                min={0.25}
                max={50}
                step={0.25}
                className={`${inputCls} mt-0 w-24`}
                value={settings.gridFeet}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) set({ gridFeet: clampGridFeet(n) });
                }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">In feet. Darker lines mark every 5 or 10 cells.</p>
          </div>
          <div className={`${sectionTitle} mt-2 border-t border-slate-100 pt-3`}>Snapping</div>
          <ToggleRow label="Snap" hint="Shortcut: S · hold Option/Alt to bypass" checked={settings.snap} onChange={(v) => set({ snap: v })} />
          <div className="ml-3 border-l border-slate-100 pl-2">
            <ToggleRow label="To grid" checked={settings.snapGrid} disabled={!settings.snap} onChange={(v) => set({ snapGrid: v })} />
            <ToggleRow label="To angles" hint="Walls 0/45/90°, rotation 15°" checked={settings.snapAngle} disabled={!settings.snap} onChange={(v) => set({ snapAngle: v })} />
            <ToggleRow label="To walls & corners" checked={settings.snapVertices} disabled={!settings.snap} onChange={(v) => set({ snapVertices: v })} />
            <ToggleRow label="To other objects" hint="Edges and centers" checked={settings.snapObjects} disabled={!settings.snap} onChange={(v) => set({ snapObjects: v })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveQueueState; onRetry: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-2 text-sm" aria-live="polite" role="status">
      {state.status === "pending" || state.status === "saving" ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden />
          <span className="text-slate-600">Saving…</span>
        </>
      ) : state.status === "saved" ? (
        <>
          <Check className="h-4 w-4 text-emerald-600" aria-hidden />
          <span className="text-slate-600">Saved</span>
        </>
      ) : state.status === "error" ? (
        <>
          <AlertCircle className="h-4 w-4 text-red-600" aria-hidden />
          <span className="font-medium text-red-700">Couldn’t save</span>
          <button type="button" onClick={onRetry} className={`${btn} text-red-700 ring-1 ring-red-200`}>
            Retry
          </button>
        </>
      ) : (
        <span className="text-slate-500">Changes save automatically</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function BuilderPage() {
  return (
    <RequireAuth requiredRole="admin">
      <BuilderContent />
    </RequireAuth>
  );
}

function BuilderContent() {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.uid;

  const [locations, setLocations] = useState<LocationDoc[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [floors, setFloors] = useState<FloorDoc[]>([]);
  const [activeFloorId, setActiveFloorId] = useState("");
  const [shell, setShell] = useState<ShellDoc | null>(null);
  const [layouts, setLayouts] = useState<LayoutVariant[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState("");
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("layout");
  const [activeTool, setActiveTool] = useState<"SELECT" | "PAN">("SELECT");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<FloorplanElement[]>([]);
  const [histories, setHistories] = useState<Record<string, HistoryStacks>>({});
  const [resourceIndex, setResourceIndex] = useState<ResourceIndexEntry[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saveState, setSaveState] = useState<SaveQueueState>({ status: "idle" });

  const snapStorageKey = `${SNAP_SETTINGS_STORAGE_KEY}:${userId ?? "anon"}`;
  const [snapSettings, setSnapSettingsState] = useState<SnapSettings>(() =>
    parseSnapSettings(typeof window === "undefined" ? null : window.localStorage.getItem(snapStorageKey)),
  );
  const setSnapSettings = useCallback(
    (next: SnapSettings) => {
      setSnapSettingsState(next);
      try {
        window.localStorage.setItem(snapStorageKey, JSON.stringify(next));
      } catch {
        // Private mode or full storage: the settings still apply for this session.
      }
    },
    [snapStorageKey],
  );

  const [queue] = useState(() =>
    createSaveQueue<SaveItem>({
      save: async (_key, item) => {
        if (item.kind === "shell") await saveShell(item.locationId, item.floorId, item.doc);
        else await saveLayout(item.locationId, item.floorId, item.doc);
      },
      onChange: setSaveState,
    }),
  );

  const viewRef = useRef<CanvasView>({ x: 0, y: 0, scale: 1 });
  const loadTokenRef = useRef(0);
  const coalesceRef = useRef<string | null>(null);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const { ref: canvasWrapRef, bounds } = useMeasure();

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);
  const activeFloor = floors.find((f) => f.id === activeFloorId);
  const activeLayout = layouts.find((l) => l.id === activeLayoutId);
  const shellElements = useMemo(() => shell?.elements ?? [], [shell]);
  const layoutElements = useMemo(() => activeLayout?.elements ?? [], [activeLayout]);
  const currentElements = activeTab === "shell" ? shellElements : layoutElements;
  const keyForTab = (tab: Tab) =>
    !selectedLocationId || !activeFloorId
      ? ""
      : tab === "shell"
        ? shellKey(selectedLocationId, activeFloorId)
        : activeLayout
          ? layoutKey(selectedLocationId, activeFloorId, activeLayout.id)
          : "";
  const currentKey = keyForTab(activeTab);
  const currentHistory = (currentKey && histories[currentKey]) || EMPTY_HISTORY;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEl = selectedIds.length === 1 ? currentElements.find((e) => e.id === selectedIds[0]) : undefined;

  // Saved resource ids elsewhere, plus this floor's layouts as currently edited.
  const liveResourceIndex = useMemo(() => {
    const others = resourceIndex.filter((e) => !(e.locationId === selectedLocationId && e.floorId === activeFloorId));
    const local = layouts.flatMap((layout) =>
      resourceIndexForLayout(layout, { locationId: selectedLocationId, locationName: selectedLocation?.name, floorId: activeFloorId }),
    );
    return [...others, ...local];
  }, [resourceIndex, layouts, selectedLocationId, activeFloorId, selectedLocation?.name]);

  /* ---------------- loading ---------------- */

  const rememberLocation = (locationId: string) => {
    try {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, locationId);
      const url = new URL(window.location.href);
      url.searchParams.set("location", locationId);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // Non-fatal.
    }
  };

  const openFloor = async (locationId: string, floor: FloorDoc, token = ++loadTokenRef.current) => {
    setActiveFloorId(floor.id);
    setShell(null);
    setLayouts([]);
    setActiveLayoutId("");
    setSelectedIds([]);
    setContextLoading(true);
    try {
      const [loadedShell, loadedLayouts] = await Promise.all([getShell(locationId, floor.id), getLayouts(locationId, floor.id)]);
      if (token !== loadTokenRef.current) return;
      // Nothing is written on load: a missing shell or layout stays in memory until the first edit.
      setShell(loadedShell ?? makeEmptyShell(floor.id, userId));
      const list = loadedLayouts.length ? loadedLayouts : [makeDraftLayout(floor.id, "Layout 1", userId)];
      setLayouts(list);
      setActiveLayoutId(list[0].id);
    } catch (err) {
      if (token === loadTokenRef.current) setNotice(`Couldn’t load this floor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (token === loadTokenRef.current) setContextLoading(false);
    }
  };

  const openLocation = async (locationId: string) => {
    const token = ++loadTokenRef.current;
    // Finish writes for the old location, then clear everything at once so no
    // edit can be saved under the new location's path with the old floor's data.
    await queue.flush();
    if (token !== loadTokenRef.current) return;
    setSelectedLocationId(locationId);
    setFloors([]);
    setActiveFloorId("");
    setShell(null);
    setLayouts([]);
    setActiveLayoutId("");
    setSelectedIds([]);
    setContextLoading(true);
    rememberLocation(locationId);
    try {
      const loadedFloors = await getFloors(locationId);
      if (token !== loadTokenRef.current) return;
      setFloors(loadedFloors);
      if (loadedFloors[0]) await openFloor(locationId, loadedFloors[0], token);
      else setContextLoading(false);
    } catch (err) {
      if (token === loadTokenRef.current) {
        setNotice(`Couldn’t load floors: ${err instanceof Error ? err.message : String(err)}`);
        setContextLoading(false);
      }
    }
  };

  const buildResourceIndex = async (locs: LocationDoc[]) => {
    const entries: ResourceIndexEntry[] = [];
    for (const loc of locs) {
      const fl = await getFloors(loc.id);
      for (const floor of fl) {
        const ls = await getLayouts(loc.id, floor.id);
        ls.forEach((layout) =>
          entries.push(...resourceIndexForLayout(layout, { locationId: loc.id, locationName: loc.name, floorId: floor.id })),
        );
      }
    }
    return entries;
  };

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        let locs = await getLocations();
        if (!locs.length) {
          // Idempotent: fixed id, create-if-absent transaction, and single flight.
          await defaultLocationOnce("default-location", () => ensureDefaultLocation());
          locs = await getLocations();
        }
        if (cancelled) return;
        setLocations(locs);
        const fromUrl = new URLSearchParams(window.location.search).get("location");
        const fromStorage = window.localStorage.getItem(LOCATION_STORAGE_KEY);
        const initial = [fromUrl, fromStorage].find((id) => id && locs.some((l) => l.id === id)) ?? locs[0]?.id;
        if (initial) await openLocation(initial);
        if (cancelled) return;
        buildResourceIndex(locs)
          .then((entries) => {
            if (!cancelled) setResourceIndex(entries);
          })
          .catch((err) => console.warn("Resource id index unavailable:", err));
      } catch (err) {
        if (!cancelled) setNotice(`Couldn’t load locations: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* ---------------- leave guard ---------------- */

  useEffect(() => {
    const unsaved = () => queue.hasUnsaved() || queue.getState().status === "error";
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (!unsaved()) return;
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.pathname + anchor.search + anchor.hash;
      void queue.flush().then((state) => {
        if (state.status === "error" && !window.confirm("Some changes couldn’t be saved. Leave anyway?")) return;
        router.push(href);
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [queue, router]);

  /* ---------------- editing ---------------- */

  const enqueueLayout = (doc: LayoutVariant, immediate = false) => {
    if (!selectedLocationId || !activeFloorId) return;
    queue.enqueue(
      layoutKey(selectedLocationId, activeFloorId, doc.id),
      { kind: "layout", locationId: selectedLocationId, floorId: activeFloorId, doc },
      { immediate },
    );
  };

  const writeElements = (tab: Tab, next: FloorplanElement[]) => {
    if (!selectedLocationId || !activeFloorId) return;
    const stamp = { updatedAt: Date.now(), ...(userId ? { updatedBy: userId } : {}) };
    if (tab === "shell") {
      if (!shell) return;
      const doc: ShellDoc = { ...shell, elements: next, ...stamp };
      setShell(doc);
      queue.enqueue(shellKey(selectedLocationId, activeFloorId), { kind: "shell", locationId: selectedLocationId, floorId: activeFloorId, doc });
      return;
    }
    if (!activeLayout) return;
    const doc: LayoutVariant = { ...activeLayout, elements: next, ...stamp };
    setLayouts((prev) => prev.map((l) => (l.id === doc.id ? doc : l)));
    enqueueLayout(doc);
  };

  /** Every element change goes through here, so it is saved and undoable. */
  const applyElements = (next: FloorplanElement[], opts?: { coalesce?: string; tab?: Tab }) => {
    const tab = opts?.tab ?? activeTab;
    const key = keyForTab(tab);
    if (!key) return;
    const before = tab === "shell" ? shellElements : layoutElements;
    const coalesceId = opts?.coalesce ? `${key}:${opts.coalesce}` : null;
    if (!coalesceId || coalesceRef.current !== coalesceId) {
      setHistories((prev) => ({ ...prev, [key]: pushHistory(prev[key] ?? EMPTY_HISTORY, before) }));
    }
    coalesceRef.current = coalesceId;
    writeElements(tab, next);
  };

  const updateSelected = (patch: Partial<FloorplanElement>, coalesce?: string) => {
    if (!selectedEl) return;
    applyElements(
      currentElements.map((el) => (el.id === selectedEl.id ? { ...el, ...patch } : el)),
      coalesce ? { coalesce: `${selectedEl.id}:${coalesce}` } : undefined,
    );
  };

  const undo = () => {
    if (!currentKey) return;
    const result = undoHistory(currentHistory, currentElements);
    if (!result) return;
    coalesceRef.current = null;
    setHistories((prev) => ({ ...prev, [currentKey]: result.stacks }));
    writeElements(activeTab, result.elements);
    setSelectedIds((ids) => ids.filter((id) => result.elements.some((e) => e.id === id)));
  };

  const redo = () => {
    if (!currentKey) return;
    const result = redoHistory(currentHistory, currentElements);
    if (!result) return;
    coalesceRef.current = null;
    setHistories((prev) => ({ ...prev, [currentKey]: result.stacks }));
    writeElements(activeTab, result.elements);
  };

  const takenResourceIds = () =>
    new Set([...liveResourceIndex.map((e) => e.resourceId), ...currentElements.map((e) => e.resourceId ?? "")]);
  const locationScope = () => selectedLocation?.slug || selectedLocation?.name || "location";

  const viewportCenter = () => screenToCanvas({ x: (bounds.width || 800) / 2, y: (bounds.height || 500) / 2 }, viewRef.current);

  const addElement = (type: FloorplanElementType) => {
    const tab: Tab = isShellType(type) ? "shell" : "layout";
    if (tab === "layout" && !activeLayout) return;
    if (tab !== activeTab) setActiveTab(tab);
    const resourceId = needsResourceId(type) ? generateResourceId(type, locationScope(), takenResourceIds()) : undefined;
    const target = tab === "shell" ? shellElements : layoutElements;
    const created = placeElement(createDesignerElement(type, resourceId), viewportCenter(), target, gridStepPx(snapSettings));
    applyElements([...target, created], { tab });
    setSelectedIds([created.id]);
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    applyElements(currentElements.filter((e) => !selectedSet.has(e.id)));
    setSelectedIds([]);
  };

  const copySelected = () => {
    const picked = currentElements.filter((e) => selectedSet.has(e.id));
    if (picked.length) setClipboard(picked.map(cloneElement));
  };

  const paste = () => {
    if (!clipboard.length) return;
    const allowed = clipboard.filter((el) => (activeTab === "shell" ? isShellType(el.type) : !isShellType(el.type)));
    if (!allowed.length) {
      setNotice(
        activeTab === "shell"
          ? "Those items belong to a layout. Switch to Furniture & seats to paste them."
          : "Those items belong to the building shell. Switch to Building shell to paste them.",
      );
      return;
    }
    const taken = takenResourceIds();
    const pasted = allowed.map((el) => {
      const copy: FloorplanElement = { ...cloneElement(el), id: uid(el.type.toLowerCase()), x: el.x + 24, y: el.y + 24 };
      if (copy.resourceId) {
        const fresh = generateResourceId(el.type, locationScope(), taken);
        taken.add(fresh);
        copy.resourceId = fresh;
      }
      return copy;
    });
    applyElements([...currentElements, ...pasted]);
    setSelectedIds(pasted.map((e) => e.id));
    setClipboard(pasted.map(cloneElement));
  };

  const selectAll = () => setSelectedIds(currentElements.filter((e) => !e.locked).map((e) => e.id));

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    setSelectedIds([]);
    coalesceRef.current = null;
  };

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shortcuts never fire while typing in a field or while a dialog is open.
      if (dialog || isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "a") {
        // Only when the canvas has focus; elsewhere Cmd/Ctrl+A still selects page text.
        if (!canvasRegionRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === "c") {
        if (!selectedIds.length) return;
        e.preventDefault();
        copySelected();
        return;
      }
      if (mod && key === "v") {
        if (!clipboard.length) return;
        e.preventDefault();
        paste();
        return;
      }
      if (mod || e.altKey) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setSelectedIds([]);
      } else if (key === "g") {
        setSnapSettings({ ...snapSettings, showGrid: !snapSettings.showGrid });
      } else if (key === "s") {
        setSnapSettings({ ...snapSettings, snap: !snapSettings.snap });
      } else if (key === "v") {
        setActiveTool("SELECT");
      } else if (key === "h") {
        setActiveTool("PAN");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------- locations / floors / layouts ---------------- */

  const closeDialog = () => {
    if (dialogBusy) return;
    setDialog(null);
    setDialogError(null);
    setNewName("");
  };

  const runDialog = async (task: () => Promise<void>) => {
    setDialogBusy(true);
    setDialogError(null);
    try {
      await task();
      setDialog(null);
      setNewName("");
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : String(err));
    } finally {
      setDialogBusy(false);
    }
  };

  const createLocation = async (name: string) => {
    const slugBase = slugify(name) || "location";
    const taken = new Set(locations.map((l) => l.slug));
    let slug = slugBase;
    for (let n = 2; taken.has(slug); n += 1) slug = `${slugBase}-${n}`;
    const location: LocationDoc = { id: uid("location"), name: name.trim(), slug, createdAt: Date.now(), updatedAt: Date.now() };
    await saveLocation(location);
    await saveFloor(location.id, makeFloor(location.id, 0));
    setLocations((prev) => [...prev, location].sort((a, b) => a.name.localeCompare(b.name)));
    await openLocation(location.id);
  };

  const createFloor = async (name: string) => {
    if (!selectedLocationId) return;
    const levelIndex = floors.reduce((max, f) => Math.max(max, f.levelIndex + 1), 0);
    const floor = makeFloor(selectedLocationId, levelIndex, name.trim() || undefined);
    await saveFloor(selectedLocationId, floor);
    await queue.flush();
    setFloors((prev) => [...prev, floor]);
    await openFloor(selectedLocationId, floor);
  };

  const publishedNames = (list: LayoutVariant[]) => list.filter((l) => l.status === "PUBLISHED").map((l) => l.name);
  const resourceIdsOf = (list: LayoutVariant[]) => list.flatMap((l) => l.elements.map((e) => e.resourceId ?? "")).filter(Boolean);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const bookingCheck = async (list: LayoutVariant[]) => {
    try {
      return { count: await countUpcomingBookingsForResources(resourceIdsOf(list)), failed: false };
    } catch {
      return { count: 0, failed: true };
    }
  };

  const askDeleteLocation = async () => {
    const loc = selectedLocation;
    if (!loc) return;
    setDialog({ kind: "loading", title: `Delete “${loc.name}”?` });
    try {
      const fl = await getFloors(loc.id);
      const all = (await Promise.all(fl.map((f) => getLayouts(loc.id, f.id)))).flat();
      const shells = (await Promise.all(fl.map((f) => getShell(loc.id, f.id)))).filter(Boolean).length;
      const bookings = await bookingCheck(all);
      const blockers = deleteBlockers({ kind: "location", publishedLayoutNames: publishedNames(all), upcomingBookingCount: bookings.count });
      if (bookings.failed) blockers.push("Bookings couldn’t be checked right now. Try again in a moment.");
      setDialog({
        kind: "confirm",
        title: `Delete “${loc.name}”?`,
        description: "This permanently removes the location from the designer. It can’t be undone.",
        items: [
          plural(fl.length, "floor"),
          plural(all.length, "layout"),
          plural(shells, "building outline"),
          ...(fl.some((f) => f.background?.storagePath) ? ["Uploaded background images"] : []),
        ],
        blockers,
        confirmLabel: "Delete location",
        destructive: true,
        onConfirm: async () => {
          queue.discard((key) => key.includes(`:${loc.id}/`));
          await deleteLocationCascade(loc.id);
          const rest = locations.filter((l) => l.id !== loc.id);
          setLocations(rest);
          setResourceIndex((prev) => prev.filter((e) => e.locationId !== loc.id));
          if (rest[0]) {
            await openLocation(rest[0].id);
          } else {
            setSelectedLocationId("");
            setFloors([]);
            setActiveFloorId("");
            setShell(null);
            setLayouts([]);
          }
        },
      });
    } catch (err) {
      setDialog(null);
      setNotice(`Couldn’t prepare the delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const askDeleteFloor = async () => {
    const floor = activeFloor;
    if (!floor || !selectedLocationId) return;
    const locationId = selectedLocationId;
    setDialog({ kind: "loading", title: `Delete “${floor.name}”?` });
    try {
      const saved = await getLayouts(locationId, floor.id);
      const merged = [...saved.filter((s) => !layouts.some((l) => l.id === s.id)), ...layouts];
      const bookings = await bookingCheck(merged);
      const blockers = deleteBlockers({ kind: "floor", publishedLayoutNames: publishedNames(merged), upcomingBookingCount: bookings.count });
      if (bookings.failed) blockers.push("Bookings couldn’t be checked right now. Try again in a moment.");
      setDialog({
        kind: "confirm",
        title: `Delete “${floor.name}”?`,
        description: `This permanently removes the floor from ${selectedLocation?.name ?? "this location"}. It can’t be undone.`,
        items: [
          `Building outline (${plural(shellElements.length, "item")})`,
          `${plural(merged.length, "layout")}${merged.length ? `: ${merged.map((l) => l.name).join(", ")}` : ""}`,
          ...(floor.background?.storagePath ? ["Uploaded background image"] : []),
        ],
        blockers,
        confirmLabel: "Delete floor",
        destructive: true,
        onConfirm: async () => {
          queue.discard((key) => key.includes(`:${locationId}/${floor.id}`));
          await deleteFloorCascade(locationId, floor);
          const rest = floors.filter((f) => f.id !== floor.id);
          setFloors(rest);
          setResourceIndex((prev) => prev.filter((e) => e.floorId !== floor.id));
          if (rest[0]) {
            await openFloor(locationId, rest[0]);
          } else {
            setActiveFloorId("");
            setShell(null);
            setLayouts([]);
          }
        },
      });
    } catch (err) {
      setDialog(null);
      setNotice(`Couldn’t prepare the delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const askDeleteLayout = () => {
    const layout = activeLayout;
    if (!layout || !selectedLocationId || !activeFloorId) return;
    const locationId = selectedLocationId;
    const floorId = activeFloorId;
    setDialog({
      kind: "confirm",
      title: `Delete “${layout.name}”?`,
      description: "This permanently removes the layout. It can’t be undone.",
      items: [`${plural(layout.elements.length, "item")} in this layout`],
      blockers: deleteBlockers({
        kind: "layout",
        publishedLayoutNames: layout.status === "PUBLISHED" ? [layout.name] : [],
        upcomingBookingCount: 0,
      }),
      confirmLabel: "Delete layout",
      destructive: true,
      onConfirm: async () => {
        const key = layoutKey(locationId, floorId, layout.id);
        queue.discard((k) => k === key);
        await deleteLayout(locationId, floorId, layout.id);
        const rest = layouts.filter((l) => l.id !== layout.id);
        setLayouts(rest);
        setActiveLayoutId(rest[0]?.id ?? "");
        setSelectedIds([]);
      },
    });
  };

  const setLayoutStatus = async (layout: LayoutVariant, status: LayoutVariant["status"]) => {
    const doc: LayoutVariant = { ...layout, status, updatedAt: Date.now(), ...(userId ? { updatedBy: userId } : {}) };
    setLayouts((prev) => prev.map((l) => (l.id === doc.id ? doc : l)));
    enqueueLayout(doc, true);
    const result = await queue.flush();
    if (result.status === "error") throw new Error(result.error ?? "Save failed");
  };

  const askPublishToggle = () => {
    const layout = activeLayout;
    if (!layout) return;
    if (layout.status === "PUBLISHED") {
      setDialog({
        kind: "confirm",
        title: `Unpublish “${layout.name}”?`,
        description: "Customers will stop seeing this layout. It stays here as a draft, and you can publish it again at any time.",
        blockers: [],
        confirmLabel: "Unpublish",
        destructive: false,
        onConfirm: () => setLayoutStatus(layout, "DRAFT"),
      });
      return;
    }
    const otherPublished = layouts.filter((l) => l.id !== layout.id && l.status === "PUBLISHED").map((l) => `“${l.name}”`);
    setDialog({
      kind: "confirm",
      title: `Publish “${layout.name}”?`,
      description: `Customers will be able to see this layout.${
        otherPublished.length ? ` ${otherPublished.join(", ")} ${otherPublished.length > 1 ? "are" : "is"} also published on this floor.` : ""
      }`,
      blockers: [],
      confirmLabel: "Publish",
      destructive: false,
      onConfirm: () => setLayoutStatus(layout, "PUBLISHED"),
    });
  };

  const addLayoutAndSelect = (layout: LayoutVariant) => {
    setLayouts((prev) => [...prev, layout]);
    setActiveLayoutId(layout.id);
    setActiveTab("layout");
    setSelectedIds([]);
    enqueueLayout(layout, true);
  };

  const createLayout = () => {
    if (!activeFloorId) return;
    addLayoutAndSelect(makeDraftLayout(activeFloorId, nextLayoutName(layouts), userId));
  };

  const duplicateLayout = () => {
    if (!activeLayout) return;
    addLayoutAndSelect(duplicateLayoutAsDraft(activeLayout, layouts, userId));
  };

  const renameLayout = (name: string) => {
    if (!activeLayout || !name.trim()) return;
    const doc: LayoutVariant = { ...activeLayout, name: name.trim(), updatedAt: Date.now() };
    setLayouts((prev) => prev.map((l) => (l.id === doc.id ? doc : l)));
    enqueueLayout(doc);
  };

  /* ---------------- background ---------------- */

  const baseBackground = { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, locked: true };

  const saveFloorDoc = async (next: FloorDoc) => {
    if (!selectedLocationId) return;
    setFloors((prev) => prev.map((f) => (f.id === next.id ? next : f)));
    try {
      await saveFloor(selectedLocationId, next);
    } catch (err) {
      setNotice(`Couldn’t save the floor: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const uploadBackground = async (file: File) => {
    if (!selectedLocationId || !activeFloor) return;
    try {
      const uploaded = await uploadFloorBackground(selectedLocationId, activeFloor.id, file);
      await saveFloorDoc({
        ...activeFloor,
        background: { ...(activeFloor.background ?? baseBackground), storagePath: uploaded.storagePath, downloadUrl: uploaded.downloadUrl },
      });
    } catch (err) {
      setNotice(`Couldn’t upload the image: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const removeBackground = async () => {
    if (!activeFloor?.background?.storagePath) return;
    try {
      await deleteFloorBackground(activeFloor.background.storagePath);
    } catch (err) {
      console.warn("Background file was already removed:", err);
    }
    const rest = { ...(activeFloor.background ?? baseBackground) };
    delete rest.storagePath;
    delete rest.downloadUrl;
    await saveFloorDoc({ ...activeFloor, background: rest });
  };

  const conflictFor = (value: string) =>
    selectedEl && activeLayout
      ? findResourceIdConflict(value, { elementId: selectedEl.id, layoutId: activeLayout.id, locationId: selectedLocationId }, liveResourceIndex)
      : null;

  const palette = (activeTab === "shell" ? SHELL_ELEMENT_TYPES : LAYOUT_ELEMENT_TYPES) as ReadonlyArray<FloorplanElementType>;
  const canAdd = activeTab === "shell" ? Boolean(shell) : Boolean(activeLayout);
  const gridLabel = GRID_PRESETS.find((p) => p.feet === snapSettings.gridFeet)?.label ?? `${snapSettings.gridFeet} ft`;

  /* ---------------- render ---------------- */

  const confirm = dialog?.kind === "confirm" ? dialog : null;

  return (
    <AppShell fullWidth>
      <div className="flex h-[calc(100dvh-4rem)] min-h-[560px] flex-col bg-slate-50">
        <h1 className="sr-only">Visual designer</h1>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1">
            <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
            <label htmlFor="designer-location" className="sr-only">
              Location
            </label>
            <select
              id="designer-location"
              className={`${inputCls} mt-0 w-56`}
              value={selectedLocationId}
              disabled={loading || !locations.length}
              onChange={(e) => void openLocation(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={() => setDialog({ kind: "add-location" })} aria-label="Add location">
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={btn} disabled={!selectedLocation} onClick={() => void askDeleteLocation()}>
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Delete location…</span>
            </button>
          </div>

          <div role="group" aria-label="What you are editing" className="flex rounded-lg bg-slate-100 p-0.5">
            {(
              [
                ["shell", "Building shell"],
                ["layout", "Furniture & seats"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                aria-pressed={activeTab === tab}
                onClick={() => switchTab(tab)}
                className={`${btn} ${activeTab === tab ? "bg-white text-indigo-700 shadow-sm hover:bg-white" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div role="group" aria-label="Tool" className="flex items-center">
            <button type="button" className={`${btn} ${activeTool === "SELECT" ? "bg-indigo-50 text-indigo-700" : ""}`} aria-pressed={activeTool === "SELECT"} onClick={() => setActiveTool("SELECT")} title="Select (V)">
              <MousePointer2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Select tool</span>
            </button>
            <button type="button" className={`${btn} ${activeTool === "PAN" ? "bg-indigo-50 text-indigo-700" : ""}`} aria-pressed={activeTool === "PAN"} onClick={() => setActiveTool("PAN")} title="Pan (H, or hold Space)">
              <Hand className="h-4 w-4" aria-hidden />
              <span className="sr-only">Pan tool</span>
            </button>
          </div>

          <div role="group" aria-label="Edit" className="flex items-center">
            <button type="button" className={btn} disabled={!currentHistory.past.length} onClick={undo} title="Undo (⌘Z)">
              <Undo2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Undo</span>
            </button>
            <button type="button" className={btn} disabled={!currentHistory.future.length} onClick={redo} title="Redo (⇧⌘Z)">
              <Redo2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Redo</span>
            </button>
            <button type="button" className={btn} disabled={!selectedIds.length} onClick={copySelected} title="Copy (⌘C)">
              <Copy className="h-4 w-4" aria-hidden />
              <span className="sr-only">Copy</span>
            </button>
            <button type="button" className={btn} disabled={!clipboard.length} onClick={paste} title="Paste (⌘V)">
              <ClipboardPaste className="h-4 w-4" aria-hidden />
              <span className="sr-only">Paste</span>
            </button>
            <button type="button" className={btn} disabled={!selectedIds.length} onClick={deleteSelected} title="Delete (⌫)">
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Delete selected</span>
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ViewMenu settings={snapSettings} onChange={setSnapSettings} />
            <SaveIndicator state={saveState} onRetry={() => void queue.retry()} />
          </div>
        </div>

        {notice ? (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <span>{notice}</span>
            <button type="button" className={btn} onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          {/* Left: floors, layouts, palette */}
          <aside className="w-72 shrink-0 space-y-5 overflow-y-auto border-r border-slate-200 bg-white p-3" aria-label="Floors and layouts">
            <section>
              <h2 className={sectionTitle}>Floors</h2>
              <ul className="mt-2 space-y-1">
                {floors.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      aria-current={f.id === activeFloorId ? "true" : undefined}
                      onClick={() => {
                        if (f.id === activeFloorId || !selectedLocationId) return;
                        void queue.flush().then(() => openFloor(selectedLocationId, f));
                      }}
                      className={`${btn} w-full justify-start ${f.id === activeFloorId ? "bg-indigo-50 text-indigo-700" : ""}`}
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1">
                <button type="button" className={btn} disabled={!selectedLocationId} onClick={() => setDialog({ kind: "add-floor" })}>
                  <Plus className="h-4 w-4" aria-hidden /> Add floor
                </button>
                <button type="button" className={btn} disabled={!activeFloor} onClick={() => void askDeleteFloor()}>
                  Delete floor…
                </button>
              </div>
            </section>

            {activeTab === "layout" ? (
              <section>
                <h2 className={sectionTitle}>Layouts</h2>
                <ul className="mt-2 space-y-1">
                  {layouts.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        aria-current={l.id === activeLayoutId ? "true" : undefined}
                        onClick={() => {
                          setActiveLayoutId(l.id);
                          setSelectedIds([]);
                        }}
                        className={`${btn} w-full justify-between ${l.id === activeLayoutId ? "bg-indigo-50 text-indigo-700" : ""}`}
                      >
                        <span className="truncate">{l.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            l.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {l.status === "PUBLISHED" ? "Published" : "Draft"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!layouts.length && activeFloor && !contextLoading ? (
                  <p className="mt-2 text-sm text-slate-500">No layouts yet. Create one to place desks and seats.</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" className={btn} disabled={!activeFloor} onClick={createLayout}>
                    <Plus className="h-4 w-4" aria-hidden /> New layout
                  </button>
                  <button type="button" className={btn} disabled={!activeLayout} onClick={duplicateLayout}>
                    <Copy className="h-4 w-4" aria-hidden /> Duplicate as draft
                  </button>
                </div>
                {activeLayout ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-2">
                    <CommitField
                      key={activeLayout.id}
                      label="Layout name"
                      value={activeLayout.name}
                      validate={(v) => (v.trim() ? null : "Give the layout a name.")}
                      onCommit={renameLayout}
                    />
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className={`${btn} ring-1 ring-slate-200`} onClick={askPublishToggle}>
                        {activeLayout.status === "PUBLISHED" ? "Unpublish…" : "Publish…"}
                      </button>
                      <button type="button" className={`${btn} text-red-700`} onClick={askDeleteLayout}>
                        Delete layout…
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section>
              <h2 className={sectionTitle}>{activeTab === "shell" ? "Add to building shell" : "Add to layout"}</h2>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {palette.map((type) => (
                  <button
                    key={type}
                    type="button"
                    disabled={!canAdd}
                    onClick={() => addElement(type)}
                    className={`${btn} justify-start bg-slate-50 text-left ring-1 ring-slate-200`}
                  >
                    {elementTypeLabel(type)}
                  </button>
                ))}
              </div>
            </section>
          </aside>

          {/* Canvas */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              ref={canvasRegionRef}
              tabIndex={0}
              role="region"
              aria-label="Floor plan canvas. Press Command or Control A to select everything on the active layer."
              onPointerDown={() => canvasRegionRef.current?.focus({ preventScroll: true })}
              className="relative min-h-0 flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600"
            >
              <div ref={canvasWrapRef} className="absolute inset-0">
                {loading || contextLoading ? (
                  <div className="flex h-full items-center justify-center text-slate-500" role="status">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden /> Loading…
                  </div>
                ) : !selectedLocation ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-slate-600">Add a location to start designing.</div>
                ) : !activeFloor ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-slate-600">This location has no floors yet. Add a floor to start.</div>
                ) : (
                  <FloorplanCanvas
                    mode="EDIT"
                    fill
                    fitKey={`${selectedLocationId}/${activeFloorId}`}
                    stageWidth={bounds.width}
                    stageHeight={bounds.height}
                    floorplan={{
                      id: activeFloor.id,
                      name: activeFloor.name,
                      levelIndex: activeFloor.levelIndex,
                      canvasWidth: activeFloor.canvasWidth,
                      canvasHeight: activeFloor.canvasHeight,
                      elements: [],
                    }}
                    shellElements={shellElements}
                    layoutElements={layoutElements}
                    backgroundUrl={activeFloor.background?.downloadUrl}
                    backgroundOpacity={activeFloor.background?.opacity}
                    activeLayer={activeTab}
                    activeTool={activeTool}
                    selectedIds={selectedIds}
                    snapSettings={snapSettings}
                    onSelectIds={setSelectedIds}
                    onShellElementsChange={(next) => applyElements(next, { tab: "shell" })}
                    onLayoutElementsChange={(next) => applyElements(next, { tab: "layout" })}
                    onActivateLayer={(layer, id) => {
                      if (layer !== activeTab) switchTab(layer);
                      setSelectedIds([id]);
                    }}
                    onViewChange={(view) => {
                      viewRef.current = view;
                    }}
                  />
                )}
                {activeFloor && activeTab === "shell" && shell && !shellElements.length && !contextLoading ? (
                  <div className="pointer-events-none absolute inset-x-0 top-4 mx-auto w-fit rounded-lg bg-white/95 px-4 py-2 text-sm text-slate-700 shadow ring-1 ring-slate-200">
                    The building outline is empty. Add walls, doors and windows from the panel on the left.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
              <span>
                Building shell: {plural(shellElements.length, "item")}
                {activeTab === "shell" ? " (editing)" : ""}
              </span>
              <span>
                {activeLayout ? `Layout “${activeLayout.name}”: ${plural(layoutElements.length, "item")}` : "No layout"}
                {activeTab === "layout" ? " (editing)" : ""}
              </span>
              {selectedIds.length ? <span>{selectedIds.length} selected</span> : null}
              <span className="ml-auto">
                Grid {snapSettings.showGrid ? gridLabel : "hidden"} · Snap {snapSettings.snap ? "on" : "off"}
              </span>
            </div>
          </div>

          {/* Right: properties */}
          <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-slate-200 bg-white p-3" aria-label="Properties">
            <h2 className={sectionTitle}>Properties</h2>
            {selectedEl ? (
              <div className="space-y-3" key={selectedEl.id}>
                <p className="text-sm font-medium text-slate-900">{elementTypeLabel(selectedEl.type)}</p>
                <div>
                  <label htmlFor="el-label" className="text-xs font-medium text-slate-600">
                    Label
                  </label>
                  <input
                    id="el-label"
                    className={inputCls}
                    value={selectedEl.label ?? ""}
                    onChange={(e) => updateSelected({ label: e.target.value }, "label")}
                    onBlur={() => {
                      coalesceRef.current = null;
                    }}
                  />
                </div>
                {activeTab === "layout" && (needsResourceId(selectedEl.type) || selectedEl.resourceId) ? (
                  <CommitField
                    label="Resource ID"
                    value={selectedEl.resourceId ?? ""}
                    hint="Links this item to bookings. Must be unique."
                    validate={(v) => (v.trim() ? conflictFor(v.trim()) : null)}
                    onCommit={(v) => {
                      const value = v.trim();
                      if (value) {
                        updateSelected({ resourceId: value });
                      } else {
                        const rest = { ...selectedEl };
                        delete rest.resourceId;
                        applyElements(currentElements.map((el) => (el.id === selectedEl.id ? rest : el)));
                      }
                    }}
                  />
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="X" suffix="ft" value={Number(formatFeet(selectedEl.x))} onCommit={(v) => updateSelected({ x: v * DEFAULT_PX_PER_FOOT })} />
                  <NumberField label="Y" suffix="ft" value={Number(formatFeet(selectedEl.y))} onCommit={(v) => updateSelected({ y: v * DEFAULT_PX_PER_FOOT })} />
                  <NumberField
                    label="Width"
                    suffix="ft"
                    min={0.25}
                    value={Number(formatFeet(selectedEl.width ?? 0))}
                    onCommit={(v) => updateSelected({ width: v * DEFAULT_PX_PER_FOOT })}
                  />
                  <NumberField
                    label="Depth"
                    suffix="ft"
                    min={0.25}
                    value={Number(formatFeet(selectedEl.height ?? 0))}
                    onCommit={(v) => updateSelected({ height: v * DEFAULT_PX_PER_FOOT })}
                  />
                  <NumberField
                    label="Rotation"
                    suffix="°"
                    value={Math.round(selectedEl.rotation ?? 0)}
                    onCommit={(v) => updateSelected({ rotation: ((v % 360) + 360) % 360 })}
                  />
                  {selectedEl.type === "SEAT" || selectedEl.type === "MODE_ZONE" || selectedEl.type === "DESK" ? (
                    <NumberField
                      label="Capacity"
                      suffix="people"
                      min={1}
                      value={Number(selectedEl.meta?.capacity ?? 1)}
                      onCommit={(v) => updateSelected({ meta: { ...(selectedEl.meta ?? {}), capacity: Math.round(v) } })}
                    />
                  ) : null}
                </div>
                {selectedEl.type === "DOOR" ? (
                  <div>
                    <label htmlFor="el-door" className="text-xs font-medium text-slate-600">
                      Door type
                    </label>
                    <select
                      id="el-door"
                      className={inputCls}
                      value={String(selectedEl.meta?.doorType ?? "STANDARD")}
                      onChange={(e) => updateSelected({ meta: { ...(selectedEl.meta ?? {}), doorType: e.target.value } })}
                    >
                      {["OPENING", "STANDARD", "KEY_ENTRY", "SCAN_TO_ENTER", "PIN_CODE", "PUSH_BAR", "EMERGENCY_EXIT"].map((t) => (
                        <option key={t} value={t}>
                          {enumLabel(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {selectedEl.type === "BATHROOM" ? (
                  <div>
                    <label htmlFor="el-bath" className="text-xs font-medium text-slate-600">
                      Restroom type
                    </label>
                    <select
                      id="el-bath"
                      className={inputCls}
                      value={String(selectedEl.meta?.bathroomType ?? "ALL_GENDER")}
                      onChange={(e) => updateSelected({ meta: { ...(selectedEl.meta ?? {}), bathroomType: e.target.value } })}
                    >
                      {[
                        ["M", "Men"],
                        ["F", "Women"],
                        ["ALL_GENDER", "All gender"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <ToggleRow label="Locked" hint="Locked items can’t be moved on the canvas" checked={Boolean(selectedEl.locked)} onChange={(v) => updateSelected({ locked: v })} />
                {activeTab === "layout" ? (
                  <ToggleRow label="Visible to customers" checked={selectedEl.visible ?? true} onChange={(v) => updateSelected({ visible: v })} />
                ) : null}
              </div>
            ) : selectedIds.length > 1 ? (
              <p className="text-sm text-slate-600">{selectedIds.length} items selected. Drag to move them together, or press Delete to remove them.</p>
            ) : (
              <p className="text-sm text-slate-600">Select an item on the canvas to edit it.</p>
            )}

            {activeFloor ? (
              <section className="space-y-2 border-t border-slate-100 pt-4">
                <h2 className={sectionTitle}>Floor background</h2>
                <p className="text-xs text-slate-500">Optional image to trace over. Only admins see it.</p>
                <label className={`${btn} cursor-pointer ring-1 ring-slate-200`}>
                  <Upload className="h-4 w-4" aria-hidden />
                  {activeFloor.background?.downloadUrl ? "Replace image" : "Upload image"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadBackground(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {activeFloor.background?.downloadUrl ? (
                  <>
                    <div>
                      <label htmlFor="bg-opacity" className="text-xs font-medium text-slate-600">
                        Opacity ({Math.round((activeFloor.background.opacity ?? 1) * 100)}%)
                      </label>
                      <input
                        id="bg-opacity"
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        className="block min-h-11 w-full"
                        value={activeFloor.background.opacity ?? 1}
                        onChange={(e) => {
                          const opacity = Number(e.target.value);
                          setFloors((prev) =>
                            prev.map((f) => (f.id === activeFloor.id ? { ...f, background: { ...(f.background ?? baseBackground), opacity } } : f)),
                          );
                        }}
                        onPointerUp={() => {
                          const f = floors.find((x) => x.id === activeFloor.id);
                          if (f) void saveFloorDoc(f);
                        }}
                        onKeyUp={() => {
                          const f = floors.find((x) => x.id === activeFloor.id);
                          if (f) void saveFloorDoc(f);
                        }}
                      />
                    </div>
                    <button type="button" className={`${btn} text-red-700`} onClick={() => void removeBackground()}>
                      Remove image
                    </button>
                  </>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      </div>

      {/* Dialogs */}
      <DesignerDialog
        open={dialog?.kind === "add-location" || dialog?.kind === "add-floor"}
        title={dialog?.kind === "add-floor" ? "Add floor" : "Add location"}
        description={dialog?.kind === "add-floor" ? "The floor starts with an empty building outline." : "The location starts with one floor, Level 1."}
        onClose={closeDialog}
        footer={
          <>
            <button type="button" className={`${dialogButton} text-slate-700 hover:bg-slate-100`} onClick={closeDialog} disabled={dialogBusy}>
              Cancel
            </button>
            <button
              type="submit"
              form="designer-name-form"
              className={`${dialogButton} bg-indigo-600 text-white hover:bg-indigo-700`}
              disabled={dialogBusy || (dialog?.kind === "add-location" && !newName.trim())}
            >
              {dialogBusy ? "Adding…" : dialog?.kind === "add-floor" ? "Add floor" : "Add location"}
            </button>
          </>
        }
      >
        <form
          id="designer-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName;
            void runDialog(() => (dialog?.kind === "add-floor" ? createFloor(name) : createLocation(name)));
          }}
        >
          <label htmlFor="designer-new-name" className="text-sm font-medium text-slate-700">
            {dialog?.kind === "add-floor" ? "Floor name (optional)" : "Location name"}
          </label>
          <input
            id="designer-new-name"
            data-autofocus
            className={inputCls}
            value={newName}
            required={dialog?.kind === "add-location"}
            placeholder={dialog?.kind === "add-floor" ? `Level ${floors.length + 1}` : "e.g. Downtown"}
            onChange={(e) => setNewName(e.target.value)}
          />
          {dialogError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {dialogError}
            </p>
          ) : null}
        </form>
      </DesignerDialog>

      <DesignerDialog
        open={dialog?.kind === "loading" || Boolean(confirm)}
        title={dialog?.kind === "loading" ? dialog.title : (confirm?.title ?? "")}
        description={dialog?.kind === "loading" ? "Checking what will be affected…" : confirm?.description}
        onClose={closeDialog}
        footer={
          <>
            <button type="button" data-autofocus className={`${dialogButton} text-slate-700 hover:bg-slate-100`} onClick={closeDialog} disabled={dialogBusy}>
              {confirm?.blockers.length ? "OK" : "Cancel"}
            </button>
            {confirm && !confirm.blockers.length ? (
              <button
                type="button"
                className={`${dialogButton} ${confirm.destructive ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"} text-white`}
                disabled={dialogBusy}
                onClick={() => void runDialog(confirm.onConfirm)}
              >
                {dialogBusy ? "Working…" : confirm.confirmLabel}
              </button>
            ) : null}
          </>
        }
      >
        {dialog?.kind === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-slate-600" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…
          </div>
        ) : confirm ? (
          <div className="space-y-3 text-sm">
            {confirm.items?.length ? (
              <div>
                <p className="font-medium text-slate-800">{confirm.blockers.length ? "This would remove:" : "This will remove:"}</p>
                <ul className="mt-1 list-disc pl-5 text-slate-700">
                  {confirm.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {confirm.blockers.length ? (
              <div role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
                <p className="font-medium">You can’t do this yet:</p>
                <ul className="mt-1 list-disc pl-5">
                  {confirm.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {dialogError ? (
              <p className="text-red-700" role="alert">
                {dialogError}
              </p>
            ) : null}
          </div>
        ) : null}
      </DesignerDialog>
    </AppShell>
  );
}
