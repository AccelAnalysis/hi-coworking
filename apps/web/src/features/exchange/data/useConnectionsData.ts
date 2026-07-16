"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionQuery,
  ExchangeRun3Gateway,
  ReferralWorkspaceRecord,
  ReferralWorkspaceSnapshot,
} from "./exchangeRun3Gateway";

export function useConnectionsData(
  gateway: ExchangeRun3Gateway,
  query: ConnectionQuery,
  selectedReferralId: string | null,
) {
  const [snapshot, setSnapshot] = useState<ReferralWorkspaceSnapshot | null>(null);
  const [detail, setDetail] = useState<ReferralWorkspaceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++versionRef.current;
    setLoading(snapshot === null);
    setRefreshing(snapshot !== null);
    setError(null);
    try {
      const next = await gateway.listConnections(query);
      if (version !== versionRef.current) return;
      setSnapshot(next);
    } catch {
      if (version !== versionRef.current) return;
      setError("Business referrals could not be loaded. Check your access and try again.");
    } finally {
      if (version === versionRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [gateway, query, snapshot]);

  useEffect(() => {
    void refresh();
    return () => {
      versionRef.current += 1;
    };
    // Refresh on the normalized query identity, not on the current snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, query]);

  useEffect(() => {
    if (!selectedReferralId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    setDetailLoading(true);
    gateway.getReferralDetail(selectedReferralId)
      .then((record) => {
        if (active) setDetail(record);
      })
      .catch(() => {
        if (active) setError("The selected referral detail is unavailable.");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gateway, selectedReferralId]);

  const runMutation = useCallback(async (
    operation: () => Promise<ReferralWorkspaceRecord>,
  ) => {
    setMutating(true);
    setError(null);
    try {
      const record = await operation();
      setDetail(record);
      setSnapshot((current) => current
        ? {
            ...current,
            records: current.records.some((candidate) => candidate.id === record.id)
              ? current.records.map((candidate) => candidate.id === record.id ? record : candidate)
              : [record, ...current.records],
          }
        : current);
      return record;
    } catch (mutationError) {
      const message = mutationError instanceof Error
        ? mutationError.message
        : "The referral action could not be completed.";
      setError(message);
      throw mutationError;
    } finally {
      setMutating(false);
    }
  }, []);

  return {
    snapshot,
    detail,
    loading,
    refreshing,
    detailLoading,
    mutating,
    error,
    refresh,
    runMutation,
  };
}
