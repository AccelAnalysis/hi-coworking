export const NAICS_CATALOG_METADATA = {
  version: "2022",
  source: "U.S. Census Bureau",
  sourceDataset: "2022 NAICS Structure",
  importedAt: "2026-07-18",
  coverage: "common-exchange-industries",
} as const;

export interface NaicsCatalogEntry {
  code: string;
  label: string;
  parentCode?: string;
  level: 2 | 3 | 4 | 5 | 6;
  keywords?: string[];
}

/**
 * Curated launch subset used by the filter UI. The adapter and metadata are
 * intentionally versioned so the official complete Census structure can be
 * generated into this module without changing component contracts.
 */
export const NAICS_CATALOG: readonly NaicsCatalogEntry[] = [
  { code: "23", label: "Construction", level: 2, keywords: ["contractor", "building", "facilities"] },
  { code: "236", label: "Construction of buildings", parentCode: "23", level: 3 },
  { code: "2361", label: "Residential building construction", parentCode: "236", level: 4 },
  { code: "236115", label: "New single-family housing construction", parentCode: "2361", level: 6 },
  { code: "236116", label: "New multifamily housing construction", parentCode: "2361", level: 6 },
  { code: "2362", label: "Nonresidential building construction", parentCode: "236", level: 4 },
  { code: "236210", label: "Industrial building construction", parentCode: "2362", level: 6 },
  { code: "236220", label: "Commercial and institutional building construction", parentCode: "2362", level: 6 },
  { code: "237", label: "Heavy and civil engineering construction", parentCode: "23", level: 3 },
  { code: "237110", label: "Water and sewer line construction", parentCode: "237", level: 6 },
  { code: "237310", label: "Highway, street, and bridge construction", parentCode: "237", level: 6 },
  { code: "238", label: "Specialty trade contractors", parentCode: "23", level: 3 },
  { code: "238160", label: "Roofing contractors", parentCode: "238", level: 6, keywords: ["roof"] },
  { code: "238210", label: "Electrical contractors", parentCode: "238", level: 6, keywords: ["electrician"] },
  { code: "238220", label: "Plumbing and HVAC contractors", parentCode: "238", level: 6, keywords: ["heating", "air conditioning"] },
  { code: "238990", label: "All other specialty trade contractors", parentCode: "238", level: 6 },
  { code: "42", label: "Wholesale trade", level: 2, keywords: ["supplier", "distribution"] },
  { code: "44", label: "Retail trade", level: 2 },
  { code: "48", label: "Transportation and warehousing", level: 2, keywords: ["logistics", "freight"] },
  { code: "51", label: "Information", level: 2, keywords: ["media", "telecommunications", "data"] },
  { code: "52", label: "Finance and insurance", level: 2 },
  { code: "53", label: "Real estate and rental and leasing", level: 2 },
  { code: "54", label: "Professional, scientific, and technical services", level: 2, keywords: ["consulting", "technology", "engineering"] },
  { code: "5413", label: "Architectural, engineering, and related services", parentCode: "54", level: 4 },
  { code: "541310", label: "Architectural services", parentCode: "5413", level: 6 },
  { code: "541330", label: "Engineering services", parentCode: "5413", level: 6 },
  { code: "5415", label: "Computer systems design and related services", parentCode: "54", level: 4 },
  { code: "541511", label: "Custom computer programming services", parentCode: "5415", level: 6, keywords: ["software development"] },
  { code: "541512", label: "Computer systems design services", parentCode: "5415", level: 6, keywords: ["IT consulting"] },
  { code: "541519", label: "Other computer related services", parentCode: "5415", level: 6 },
  { code: "5416", label: "Management, scientific, and technical consulting services", parentCode: "54", level: 4 },
  { code: "541611", label: "Administrative management consulting services", parentCode: "5416", level: 6 },
  { code: "541612", label: "Human resources consulting services", parentCode: "5416", level: 6 },
  { code: "541618", label: "Other management consulting services", parentCode: "5416", level: 6 },
  { code: "56", label: "Administrative and support and waste management services", level: 2 },
  { code: "561210", label: "Facilities support services", parentCode: "56", level: 6 },
  { code: "61", label: "Educational services", level: 2 },
  { code: "62", label: "Health care and social assistance", level: 2 },
  { code: "71", label: "Arts, entertainment, and recreation", level: 2 },
  { code: "72", label: "Accommodation and food services", level: 2 },
  { code: "81", label: "Other services", level: 2 },
  { code: "92", label: "Public administration", level: 2, keywords: ["government"] },
] as const;

export function searchNaicsCatalog(query: string, limit = 30): NaicsCatalogEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return NAICS_CATALOG.filter((entry) => entry.level === 2 || entry.code.length === 6).slice(0, limit);
  return NAICS_CATALOG
    .map((entry) => {
      const label = entry.label.toLocaleLowerCase();
      const keywords = (entry.keywords ?? []).join(" ").toLocaleLowerCase();
      const score = entry.code === normalized
        ? 100
        : entry.code.startsWith(normalized)
          ? 80
          : label.startsWith(normalized)
            ? 60
            : label.includes(normalized)
              ? 40
              : keywords.includes(normalized)
                ? 20
                : 0;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.code.localeCompare(right.entry.code))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function labelForNaics(code: string): string | undefined {
  return NAICS_CATALOG.find((entry) => entry.code === code)?.label;
}
