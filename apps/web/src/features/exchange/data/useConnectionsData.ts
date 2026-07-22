"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionQuery,
  ExchangeRun3Gateway,
  ReferralWorkspaceRecord,
  ReferralWorkspaceSnapshot,
} from "./exchangeRun3Gateway";

interface ScopedSnapshot {
  scopeKey: string;
  value: ReferralWorkspaceSnapshot;
}

interface ScopedDetail {
  requestKey: string;
  value: ReferralWorkspaceRecord;
}

interface ScopedActivity {
  key: string;
  loading: boolean;
  refreshing?: boolean;
  requestId?: number;
}

interface ScopedError {
  scopeKey: string;
  message: string | null;
}

function actorScopeKey(actorOrganizationId?: string): string {
  return actorOrganizationId ? `organization:${actorOrganizationId}` : "individual";
}

function detailRequestKey(scopeKey: string, referralId: string | null): string {
  return `${scopeKey}:referral:${referralId ?? "none"}`;
}

const ACTOR_CHANGED_ERROR = "Organization authority changed while the request was running. Review the referral in the newly selected context before retrying.";
const STALE_MUTATION_ERROR = "A newer referral action replaced this request. Reload the referral before retrying.";

export function useConnectionsData(
  gateway: ExchangeRun3Gateway,
  query: ConnectionQuery,
  selectedReferralId: string | null,
) {
  const currentScopeKey = actorScopeKey(query.actorOrganizationId);
  const currentDetailKey = detailRequestKey(currentScopeKey, selectedReferralId);
  const [snapshotState, setSnapshotState] = useState<ScopedSnapshot | null>(null);
  const [detailState, setDetailState] = useState<ScopedDetail | null>(null);
  const [listActivity, setListActivity] = useState<ScopedActivity | null>(null);
  const [detailActivity, setDetailActivity] = useState<ScopedActivity | null>(null);
  const [mutationActivity, setMutationActivity] = useState<ScopedActivity | null>(null);
  const [errorState, setErrorState] = useState<ScopedError | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const renderedScopeRef = useRef(currentScopeKey);
  const renderedActorRef = useRef(query.actorOrganizationId);
  const effectScopeRef = useRef(currentScopeKey);

  // These refs intentionally update during render so an actor switch invalidates
  // in-flight work before effects run or any prior-scope state can be returned.
  if (renderedScopeRef.current !== currentScopeKey) {
    listRequestRef.current += 1;
    detailRequestRef.current += 1;
    mutationRequestRef.current += 1;
  }
  renderedScopeRef.current = currentScopeKey;
  renderedActorRef.current = query.actorOrganizationId;

  const refresh = useCallback(async (clearExisting = false) => {
    const requestId = ++listRequestRef.current;
    const requestScopeKey = actorScopeKey(query.actorOrganizationId);
    const hasVisibleSnapshot = snapshotState?.scopeKey === requestScopeKey;
    setListActivity({
      key: requestScopeKey,
      loading: clearExisting || !hasVisibleSnapshot,
      refreshing: !clearExisting && hasVisibleSnapshot,
    });
    setErrorState({ scopeKey: requestScopeKey, message: null });
    try {
      const next = await gateway.listConnections(query);
      if (
        requestId !== listRequestRef.current
        || renderedScopeRef.current !== requestScopeKey
      ) return;
      setSnapshotState({ scopeKey: requestScopeKey, value: next });
    } catch {
      if (
        requestId !== listRequestRef.current
        || renderedScopeRef.current !== requestScopeKey
      ) return;
      setErrorState({
        scopeKey: requestScopeKey,
        message: "Business referrals could not be loaded. Check your access and try again.",
      });
    } finally {
      if (
        requestId === listRequestRef.current
        && renderedScopeRef.current === requestScopeKey
      ) {
        setListActivity({ key: requestScopeKey, loading: false, refreshing: false });
      }
    }
  }, [gateway, query, snapshotState]);

  useEffect(() => {
    const actorChanged = effectScopeRef.current !== currentScopeKey;
    effectScopeRef.current = currentScopeKey;
    void refresh(actorChanged);
    return () => {
      listRequestRef.current += 1;
    };
    // Refresh on the normalized query identity, not on snapshot completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, query, currentScopeKey]);

  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    if (!selectedReferralId) {
      setDetailActivity({ key: currentDetailKey, loading: false });
      return;
    }
    const requestScopeKey = currentScopeKey;
    const requestKey = currentDetailKey;
    const actorOrganizationId = query.actorOrganizationId;
    setDetailActivity({ key: requestKey, loading: true });
    setErrorState({ scopeKey: requestScopeKey, message: null });
    gateway.getReferralDetail(selectedReferralId, actorOrganizationId)
      .then((record) => {
        if (
          requestId === detailRequestRef.current
          && renderedScopeRef.current === requestScopeKey
        ) {
          setDetailState({ requestKey, value: record });
        }
      })
      .catch(() => {
        if (
          requestId === detailRequestRef.current
          && renderedScopeRef.current === requestScopeKey
        ) {
          setErrorState({
            scopeKey: requestScopeKey,
            message: "The selected referral detail is unavailable.",
          });
        }
      })
      .finally(() => {
        if (
          requestId === detailRequestRef.current
          && renderedScopeRef.current === requestScopeKey
        ) {
          setDetailActivity({ key: requestKey, loading: false });
        }
      });
    return () => {
      detailRequestRef.current += 1;
    };
  }, [
    currentDetailKey,
    currentScopeKey,
    gateway,
    query.actorOrganizationId,
    selectedReferralId,
  ]);

  const runMutation = useCallback(async (
    operation: (actorOrganizationId?: string) => Promise<ReferralWorkspaceRecord>,
  ) => {
    const requestId = ++mutationRequestRef.current;
    const actorAtStart = renderedActorRef.current;
    const scopeAtStart = actorScopeKey(actorAtStart);
    setMutationActivity({ key: scopeAtStart, loading: true, requestId });
    setErrorState({ scopeKey: scopeAtStart, message: null });
    try {
      const record = await operation(actorAtStart);
      if (scopeAtStart !== renderedScopeRef.current) {
        throw new Error(ACTOR_CHANGED_ERROR);
      }
      if (requestId !== mutationRequestRef.current) {
        throw new Error(STALE_MUTATION_ERROR);
      }
      setDetailState({
        requestKey: detailRequestKey(scopeAtStart, record.id),
        value: record,
      });
      setSnapshotState((current) => current?.scopeKey === scopeAtStart
        ? {
            scopeKey: scopeAtStart,
            value: {
              ...current.value,
              records: current.value.records.some((candidate) => candidate.id === record.id)
                ? current.value.records.map((candidate) => candidate.id === record.id ? record : candidate)
                : [record, ...current.value.records],
            },
          }
        : current);
      return record;
    } catch (mutationError) {
      if (
        requestId === mutationRequestRef.current
        && scopeAtStart === renderedScopeRef.current
      ) {
        const message = mutationError instanceof Error
          ? mutationError.message
          : "The referral action could not be completed.";
        setErrorState({ scopeKey: scopeAtStart, message });
      }
      throw mutationError;
    } finally {
      if (
        requestId === mutationRequestRef.current
        && scopeAtStart === renderedScopeRef.current
      ) {
        setMutationActivity({ key: scopeAtStart, loading: false, requestId });
      }
    }
  }, []);

  const snapshot = snapshotState?.scopeKey === currentScopeKey
    ? snapshotState.value
    : null;
  const detail = detailState?.requestKey === currentDetailKey
    ? detailState.value
    : null;
  const loading = listActivity?.key === currentScopeKey
    ? listActivity.loading
    : true;
  const refreshing = listActivity?.key === currentScopeKey
    ? Boolean(listActivity.refreshing)
    : false;
  const detailLoading = selectedReferralId
    ? detailActivity?.key !== currentDetailKey || detailActivity.loading
    : false;
  const mutating = mutationActivity?.key === currentScopeKey
    && mutationActivity.requestId === mutationRequestRef.current
    ? mutationActivity.loading
    : false;
  const error = errorState?.scopeKey === currentScopeKey
    ? errorState.message
    : null;

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
