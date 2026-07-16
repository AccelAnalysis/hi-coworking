import type { ExchangeWorkspaceAction } from "../state/exchangeWorkspaceActions";
import type {
  ExchangeView,
  ExchangeWorkspaceState,
} from "../state/exchangeWorkspaceTypes";

export type ExchangeHistoryMode = "push" | "replace" | "none";

export interface ExchangeViewProps {
  state: ExchangeWorkspaceState;
  applyAction: (
    action: ExchangeWorkspaceAction,
    history?: ExchangeHistoryMode,
  ) => ExchangeWorkspaceState;
  scheduleUrlReplace: (delay?: number) => void;
  onViewChange: (view: ExchangeView) => void;
}
