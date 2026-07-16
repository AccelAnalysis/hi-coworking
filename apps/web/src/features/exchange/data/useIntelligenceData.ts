"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ExchangeRun3Gateway,
  ReferralIntelligenceSnapshot,
} from "./exchangeRun3Gateway";

export function useIntelligenceData(gateway: ExchangeRun3Gateway) {
  const [snapshot, setSnapshot] = useState<ReferralIntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(snapshot === null);
    setRefreshing(snapshot !== null);
    setError(null);
    try {
      setSnapshot(await gateway.getIntelligence());
    } catch {
      setError("Referral intelligence could not be loaded for this authorized scope.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gateway, snapshot]);

  useEffect(() => {
    void refresh();
    // One load per mounted gateway. Refresh is also exposed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  return { snapshot, loading, refreshing, error, refresh };
}
