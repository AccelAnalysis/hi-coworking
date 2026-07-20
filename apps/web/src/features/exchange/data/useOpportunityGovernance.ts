"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeOpportunityAddendum,
  answerOpportunityQuestion,
  createOpportunityAddendum,
  loadOpportunityGovernance,
  submitOpportunityQuestion,
  type OpportunityGovernanceSnapshot,
} from "./opportunityDiscoveryGateway";
import { normalizeExchangeDataError, type ExchangeDataError } from "./exchangeRepository";

const EMPTY: OpportunityGovernanceSnapshot = {
  addenda: [],
  questions: [],
  addendaTruncated: false,
  questionsTruncated: false,
  canManage: false,
  canAsk: false,
};

export function useOpportunityGovernance(rfxId?: string) {
  const [snapshot, setSnapshot] = useState<OpportunityGovernanceSnapshot>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<ExchangeDataError | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!rfxId) {
      setSnapshot(EMPTY);
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadOpportunityGovernance(rfxId);
      if (version === requestVersion.current) setSnapshot(next);
    } catch (caught) {
      if (version === requestVersion.current) setError(normalizeExchangeDataError(caught));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [rfxId]);

  useEffect(() => {
    void refresh();
    return () => {
      requestVersion.current += 1;
    };
  }, [refresh]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setMutating(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (caught) {
      setError(normalizeExchangeDataError(caught));
      throw caught;
    } finally {
      setMutating(false);
    }
  }, [refresh]);

  return {
    ...snapshot,
    loading,
    mutating,
    error,
    refresh,
    submitQuestion: (input: {
      question: string;
      visibilityRequested: "public" | "private";
      organizationId?: string;
    }) => {
      if (!rfxId) return Promise.reject(new Error("Opportunity is not selected"));
      return mutate(() => submitOpportunityQuestion({ rfxId, ...input }));
    },
    answerQuestion: (input: {
      questionId: string;
      answer: string;
      visibility: "public" | "private";
    }) => {
      if (!rfxId) return Promise.reject(new Error("Opportunity is not selected"));
      return mutate(() => answerOpportunityQuestion({ rfxId, ...input }));
    },
    createAddendum: (input: {
      title: string;
      summary: string;
      materialChanges: string[];
      deadlineChanged: boolean;
      previousDeadline?: number;
      newDeadline?: number;
      acknowledgmentRequired: boolean;
    }) => {
      if (!rfxId) return Promise.reject(new Error("Opportunity is not selected"));
      return mutate(() => createOpportunityAddendum({ rfxId, ...input }));
    },
    acknowledgeAddendum: (input: { addendumId: string; organizationId?: string }) => {
      if (!rfxId) return Promise.reject(new Error("Opportunity is not selected"));
      return mutate(() => acknowledgeOpportunityAddendum({ rfxId, ...input }));
    },
  };
}
