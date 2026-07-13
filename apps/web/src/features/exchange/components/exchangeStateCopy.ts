export type ExchangeStateKind =
  | "loading"
  | "empty"
  | "filtered-empty"
  | "error"
  | "permission"
  | "selection-unavailable"
  | "token-missing"
  | "map-error"
  | "no-geocoded-rfx";

export interface ExchangeStateCopy {
  title: string;
  description: string;
}

export function getExchangeStateCopy(kind: ExchangeStateKind): ExchangeStateCopy {
  switch (kind) {
    case "loading":
      return { title: "Loading Hi Exchange", description: "Finding current opportunities and territories." };
    case "empty":
      return { title: "No current Exchange records", description: "There are no approved open RFx or active territory releases to show yet." };
    case "filtered-empty":
      return { title: "No results match these filters", description: "Clear one or more filters to return to the current Exchange records." };
    case "permission":
      return { title: "Access is not available", description: "This account cannot access the requested Exchange records." };
    case "selection-unavailable":
      return { title: "Selected record is unavailable", description: "It is not in the current bounded discovery snapshot, may have been removed, or is not readable by this account." };
    case "token-missing":
      return { title: "Map view is not configured", description: "List view remains available. Configure NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to enable the map." };
    case "map-error":
      return { title: "Map view could not load", description: "Your results remain available in list view. You can retry the map without reloading Exchange data." };
    case "no-geocoded-rfx":
      return { title: "These RFx are available in the list", description: "No matching RFx currently include map coordinates, so use list view to inspect them." };
    case "error":
    default:
      return { title: "Exchange data could not be loaded", description: "Try again in a moment. No protected details were exposed." };
  }
}
