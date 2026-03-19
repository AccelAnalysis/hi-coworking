"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  AdminTerritoryStatus,
  AdminTerritoryType,
  createTerritoryFn,
  releaseScheduledTerritoriesFn,
  updateTerritoryFn,
} from "@/lib/functions";
import { db } from "@/lib/firebase";
import { canTransact, type TerritoryDoc } from "@hi/shared";
import { collection, getDocs, query } from "firebase/firestore";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  Plus,
  Save,
  Search,
  XCircle,
} from "lucide-react";

const STATUS_ORDER: Record<AdminTerritoryStatus, number> = {
  scheduled: 0,
  released: 1,
  paused: 2,
  archived: 3,
};

type TriState = "all" | "yes" | "no";

type SortKey =
  | "releaseDateAsc"
  | "releaseDateDesc"
  | "status"
  | "lastUpdated"
  | "name"
  | "openRfx"
  | "verifiedVendors";

type ReleaseHistoryEntry = {
  status: AdminTerritoryStatus;
  at: number;
  by: string;
  note?: string;
};

type TerritoryRecord = TerritoryDoc & {
  type?: AdminTerritoryType;
  timezone?: string;
  autoReleaseEnabled?: boolean;
  autoPauseEnabled?: boolean;
  regionTag?: string;
  fipsStateCode?: string;
  needsReview?: boolean;
  updatedBy?: string;
  createdBy?: string;
  statusHistory?: ReleaseHistoryEntry[];
  boundaryGeoJSON?: unknown;
};

type TerritoryMetrics = {
  openRfx: number;
  totalRfx: number;
  verifiedVendors: number;
  totalUsers: number;
  activity7d: number;
};

type PreviewMode = {
  verificationStatus: "pending" | "verified";
  membershipTier: "virtual" | "coworking" | "plus";
  role: "issuer" | "vendor" | "both";
  homeTerritory: "this" | "other";
  platformMode: "released" | "read_only";
};

type EditForm = {
  fips: string;
  name: string;
  state: string;
  status: AdminTerritoryStatus;
  releaseDate: string;
  timezone: string;
  type: AdminTerritoryType;
  notes: string;
  regionTag: string;
  fipsStateCode: string;
  autoReleaseEnabled: boolean;
  autoPauseEnabled: boolean;
  needsReview: boolean;
};

const DEFAULT_PREVIEW_MODE: PreviewMode = {
  verificationStatus: "pending",
  membershipTier: "virtual",
  role: "vendor",
  homeTerritory: "this",
  platformMode: "released",
};

const DEFAULT_NEW_TERRITORY: EditForm = {
  fips: "",
  name: "",
  state: "VA",
  status: "scheduled",
  releaseDate: "",
  timezone: "America/New_York",
  type: "county",
  notes: "",
  regionTag: "",
  fipsStateCode: "",
  autoReleaseEnabled: true,
  autoPauseEnabled: false,
  needsReview: false,
};

export default function AdminTerritoriesPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminTerritoriesContent />
    </RequireAuth>
  );
}

