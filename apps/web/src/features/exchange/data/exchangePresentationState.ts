import type { ExchangeStateKind } from "../components/exchangeStateCopy";

export interface ExchangePresentationStateInput {
  loading: boolean;
  errorKind?: "permission" | "offline" | "unknown";
  sourceCount: number;
  resultCount: number;
  isFiltered: boolean;
}

/** Returns only states that replace the central discovery surface. */
export function resolveExchangeBlockingState({
  loading,
  errorKind,
  sourceCount,
  resultCount,
  isFiltered,
}: ExchangePresentationStateInput): ExchangeStateKind | null {
  if (loading && sourceCount === 0) return "loading";
  if (errorKind && sourceCount === 0) {
    return errorKind === "permission" ? "permission" : "error";
  }
  if (sourceCount === 0) return "empty";
  if (resultCount === 0) return isFiltered ? "filtered-empty" : "empty";
  return null;
}
