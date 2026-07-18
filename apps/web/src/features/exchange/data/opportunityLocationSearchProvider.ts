export interface OpportunityLocationSuggestion {
  id: string;
  label: string;
  context: string;
  latitude: number;
  longitude: number;
  type?: string;
}

export interface OpportunityLocationSearchProvider {
  readonly name: string;
  readonly available: boolean;
  suggest(query: string, signal?: AbortSignal): Promise<OpportunityLocationSuggestion[]>;
}

interface MapboxFeature {
  id?: unknown;
  type?: unknown;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseSuggestion(feature: MapboxFeature, index: number): OpportunityLocationSuggestion | null {
  const coordinates = feature.geometry?.coordinates;
  if (
    feature.geometry?.type !== "Point"
    || !Array.isArray(coordinates)
    || typeof coordinates[0] !== "number"
    || typeof coordinates[1] !== "number"
  ) return null;
  const properties = feature.properties ?? {};
  const label = safeText(properties.full_address)
    ?? safeText(properties.name_preferred)
    ?? safeText(properties.name)
    ?? safeText(properties.place_formatted);
  if (!label) return null;
  const context = safeText(properties.place_formatted)
    ?? safeText(properties.context)
    ?? "";
  return {
    id: safeText(feature.id) ?? `${coordinates[0]}:${coordinates[1]}:${index}`,
    label,
    context: context === label ? "" : context,
    longitude: coordinates[0],
    latitude: coordinates[1],
    ...(safeText(properties.feature_type) ? { type: safeText(properties.feature_type) } : {}),
  };
}

export class MapboxLocationSearchProvider implements OpportunityLocationSearchProvider {
  readonly name = "mapbox-geocoding-v6";
  readonly available: boolean;
  private readonly token: string;
  private readonly endpoint: string;

  constructor(options: { token?: string; endpoint?: string } = {}) {
    this.token = options.token ?? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";
    this.endpoint = options.endpoint
      ?? process.env.NEXT_PUBLIC_MAPBOX_GEOCODING_ENDPOINT
      ?? "https://api.mapbox.com/search/geocode/v6/forward";
    this.available = Boolean(this.token && this.endpoint);
  }

  async suggest(query: string, signal?: AbortSignal): Promise<OpportunityLocationSuggestion[]> {
    const normalized = query.trim().replace(/;/g, " ").slice(0, 256);
    if (!this.available || normalized.length < 2) return [];
    const url = new URL(this.endpoint);
    url.searchParams.set("q", normalized);
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("limit", "6");
    url.searchParams.set("types", "address,street,place,locality,neighborhood,district,postcode,region");
    url.searchParams.set("country", "US");
    url.searchParams.set("permanent", "false");
    const response = await fetch(url, {
      method: "GET",
      signal,
      headers: { Accept: "application/geo+json, application/json" },
      cache: "no-store",
    });
    if (response.status === 429) throw new Error("Location search rate limit reached");
    if (!response.ok) throw new Error("Location search is temporarily unavailable");
    const payload = await response.json() as { features?: MapboxFeature[] };
    return (payload.features ?? [])
      .map(parseSuggestion)
      .filter((suggestion): suggestion is OpportunityLocationSuggestion => Boolean(suggestion));
  }
}

export class TestLocationSearchProvider implements OpportunityLocationSearchProvider {
  readonly name = "test-location-search";
  readonly available = true;

  constructor(private readonly suggestions: OpportunityLocationSuggestion[] = []) {}

  async suggest(query: string): Promise<OpportunityLocationSuggestion[]> {
    const normalized = query.trim().toLocaleLowerCase();
    return this.suggestions.filter((suggestion) => (
      `${suggestion.label} ${suggestion.context}`.toLocaleLowerCase().includes(normalized)
    ));
  }
}

let provider: OpportunityLocationSearchProvider | null = null;

export function getOpportunityLocationSearchProvider(): OpportunityLocationSearchProvider {
  if (!provider) provider = new MapboxLocationSearchProvider();
  return provider;
}