function AdminTerritoriesContent() {
  const [territories, setTerritories] = useState<TerritoryRecord[]>([]);
  const [metricsByFips, setMetricsByFips] = useState<Record<string, TerritoryMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminTerritoryStatus[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<AdminTerritoryType[]>([]);
  const [releaseDateFilter, setReleaseDateFilter] = useState<TriState>("all");
  const [autoReleaseFilter, setAutoReleaseFilter] = useState<TriState>("all");
  const [openRfxOnly, setOpenRfxOnly] = useState(false);
  const [activity7dOnly, setActivity7dOnly] = useState(false);
  const [overdueScheduledOnly, setOverdueScheduledOnly] = useState(false);
  const [lowLiquidityOnly, setLowLiquidityOnly] = useState(false);
  const [notesPresentOnly, setNotesPresentOnly] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [missingGeometryOnly, setMissingGeometryOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("status");

  const [expandedFips, setExpandedFips] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewingFips, setPreviewingFips] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(DEFAULT_PREVIEW_MODE);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [territorySnap, rfxSnap, profileSnap, responseSnap] = await Promise.all([
        getDocs(query(collection(db, "territories"))),
        getDocs(query(collection(db, "rfx"))),
        getDocs(query(collection(db, "profiles"))),
        getDocs(query(collection(db, "rfxResponses"))),
      ]);

      const territoryRows = territorySnap.docs.map((d) => d.data() as TerritoryRecord);
      const metrics = computeTerritoryMetrics(
        territoryRows,
        rfxSnap.docs.map((d) => d.data() as Record<string, unknown>),
        profileSnap.docs.map((d) => d.data() as Record<string, unknown>),
        responseSnap.docs.map((d) => d.data() as Record<string, unknown>)
      );

      setTerritories(territoryRows);
      setMetricsByFips(metrics);
    } catch (err) {
      console.error("Failed to load territory manager data", err);
      setError("Failed to load territories. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const states = useMemo(
    () => Array.from(new Set(territories.map((t) => t.state).filter(Boolean))).sort(),
    [territories]
  );
  const regions = useMemo(
    () => Array.from(new Set(territories.map((t) => (t.regionTag || "").trim()).filter(Boolean))).sort(),
    [territories]
  );

  const filteredTerritories = useMemo(() => {
    const now = Date.now();
    const releaseLastThreshold = now - 14 * 24 * 60 * 60 * 1000;
    const scheduledNextThreshold = now + 14 * 24 * 60 * 60 * 1000;

    const q = searchTerm.trim().toLowerCase();

    const filtered = territories.filter((t) => {
      const metrics = metricsByFips[t.fips] ?? emptyMetrics();
      const type = t.type ?? "county";
      const hasReleaseDate = typeof t.releaseDate === "number";
      const notes = t.notes?.trim() || "";
      const hasGeometry = Boolean(t.boundaryGeoJSON);

      if (q) {
        const matchesSearch =
          t.name.toLowerCase().includes(q) ||
          t.fips.toLowerCase().includes(q) ||
          t.state.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      if (statusFilter.length > 0 && !statusFilter.includes(t.status as AdminTerritoryStatus)) return false;
      if (stateFilter.length > 0 && !stateFilter.includes(t.state)) return false;
      if (regionFilter.length > 0 && !regionFilter.includes((t.regionTag || "").trim())) return false;
      if (typeFilter.length > 0 && !typeFilter.includes(type)) return false;

      if (releaseDateFilter === "yes" && !hasReleaseDate) return false;
      if (releaseDateFilter === "no" && hasReleaseDate) return false;

      if (autoReleaseFilter === "yes" && !t.autoReleaseEnabled) return false;
      if (autoReleaseFilter === "no" && t.autoReleaseEnabled) return false;

      if (openRfxOnly && metrics.openRfx <= 0) return false;
      if (activity7dOnly && metrics.activity7d <= 0) return false;
      if (overdueScheduledOnly && !(t.status === "scheduled" && hasReleaseDate && (t.releaseDate as number) < now)) return false;
      if (lowLiquidityOnly && !(metrics.openRfx < 3 && metrics.verifiedVendors < 10)) return false;
      if (notesPresentOnly && !notes) return false;
      if (needsReviewOnly && !t.needsReview) return false;
      if (missingGeometryOnly && hasGeometry) return false;

      // Saved-view style constraints baked in for visibility chips
      const recentlyReleased = t.status === "released" && hasReleaseDate && (t.releaseDate as number) >= releaseLastThreshold;
      const scheduledSoon = t.status === "scheduled" && hasReleaseDate && (t.releaseDate as number) <= scheduledNextThreshold;
      void recentlyReleased;
      void scheduledSoon;

      return true;
    });

    return filtered.sort((a, b) => sortTerritories(a, b, sortBy, metricsByFips));
  }, [
    searchTerm,
    territories,
    metricsByFips,
    statusFilter,
    stateFilter,
    regionFilter,
    typeFilter,
    releaseDateFilter,
    autoReleaseFilter,
    openRfxOnly,
    activity7dOnly,
    overdueScheduledOnly,
    lowLiquidityOnly,
    notesPresentOnly,
    needsReviewOnly,
    missingGeometryOnly,
    sortBy,
  ]);

  const openMetricsSummary = useMemo(() => {
    return filteredTerritories.reduce(
      (acc, t) => {
        const m = metricsByFips[t.fips] ?? emptyMetrics();
        acc.openRfx += m.openRfx;
        acc.verifiedVendors += m.verifiedVendors;
        acc.activity7d += m.activity7d;
        return acc;
      },
      { openRfx: 0, verifiedVendors: 0, activity7d: 0 }
    );
  }, [filteredTerritories, metricsByFips]);

  const handleToggleFilter = <T extends string>(
    current: T[],
    setCurrent: (next: T[]) => void,
    value: T
  ) => {
    if (current.includes(value)) {
      setCurrent(current.filter((v) => v !== value));
      return;
    }
    setCurrent([...current, value]);
  };

  const openEditModal = (t: TerritoryRecord) => {
    setEditing({
      fips: t.fips,
      name: t.name,
      state: t.state,
      status: t.status as AdminTerritoryStatus,
      releaseDate: toDateTimeLocal(t.releaseDate),
      timezone: t.timezone || "America/New_York",
      type: t.type || "county",
      notes: t.notes || "",
      regionTag: t.regionTag || "",
      fipsStateCode: t.fipsStateCode || t.fips.slice(0, 2),
      autoReleaseEnabled: t.autoReleaseEnabled ?? true,
      autoPauseEnabled: t.autoPauseEnabled ?? false,
      needsReview: Boolean(t.needsReview),
    });
  };

  const submitEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await updateTerritoryFn({
        fips: editing.fips,
        name: editing.name,
        state: editing.state,
        status: editing.status,
        releaseDate: editing.releaseDate ? new Date(editing.releaseDate).getTime() : null,
        timezone: editing.timezone,
        type: editing.type,
        notes: editing.notes,
        regionTag: editing.regionTag,
        fipsStateCode: editing.fipsStateCode,
        autoReleaseEnabled: editing.autoReleaseEnabled,
        autoPauseEnabled: editing.autoPauseEnabled,
        needsReview: editing.needsReview,
      });
      setEditing(null);
      await fetchData();
    } catch (err) {
      console.error("Failed to update territory", err);
      setError("Failed to update territory. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const submitCreate = async (form: EditForm) => {
    setSaving(true);
    setError(null);
    try {
      await createTerritoryFn({
        fips: form.fips.trim(),
        name: form.name.trim(),
        state: form.state.trim(),
        status: form.status,
        releaseDate: form.releaseDate ? new Date(form.releaseDate).getTime() : undefined,
        timezone: form.timezone,
        type: form.type,
        notes: form.notes,
        regionTag: form.regionTag,
        fipsStateCode: form.fipsStateCode || form.fips.slice(0, 2),
        autoReleaseEnabled: form.autoReleaseEnabled,
        autoPauseEnabled: form.autoPauseEnabled,
        needsReview: form.needsReview,
      });
      setCreating(false);
      await fetchData();
    } catch (err) {
      console.error("Failed to create territory", err);
      setError("Failed to create territory. Verify FIPS and try again.");
    } finally {
      setSaving(false);
    }
  };

  const quickStatusUpdate = async (fips: string, status: AdminTerritoryStatus) => {
    setSaving(true);
    setError(null);
    try {
      await updateTerritoryFn({ fips, status });
      await fetchData();
    } catch (err) {
      console.error("Failed quick status update", err);
      setError("Failed to update status.");
    } finally {
      setSaving(false);
    }
  };

  const runAutoRelease = async () => {
    setSaving(true);
    setError(null);
    try {
      await releaseScheduledTerritoriesFn({});
      await fetchData();
    } catch (err) {
      console.error("Failed to release scheduled territories", err);
      setError("Failed to run scheduled release.");
    } finally {
      setSaving(false);
    }
  };

  const applySavedView = (view: "scheduled" | "recent" | "paused" | "overdue" | "lowLiquidity" | "highActivity") => {
    setStatusFilter([]);
    setOpenRfxOnly(false);
    setActivity7dOnly(false);
    setOverdueScheduledOnly(false);
    setLowLiquidityOnly(false);

    if (view === "scheduled") {
      setStatusFilter(["scheduled"]);
      return;
    }
    if (view === "recent") {
      setStatusFilter(["released"]);
      return;
    }
    if (view === "paused") {
      setStatusFilter(["paused"]);
      return;
    }
    if (view === "overdue") {
      setStatusFilter(["scheduled"]);
      setOverdueScheduledOnly(true);
      return;
    }
    if (view === "lowLiquidity") {
      setLowLiquidityOnly(true);
      return;
    }
    if (view === "highActivity") {
      setActivity7dOnly(true);
    }
  };

  const previewResult = useMemo(() => {
    if (!previewingFips) return null;
    const territory = territories.find((t) => t.fips === previewingFips);
    if (!territory) return null;
    const territoryStatus = previewMode.platformMode === "read_only" ? "scheduled" : territory.status;
    const role = previewMode.role === "issuer" ? "member" : previewMode.role === "vendor" ? "externalVendor" : "member";
    return canTransact({
      userRole: role,
      verificationStatus: previewMode.verificationStatus,
      territoryStatus: territoryStatus as AdminTerritoryStatus,
    });
  }, [previewMode, previewingFips, territories]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1450px] space-y-6 px-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Admin Territory Manager</h1>
              <p className="mt-1 text-sm text-slate-500">
                Operational control for release scheduling, liquidity monitoring, and governance.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={runAutoRelease}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Run Auto-Release
              </button>
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                New Territory
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Territories" value={String(filteredTerritories.length)} />
            <StatCard label="Open RFx" value={String(openMetricsSummary.openRfx)} />
            <StatCard label="Verified Vendors" value={String(openMetricsSummary.verifiedVendors)} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            {[
              ["Scheduled Releases", "scheduled"],
              ["Recently Released", "recent"],
              ["Paused Territories", "paused"],
              ["Overdue Schedules", "overdue"],
              ["Low Liquidity", "lowLiquidity"],
              ["High Activity", "highActivity"],
            ].map(([label, key]) => (
              <button
                key={String(key)}
                onClick={() => applySavedView(key as "scheduled" | "recent" | "paused" | "overdue" | "lowLiquidity" | "highActivity")}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, FIPS, state. Paste FIPS to quick-jump."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <label className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
              Sort
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white p-1.5 text-xs"
              >
                <option value="status">Status (ops order)</option>
                <option value="releaseDateAsc">Release Date (asc)</option>
                <option value="releaseDateDesc">Release Date (desc)</option>
                <option value="lastUpdated">Last Updated</option>
                <option value="name">Name</option>
                <option value="openRfx">Open RFx</option>
                <option value="verifiedVendors">Verified vendors</option>
              </select>
            </label>
            <label className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
              Has release date
              <select
                value={releaseDateFilter}
                onChange={(e) => setReleaseDateFilter(e.target.value as TriState)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white p-1.5 text-xs"
              >
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
              Auto-release
              <select
                value={autoReleaseFilter}
                onChange={(e) => setAutoReleaseFilter(e.target.value as TriState)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white p-1.5 text-xs"
              >
                <option value="all">All</option>
                <option value="yes">Enabled</option>
                <option value="no">Disabled</option>
              </select>
            </label>
          </div>

          <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Filter className="h-3.5 w-3.5" /> Quick Filters
            </div>
            <ChipRow
              label="Status"
              values={["scheduled", "released", "paused", "archived"]}
              activeValues={statusFilter}
              onToggle={(value) => handleToggleFilter(statusFilter, setStatusFilter, value as AdminTerritoryStatus)}
            />
            <ChipRow
              label="State"
              values={states}
              activeValues={stateFilter}
              onToggle={(value) => handleToggleFilter(stateFilter, setStateFilter, value)}
            />
            <ChipRow
              label="Region"
              values={regions}
              activeValues={regionFilter}
              onToggle={(value) => handleToggleFilter(regionFilter, setRegionFilter, value)}
            />
            <ChipRow
              label="Type"
              values={["county", "city", "custom_polygon"]}
              activeValues={typeFilter}
              onToggle={(value) => handleToggleFilter(typeFilter, setTypeFilter, value as AdminTerritoryType)}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Toggle label="Open RFx > 0" checked={openRfxOnly} onChange={setOpenRfxOnly} />
              <Toggle label="Activity (7d)" checked={activity7dOnly} onChange={setActivity7dOnly} />
              <Toggle label="Overdue schedule" checked={overdueScheduledOnly} onChange={setOverdueScheduledOnly} />
              <Toggle label="Low liquidity" checked={lowLiquidityOnly} onChange={setLowLiquidityOnly} />
              <Toggle label="Notes present" checked={notesPresentOnly} onChange={setNotesPresentOnly} />
              <Toggle label="Needs review" checked={needsReviewOnly} onChange={setNeedsReviewOnly} />
              <Toggle label="Missing geometry" checked={missingGeometryOnly} onChange={setMissingGeometryOnly} />
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : filteredTerritories.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-slate-500">No territories match your current filters.</div>
          ) : (
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Territory</th>
                  <th className="px-3 py-3">Type / Region</th>
                  <th className="px-3 py-3">State / FIPS</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Release</th>
                  <th className="px-3 py-3">Market Readiness</th>
                  <th className="px-3 py-3">Governance</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTerritories.map((territory) => {
                  const metrics = metricsByFips[territory.fips] ?? emptyMetrics();
                  const expanded = expandedFips === territory.fips;
                  return (
                    <FragmentRow key={territory.fips}>
                      <tr className="border-b border-slate-100 align-top hover:bg-slate-50/70">
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-900">{territory.name}</div>
                          <div className="text-[11px] text-slate-500">{territory.state}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="capitalize text-slate-700">{territory.type || "county"}</div>
                          <div className="text-[11px] text-slate-500">{territory.regionTag || "—"}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-mono text-slate-700">{territory.fips}</div>
                          <div className="text-[11px] text-slate-500">State code {territory.fipsStateCode || territory.fips.slice(0, 2)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={territory.status as AdminTerritoryStatus} />
                          <div className="mt-1 text-[11px] text-slate-500">TZ: {territory.timezone || "America/New_York"}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div>{territory.releaseDate ? formatDate(territory.releaseDate) : "No date"}</div>
                          <div className="mt-1 flex gap-1">
                            <SmallFlag label={territory.autoReleaseEnabled ? "Auto-release" : "Manual"} good={Boolean(territory.autoReleaseEnabled)} />
                            <SmallFlag label={territory.autoPauseEnabled ? "Auto-pause" : "No auto-pause"} good={Boolean(territory.autoPauseEnabled)} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div>Open RFx: {metrics.openRfx}</div>
                          <div>Total RFx: {metrics.totalRfx}</div>
                          <div>Verified vendors: {metrics.verifiedVendors}</div>
                          <div>Users total: {metrics.totalUsers}</div>
                          <div>Activity (7d): {metrics.activity7d}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div className="max-w-[220px] truncate text-[11px]">{territory.notes || "—"}</div>
                          <div className="text-[11px] text-slate-500">Updated: {territory.updatedAt ? formatDate(territory.updatedAt) : "—"}</div>
                          <div className="text-[11px] text-slate-500">By: {territory.updatedBy || "—"}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => setPreviewingFips(territory.fips)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Preview as user
                            </button>
                            <button
                              onClick={() => openEditModal(territory)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <a
                              href={`/rfx?territoryFips=${territory.fips}`}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              View on map
                            </a>
                            <button
                              onClick={() => quickStatusUpdate(territory.fips, "paused")}
                              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700"
                            >
                              Pause
                            </button>
                            <button
                              onClick={() => quickStatusUpdate(territory.fips, "archived")}
                              className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700"
                            >
                              Archive
                            </button>
                            <button
                              onClick={() => setExpandedFips(expanded ? null : territory.fips)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              {expanded ? (
                                <span className="inline-flex items-center gap-1"><ChevronUp className="h-3 w-3" /> Hide details</span>
                              ) : (
                                <span className="inline-flex items-center gap-1"><ChevronDown className="h-3 w-3" /> Release history</span>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="mb-2 text-xs font-bold text-slate-700">Detail Drawer</div>
                                <div className="space-y-1 text-xs text-slate-600">
                                  <div>
                                    <span className="font-semibold text-slate-800">Full notes:</span> {territory.notes || "—"}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-800">Centroid:</span>{" "}
                                    {territory.centroid ? `${territory.centroid.lat.toFixed(4)}, ${territory.centroid.lng.toFixed(4)}` : "—"}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-800">Bounds/geometry:</span>{" "}
                                    {territory.boundaryGeoJSON ? "Present" : "Missing geometry"}
                                  </div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                  <button
                                    onClick={() => setPreviewingFips(territory.fips)}
                                    className="rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                                  >
                                    Preview as user
                                  </button>
                                  <a
                                    href={`/rfx?territoryFips=${territory.fips}`}
                                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
                                  >
                                    View on map
                                  </a>
                                  <button
                                    onClick={() => openEditModal(territory)}
                                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
                                  >
                                    Edit schedule
                                  </button>
                                </div>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="mb-2 text-xs font-bold text-slate-700">Release History</div>
                                {(territory.statusHistory || []).length === 0 ? (
                                  <div className="text-xs text-slate-500">No history found yet.</div>
                                ) : (
                                  <div className="max-h-40 space-y-1 overflow-auto text-xs text-slate-600">
                                    {[...(territory.statusHistory || [])]
                                      .sort((a, b) => b.at - a.at)
                                      .map((entry, idx) => (
                                        <div key={`${entry.status}-${entry.at}-${idx}`} className="rounded border border-slate-200 p-2">
                                          <div className="font-semibold text-slate-800">
                                            {entry.status.toUpperCase()} · {formatDate(entry.at)}
                                          </div>
                                          <div>by {entry.by}</div>
                                          {entry.note ? <div className="text-slate-500">{entry.note}</div> : null}
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {editing ? (
          <EditTerritoryModal
            title={`Edit ${editing.name}`}
            form={editing}
            setForm={setEditing}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSubmit={submitEdit}
          />
        ) : null}

        {creating ? (
          <CreateTerritoryModal
            saving={saving}
            onCancel={() => setCreating(false)}
            onSubmit={submitCreate}
          />
        ) : null}

        {previewingFips ? (
          <PreviewModal
            previewingFips={previewingFips}
            mode={previewMode}
            setMode={setPreviewMode}
            result={previewResult}
            onClose={() => setPreviewingFips(null)}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function computeTerritoryMetrics(
  territories: TerritoryRecord[],
  rfxDocs: Record<string, unknown>[],
  profileDocs: Record<string, unknown>[],
  responseDocs: Record<string, unknown>[]
): Record<string, TerritoryMetrics> {
  const metrics: Record<string, TerritoryMetrics> = {};
  territories.forEach((t) => {
    metrics[t.fips] = emptyMetrics();
  });

  const rfxToTerritory: Record<string, string> = {};
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const rfx of rfxDocs) {
    const territoryFips = typeof rfx.territoryFips === "string" ? rfx.territoryFips : undefined;
    const rfxId = typeof rfx.id === "string" ? rfx.id : undefined;
    if (!territoryFips || !metrics[territoryFips]) continue;
    metrics[territoryFips].totalRfx += 1;
    if (rfx.status === "open") metrics[territoryFips].openRfx += 1;
    if (typeof rfx.createdAt === "number" && rfx.createdAt >= sevenDaysAgo) {
      metrics[territoryFips].activity7d += 1;
    }
    if (rfxId) rfxToTerritory[rfxId] = territoryFips;
  }

  for (const profile of profileDocs) {
    const territoryFips =
      typeof profile.territoryFips === "string"
        ? profile.territoryFips
        : typeof profile.homeTerritoryFips === "string"
        ? profile.homeTerritoryFips
        : undefined;
    if (!territoryFips || !metrics[territoryFips]) continue;
    metrics[territoryFips].totalUsers += 1;
    if (profile.verificationStatus === "verified") {
      metrics[territoryFips].verifiedVendors += 1;
    }
  }

  for (const response of responseDocs) {
    const rfxId = typeof response.rfxId === "string" ? response.rfxId : undefined;
    const submittedAt =
      typeof response.submittedAt === "number"
        ? response.submittedAt
        : typeof response.createdAt === "number"
        ? response.createdAt
        : undefined;
    if (!rfxId || !submittedAt || submittedAt < sevenDaysAgo) continue;
    const territoryFips = rfxToTerritory[rfxId];
    if (!territoryFips || !metrics[territoryFips]) continue;
    metrics[territoryFips].activity7d += 1;
  }

  return metrics;
}

function sortTerritories(
  a: TerritoryRecord,
  b: TerritoryRecord,
  sortBy: SortKey,
  metricsByFips: Record<string, TerritoryMetrics>
): number {
  const metricA = metricsByFips[a.fips] ?? emptyMetrics();
  const metricB = metricsByFips[b.fips] ?? emptyMetrics();

  if (sortBy === "releaseDateAsc") {
    return (a.releaseDate || Number.MAX_SAFE_INTEGER) - (b.releaseDate || Number.MAX_SAFE_INTEGER);
  }
  if (sortBy === "releaseDateDesc") {
    return (b.releaseDate || 0) - (a.releaseDate || 0);
  }
  if (sortBy === "lastUpdated") {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  }
  if (sortBy === "name") {
    return a.name.localeCompare(b.name);
  }
  if (sortBy === "openRfx") {
    return metricB.openRfx - metricA.openRfx;
  }
  if (sortBy === "verifiedVendors") {
    return metricB.verifiedVendors - metricA.verifiedVendors;
  }

  const statusDiff = STATUS_ORDER[a.status as AdminTerritoryStatus] - STATUS_ORDER[b.status as AdminTerritoryStatus];
  if (statusDiff !== 0) return statusDiff;
  return a.name.localeCompare(b.name);
}

function StatusBadge({ status }: { status: AdminTerritoryStatus }) {
  const style =
    status === "released"
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : status === "scheduled"
      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
      : status === "paused"
      ? "bg-amber-50 border-amber-200 text-amber-700"
      : "bg-slate-100 border-slate-200 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${style}`}>
      {status}
    </span>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
        checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {label}
    </button>
  );
}

function ChipRow({
  label,
  values,
  activeValues,
  onToggle,
}: {
  label: string;
  values: string[];
  activeValues: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {values.length === 0 ? (
        <span className="text-[11px] text-slate-400">None</span>
      ) : (
        values.map((value) => {
          const active = activeValues.includes(value);
          return (
            <button
              key={value}
              onClick={() => onToggle(value)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              {value}
            </button>
          );
        })
      )}
    </div>
  );
}

function SmallFlag({ label, good }: { label: string; good: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        good ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"
      }`}
    >
      {label}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

function EditTerritoryModal({
  title,
  form,
  setForm,
  saving,
  onCancel,
  onSubmit,
}: {
  title: string;
  form: EditForm;
  setForm: (next: EditForm) => void;
  saving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <TextInput label="FIPS" value={form.fips} onChange={(value) => setForm({ ...form, fips: value })} disabled />
          <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <TextInput label="State" value={form.state} onChange={(value) => setForm({ ...form, state: value })} />
          <TextInput label="State Code" value={form.fipsStateCode} onChange={(value) => setForm({ ...form, fipsStateCode: value })} />
          <SelectInput
            label="Status"
            value={form.status}
            options={["scheduled", "released", "paused", "archived"]}
            onChange={(value) => setForm({ ...form, status: value as AdminTerritoryStatus })}
          />
          <SelectInput
            label="Type"
            value={form.type}
            options={["county", "city", "custom_polygon"]}
            onChange={(value) => setForm({ ...form, type: value as AdminTerritoryType })}
          />
          <TextInput label="Timezone" value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} />
          <TextInput label="Region Tag" value={form.regionTag} onChange={(value) => setForm({ ...form, regionTag: value })} />
          <TextInput
            label="Release Date"
            value={form.releaseDate}
            onChange={(value) => setForm({ ...form, releaseDate: value })}
            type="datetime-local"
          />
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 p-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle label="Auto-release" checked={form.autoReleaseEnabled} onChange={(next) => setForm({ ...form, autoReleaseEnabled: next })} />
          <Toggle label="Auto-pause" checked={form.autoPauseEnabled} onChange={(next) => setForm({ ...form, autoPauseEnabled: next })} />
          <Toggle label="Needs review" checked={form.needsReview} onChange={(next) => setForm({ ...form, needsReview: next })} />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateTerritoryModal({
  saving,
  onCancel,
  onSubmit,
}: {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (form: EditForm) => void;
}) {
  const [form, setForm] = useState<EditForm>(DEFAULT_NEW_TERRITORY);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">Create Territory</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <TextInput label="FIPS" value={form.fips} onChange={(value) => setForm({ ...form, fips: value })} />
          <TextInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <TextInput label="State" value={form.state} onChange={(value) => setForm({ ...form, state: value })} />
          <TextInput label="State Code" value={form.fipsStateCode} onChange={(value) => setForm({ ...form, fipsStateCode: value })} />
          <SelectInput
            label="Status"
            value={form.status}
            options={["scheduled", "released", "paused", "archived"]}
            onChange={(value) => setForm({ ...form, status: value as AdminTerritoryStatus })}
          />
          <SelectInput
            label="Type"
            value={form.type}
            options={["county", "city", "custom_polygon"]}
            onChange={(value) => setForm({ ...form, type: value as AdminTerritoryType })}
          />
          <TextInput label="Timezone" value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} />
          <TextInput label="Region Tag" value={form.regionTag} onChange={(value) => setForm({ ...form, regionTag: value })} />
          <TextInput
            label="Release Date"
            value={form.releaseDate}
            onChange={(value) => setForm({ ...form, releaseDate: value })}
            type="datetime-local"
          />
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 p-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle label="Auto-release" checked={form.autoReleaseEnabled} onChange={(next) => setForm({ ...form, autoReleaseEnabled: next })} />
          <Toggle label="Auto-pause" checked={form.autoPauseEnabled} onChange={(next) => setForm({ ...form, autoPauseEnabled: next })} />
          <Toggle label="Needs review" checked={form.needsReview} onChange={(next) => setForm({ ...form, needsReview: next })} />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={saving || !/^\d{5}$/.test(form.fips.trim()) || !form.name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Create territory
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({
  previewingFips,
  mode,
  setMode,
  result,
  onClose,
}: {
  previewingFips: string;
  mode: PreviewMode;
  setMode: (next: PreviewMode) => void;
  result: { allowed: boolean; reasons: string[] } | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">Preview as user · Territory {previewingFips}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <SelectInput
            label="Verification"
            value={mode.verificationStatus}
            options={["pending", "verified"]}
            onChange={(value) => setMode({ ...mode, verificationStatus: value as "pending" | "verified" })}
          />
          <SelectInput
            label="Membership tier"
            value={mode.membershipTier}
            options={["virtual", "coworking", "plus"]}
            onChange={(value) => setMode({ ...mode, membershipTier: value as "virtual" | "coworking" | "plus" })}
          />
          <SelectInput
            label="Role"
            value={mode.role}
            options={["issuer", "vendor", "both"]}
            onChange={(value) => setMode({ ...mode, role: value as "issuer" | "vendor" | "both" })}
          />
          <SelectInput
            label="Home territory"
            value={mode.homeTerritory}
            options={["this", "other"]}
            onChange={(value) => setMode({ ...mode, homeTerritory: value as "this" | "other" })}
          />
          <SelectInput
            label="Platform mode"
            value={mode.platformMode}
            options={["released", "read_only"]}
            onChange={(value) => setMode({ ...mode, platformMode: value as "released" | "read_only" })}
          />
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Result</div>
          {result ? (
            <div className="mt-2 text-sm">
              {result.allowed ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Allowed to transact
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
                  <XCircle className="h-4 w-4" /> Read-only / blocked
                </div>
              )}
              {!result.allowed ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">Select preview options.</div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="rounded-lg border border-slate-200 p-2 text-xs font-semibold text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 p-1.5 text-sm text-slate-800 disabled:bg-slate-100"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-lg border border-slate-200 p-2 text-xs font-semibold text-slate-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 p-1.5 text-sm text-slate-800"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function toDateTimeLocal(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function emptyMetrics(): TerritoryMetrics {
  return {
    openRfx: 0,
    totalRfx: 0,
    verifiedVendors: 0,
    totalUsers: 0,
    activity7d: 0,
  };
}
