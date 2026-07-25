export type TerritoryStatus = "released" | "scheduled" | "paused" | "archived";

export type SearchableTerritory = {
  fips: string;
  name: string;
  state: string;
  status: TerritoryStatus;
  type?: "county" | "city" | "custom_polygon";
  centroid?: { lat: number; lng: number };
};

export type GeographySearchResult<T extends SearchableTerritory = SearchableTerritory> = {
  key: string;
  label: string;
  detail: string;
  territory: T | null;
  availability: "released" | "scheduled" | "unavailable";
  source: "exchange" | "mapbox";
};

type MapboxContext = {
  district?: { name?: string };
  place?: { name?: string };
  region?: { name?: string; region_code?: string };
  postcode?: { name?: string };
};

type MapboxFeature = {
  id?: string;
  properties?: {
    name?: string;
    full_address?: string;
    place_formatted?: string;
    feature_type?: string;
    context?: MapboxContext;
  };
};

function normalizePlace(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b(county|city|town|borough|parish|municipality|independent city)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeState(value: unknown): string {
  const text = String(value ?? "").trim().toUpperCase();
  return text.startsWith("US-") ? text.slice(3) : text;
}

function territoryAvailability(status: TerritoryStatus): GeographySearchResult["availability"] {
  return status === "released" ? "released" : status === "scheduled" ? "scheduled" : "unavailable";
}

function resultForTerritory<T extends SearchableTerritory>(territory: T): GeographySearchResult<T> {
  const availability = territoryAvailability(territory.status);
  return {
    key: `territory:${territory.fips}`,
    label: `${territory.name}, ${territory.state}`,
    detail: availability === "released"
      ? "Open for full RFxchange participation"
      : availability === "scheduled"
        ? "Scheduled for release; selection can be saved"
        : "Not currently open for full participation",
    territory,
    availability,
    source: "exchange",
  };
}

function matchManagedTerritory<T extends SearchableTerritory>(feature: MapboxFeature, territories: readonly T[]): T | null {
  const context = feature.properties?.context;
  const state = normalizeState(context?.region?.region_code || context?.region?.name);
  const candidateNames = [
    context?.district?.name,
    feature.properties?.feature_type === "place" ? feature.properties?.name : undefined,
    context?.place?.name,
    feature.properties?.name,
  ].filter((value): value is string => Boolean(value));

  const normalizedNames = candidateNames.map(normalizePlace).filter(Boolean);
  const stateMatches = state
    ? territories.filter((territory) => normalizeState(territory.state) === state)
    : [...territories];

  for (const normalized of normalizedNames) {
    const exact = stateMatches.find((territory) => normalizePlace(territory.name) === normalized);
    if (exact) return exact;
  }
  for (const normalized of normalizedNames) {
    const fuzzy = stateMatches.find((territory) => {
      const name = normalizePlace(territory.name);
      return Boolean(name && normalized && (name.includes(normalized) || normalized.includes(name)));
    });
    if (fuzzy) return fuzzy;
  }
  return null;
}

export function searchManagedTerritories<T extends SearchableTerritory>(query: string, territories: readonly T[]): GeographySearchResult<T>[] {
  const normalized = normalizePlace(query);
  const raw = query.trim().toLowerCase();
  const sorted = [...territories].sort((left, right) => {
    const priority = (status: TerritoryStatus) => status === "released" ? 0 : status === "scheduled" ? 1 : 2;
    return priority(left.status) - priority(right.status) || left.name.localeCompare(right.name);
  });

  const matches = normalized || raw
    ? sorted.filter((territory) => {
        const name = normalizePlace(territory.name);
        return name.includes(normalized)
          || normalizeState(territory.state).toLowerCase().includes(raw)
          || territory.fips.includes(raw);
      })
    : sorted.filter((territory) => territory.status === "released" || territory.status === "scheduled");

  return matches.slice(0, normalized ? 12 : 8).map(resultForTerritory);
}

export async function searchExchangeGeographies<T extends SearchableTerritory>(query: string, territories: readonly T[]): Promise<GeographySearchResult<T>[]> {
  const direct = searchManagedTerritories(query, territories);
  const trimmed = query.trim();
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  if (trimmed.length < 3 || !token || !token.startsWith("pk.")) return direct;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "postcode,place,district,region");
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", "5");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_500) });
    if (!response.ok) return direct;
    const payload = await response.json() as { features?: MapboxFeature[] };
    const remote = (payload.features ?? []).map((feature, index): GeographySearchResult<T> => {
      const territory = matchManagedTerritory(feature, territories);
      if (territory) return resultForTerritory(territory);
      const properties = feature.properties;
      const label = properties?.full_address || properties?.place_formatted || properties?.name || trimmed;
      return {
        key: `mapbox:${feature.id || index}:${label}`,
        label,
        detail: "Geography found, but this community is not yet configured for RFxchange participation",
        territory: null,
        availability: "unavailable",
        source: "mapbox",
      };
    });

    const deduped = new Map<string, GeographySearchResult<T>>();
    [...direct, ...remote].forEach((result) => {
      const key = result.territory ? `territory:${result.territory.fips}` : result.key;
      if (!deduped.has(key)) deduped.set(key, result);
    });
    return [...deduped.values()].slice(0, 12);
  } catch {
    return direct;
  }
}
