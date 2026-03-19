"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getDoors,
  getActiveAccessGrants,
  getAccessCodesForGrant,
  getAccessEvents,
  subscribeToAccessGrants,
} from "@/lib/firestore";
import {
  accessAdminRevokeFn,
  accessAdminUnlockFn,
  accessAdminResendPinFn,
  accessAdminGetDoorStatusFn,
} from "@/lib/functions";
import type { DoorDoc, AccessGrantDoc, AccessCodeDoc, AccessEventDoc } from "@hi/shared";
import {
  DoorOpen,
  KeyRound,
  ShieldAlert,
  RefreshCw,
  Loader2,
  Unlock,
  Ban,
  Send,
  Activity,
  Wifi,
  WifiOff,
  BatteryLow,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";

// ---------- Types ----------

interface GrantWithCode extends AccessGrantDoc {
  code?: AccessCodeDoc;
}

type DoorStatusLive = {
  online: boolean;
  batteryLevel?: number;
  locked?: boolean;
  refreshedAt?: number;
};

// ---------- Status helpers ----------

function codeStatusBadge(status: string | undefined) {
  if (!status) return null;
  const map: Record<string, string> = {
    programming: "bg-amber-100 text-amber-800",
    active: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-800",
    expired: "bg-slate-100 text-slate-500",
    revoked: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function grantStatusBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    active: "bg-emerald-100 text-emerald-800",
    expired: "bg-slate-100 text-slate-500",
    revoked: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtShort(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ---------- Main page ----------

export default function AdminAccessPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminAccessContent />
    </RequireAuth>
  );
}

function AdminAccessContent() {
  const [doors, setDoors] = useState<DoorDoc[]>([]);
  const [doorStatuses, setDoorStatuses] = useState<Record<string, DoorStatusLive>>({});
  const [grants, setGrants] = useState<GrantWithCode[]>([]);
  const [events, setEvents] = useState<AccessEventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEventLog, setShowEventLog] = useState(false);
  const [expandedGrant, setExpandedGrant] = useState<string | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [doorsData, activeGrants, recentEvents] = await Promise.all([
        getDoors(),
        getActiveAccessGrants(100),
        getAccessEvents({ limitCount: 50 }),
      ]);

      setDoors(doorsData);
      setEvents(recentEvents);

      // Load codes for each grant
      const grantsWithCodes: GrantWithCode[] = await Promise.all(
        activeGrants.map(async (grant) => {
          const codes = await getAccessCodesForGrant(grant.id);
          const activeCode = codes.find((c) => c.status === "active" || c.status === "programming");
          return { ...grant, code: activeCode };
        })
      );
      setGrants(grantsWithCodes);
    } catch (err) {
      console.error("Access dashboard load error:", err);
      setError("Failed to load access data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();

    // Live updates for grants
    unsubRef.current = subscribeToAccessGrants(async (liveGrants) => {
      const grantsWithCodes: GrantWithCode[] = await Promise.all(
        liveGrants.map(async (grant) => {
          const codes = await getAccessCodesForGrant(grant.id);
          const activeCode = codes.find((c) => c.status === "active" || c.status === "programming");
          return { ...grant, code: activeCode };
        })
      );
      setGrants(grantsWithCodes);
    });

    return () => {
      unsubRef.current?.();
    };
  }, [loadInitialData]);

  const refreshDoorStatus = useCallback(async (doorId: string) => {
    setActionLoading(`status-${doorId}`);
    try {
      const result = await accessAdminGetDoorStatusFn({ doorId });
      setDoorStatuses((prev) => ({
        ...prev,
        [doorId]: {
          online: result.data.online,
          batteryLevel: result.data.batteryLevel,
          locked: result.data.locked,
          refreshedAt: Date.now(),
        },
      }));
    } catch (err) {
      console.error("Failed to refresh door status:", err);
      setError("Failed to refresh door status");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleRemoteUnlock = useCallback(async (doorId: string, doorName: string) => {
    if (!confirm(`Remote unlock "${doorName}"? This will physically unlock the door.`)) return;
    setActionLoading(`unlock-${doorId}`);
    setError(null);
    try {
      await accessAdminUnlockFn({ doorId });
      // Refresh event log
      const recentEvents = await getAccessEvents({ doorId, limitCount: 50 });
      setEvents(recentEvents);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unlock failed";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleRevoke = useCallback(async (grantId: string) => {
    if (!confirm(`Revoke access for this grant? The PIN will be deleted immediately.`)) return;
    setActionLoading(`revoke-${grantId}`);
    setError(null);
    try {
      await accessAdminRevokeFn({ grantId, reason: "admin" });
      setGrants((prev) => prev.filter((g) => g.id !== grantId));
      const recentEvents = await getAccessEvents({ grantId, limitCount: 50 });
      setEvents((prev) => [...recentEvents, ...prev].slice(0, 100));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Revoke failed";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleResendPin = useCallback(async (grantId: string) => {
    setActionLoading(`resend-${grantId}`);
    setError(null);
    try {
      await accessAdminResendPinFn({ grantId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Resend failed";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  const failedCodes = grants.filter((g) => g.code?.status === "failed");
  const programmingCodes = grants.filter((g) => g.code?.status === "programming");

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <KeyRound className="h-8 w-8 text-slate-400" />
              Access Control
            </h1>
            <p className="text-slate-500 mt-1">Live door status, active codes, and access events.</p>
          </div>
          <button
            onClick={loadInitialData}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Alerts */}
        {(failedCodes.length > 0 || programmingCodes.length > 0) && (
          <div className="space-y-2">
            {failedCodes.map((g) => (
              <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
                <span>
                  <strong>Code programming failed</strong> — Grant <code className="text-xs bg-red-100 px-1 rounded">{g.id.slice(-6)}</code> for booking <code className="text-xs bg-red-100 px-1 rounded">{g.bookingId.slice(-6)}</code>.
                  {g.code?.failureReason && <span className="ml-1 text-red-600">({g.code.failureReason})</span>}
                </span>
                <button
                  onClick={() => handleResendPin(g.id)}
                  disabled={actionLoading === `resend-${g.id}`}
                  className="ml-auto shrink-0 px-3 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-800 text-xs font-medium disabled:opacity-50"
                >
                  {actionLoading === `resend-${g.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : "Retry"}
                </button>
              </div>
            ))}
            {programmingCodes.length > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                <span><strong>{programmingCodes.length} code(s)</strong> still programming — waiting for Seam confirmation.</span>
              </div>
            )}
          </div>
        )}

        {/* Door Status Panel */}
        <section>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Door Status</h2>
          {doors.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-slate-500 text-sm">
              No doors configured yet.{" "}
              <a href="https://console.firebase.google.com" className="underline" target="_blank" rel="noopener noreferrer">
                Seed a door doc in Firestore
              </a>{" "}
              to get started.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {doors.map((door) => {
                const live = doorStatuses[door.id];
                const effectiveStatus = live ? (live.online ? "online" : "offline") : door.status;
                const batteryPct = live?.batteryLevel !== undefined
                  ? Math.round(live.batteryLevel * 100)
                  : door.batteryLevel !== undefined
                    ? Math.round(door.batteryLevel * 100)
                    : null;

                return (
                  <div key={door.id} className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <DoorOpen className="h-5 w-5 text-slate-400" />
                        <span className="font-semibold text-slate-900">{door.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {effectiveStatus === "online" ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <Wifi className="h-3 w-3" /> Online
                          </span>
                        ) : effectiveStatus === "offline" ? (
                          <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                            <WifiOff className="h-3 w-3" /> Offline
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Unknown</span>
                        )}
                        {batteryPct !== null && batteryPct < 20 && (
                          <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                            <BatteryLow className="h-3 w-3" /> {batteryPct}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mb-4 space-y-0.5">
                      <div>Seam Device: <code className="font-mono">{door.seamDeviceId || "—"}</code></div>
                      {batteryPct !== null && <div>Battery: {batteryPct}%</div>}
                      {(live?.refreshedAt ?? door.lastSeenAt) && (
                        <div>Last seen: {fmt(live?.refreshedAt ?? door.lastSeenAt!)}</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRemoteUnlock(door.id, door.name)}
                        disabled={!!actionLoading}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                      >
                        {actionLoading === `unlock-${door.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                        Remote Unlock
                      </button>
                      <button
                        onClick={() => refreshDoorStatus(door.id)}
                        disabled={!!actionLoading}
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-sm disabled:opacity-50 transition-colors"
                        title="Refresh status from Seam"
                      >
                        {actionLoading === `status-${door.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Active Codes Panel */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Active Access Codes
              {grants.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">({grants.length})</span>
              )}
            </h2>
          </div>

          {grants.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-50 border border-slate-200 text-center text-slate-500 text-sm">
              No active access grants right now.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Booking / Grant</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Window</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Code</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {grants.map((grant) => {
                    const isExpanded = expandedGrant === grant.id;
                    const isRevokePending = actionLoading === `revoke-${grant.id}`;
                    const isResendPending = actionLoading === `resend-${grant.id}`;

                    return (
                      <React.Fragment key={grant.id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs text-slate-500">#{grant.bookingId.slice(-6)}</div>
                            <div className="font-mono text-xs text-slate-400">grant: {grant.id.slice(-6)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-800">{fmt(grant.startsAt)}</div>
                            <div className="text-slate-500 text-xs">→ {fmtShort(grant.endsAt)}</div>
                          </td>
                          <td className="px-4 py-3">
                            {grant.code ? (
                              <div className="font-mono text-slate-700">
                                ••••{grant.code.codeLast2 ?? "??"}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 space-y-1">
                            {grantStatusBadge(grant.status)}
                            {codeStatusBadge(grant.code?.status)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => handleResendPin(grant.id)}
                                disabled={!!actionLoading || grant.status === "revoked"}
                                title="Resend PIN notification"
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
                              >
                                {isResendPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              </button>
                              <button
                                onClick={() => handleRevoke(grant.id)}
                                disabled={!!actionLoading || grant.status === "revoked"}
                                title="Revoke access"
                                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                              >
                                {isRevokePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                              </button>
                              <button
                                onClick={() => setExpandedGrant(isExpanded ? null : grant.id)}
                                title="View details"
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                              >
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={5} className="px-4 py-3">
                              <div className="text-xs text-slate-600 space-y-1">
                                <div><span className="font-semibold">User ID:</span> {grant.userId}</div>
                                <div><span className="font-semibold">Door ID:</span> {grant.doorId}</div>
                                {grant.code?.seamCodeId && (
                                  <div><span className="font-semibold">Seam Code ID:</span> <code className="font-mono">{grant.code.seamCodeId}</code></div>
                                )}
                                {grant.code?.deliveredAt && (
                                  <div><span className="font-semibold">PIN delivered:</span> {fmt(grant.code.deliveredAt)}</div>
                                )}
                                {grant.code?.failureReason && (
                                  <div className="text-red-600"><span className="font-semibold">Failure:</span> {grant.code.failureReason}</div>
                                )}
                                <div><span className="font-semibold">Created:</span> {fmt(grant.createdAt)}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Event Log */}
        <section>
          <button
            onClick={() => setShowEventLog((v) => !v)}
            className="flex items-center gap-2 text-sm font-bold text-slate-900 uppercase tracking-wide mb-3 hover:text-slate-600 transition-colors"
          >
            <Activity className="h-4 w-4 text-slate-400" />
            Access Event Log
            <span className="text-xs font-normal text-slate-400">({events.length})</span>
            {showEventLog ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showEventLog && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              {events.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">No events recorded yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {events.map((evt) => (
                    <div key={evt.id} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50">
                      <div className="mt-0.5">
                        <Activity className="h-4 w-4 text-slate-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-700 font-mono">{evt.eventType}</span>
                          {evt.bookingId && (
                            <span className="text-xs text-slate-400">booking #{evt.bookingId.slice(-6)}</span>
                          )}
                          {evt.grantId && (
                            <span className="text-xs text-slate-400">grant #{evt.grantId.slice(-6)}</span>
                          )}
                          {evt.performedBy && (
                            <span className="text-xs text-slate-400">by {evt.performedBy.slice(0, 8)}…</span>
                          )}
                        </div>
                        {evt.notes && (
                          <div className="text-xs text-slate-500 mt-0.5">{evt.notes}</div>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 whitespace-nowrap shrink-0">
                        {fmt(evt.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

      </div>
    </AppShell>
  );
}
