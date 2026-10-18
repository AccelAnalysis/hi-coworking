/**
 * Pitch-path fields for the Power NOW interest form.
 *
 * Stable snake_case values are what the server stores. Legacy clients may
 * still send idea, prototype, early_revenue, other, or the old labels
 * "Idea", "Prototype or testing", "Early revenue", and "Other".
 *
 * The Jessica fit-question seed on unmerged #85
 * (apps/functions/src/expo/powerNowApproved.ts) still lists those four old
 * labels. It is not on main, so this file is the source of the new options.
 */

export type LabeledOption = {
  value: string;
  label: string;
  helper?: string;
};

export const BUSINESS_STAGE_INTRO =
  "Select the option that best describes your business's current position.";

export const BUSINESS_STAGE_OPTIONS = [
  {
    value: "idea_concept",
    label: "Idea / Concept",
    helper: "Exploring a business idea that has not yet launched.",
  },
  {
    value: "research_validation",
    label: "Research / Validation",
    helper: "Evaluating market demand, feasibility, and the business model.",
  },
  {
    value: "development_testing",
    label: "Development / Testing",
    helper: "Developing or piloting a product, service, or business concept.",
  },
  {
    value: "launch_early_operations",
    label: "Launch / Early Operations",
    helper: "Recently launched or preparing to begin commercial operations.",
  },
  {
    value: "early_revenue_traction",
    label: "Early Revenue / Traction",
    helper: "Generating initial sales and establishing a customer base.",
  },
  {
    value: "established_stable_operations",
    label: "Established / Stable Operations",
    helper: "Operating with an established customer base and ongoing business activity.",
  },
  {
    value: "growth_scaling",
    label: "Growth / Scaling",
    helper: "Increasing revenue, capacity, staffing, or market reach.",
  },
  {
    value: "expansion_diversification",
    label: "Expansion / Diversification",
    helper: "Entering new markets, launching additional offerings, or pursuing major expansion.",
  },
  {
    value: "transformation_repositioning",
    label: "Transformation / Repositioning",
    helper: "Modernizing, restructuring, pivoting, or revitalizing an existing business.",
  },
  {
    value: "other",
    label: "Other",
    helper: "A business situation not captured by the categories above.",
  },
] as const satisfies readonly LabeledOption[];

export const OPPORTUNITY_QUESTION = "What best describes the opportunity you are pitching?";

export const OPPORTUNITY_OPTIONS = [
  { value: "starting_a_new_business", label: "Starting a new business" },
  { value: "launching_a_new_product_or_service", label: "Launching a new product or service" },
  { value: "growing_an_existing_business", label: "Growing an existing business" },
  { value: "expanding_into_new_markets", label: "Expanding into new markets" },
  { value: "improving_or_transforming_operations", label: "Improving or transforming operations" },
  { value: "revitalizing_or_turning_around_a_business", label: "Revitalizing or turning around a business" },
  { value: "acquiring_or_transitioning_business_ownership", label: "Acquiring or transitioning business ownership" },
  { value: "seeking_a_strategic_partnership", label: "Seeking a strategic partnership" },
  { value: "other", label: "Other" },
] as const satisfies readonly LabeledOption[];

/** 50 states, the District of Columbia, and inhabited U.S. territories. */
export const US_STATE_OPTIONS = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AS", name: "American Samoa" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "GU", name: "Guam" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "PR", name: "Puerto Rico" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
] as const;

/**
 * Attributes Jonathan creates on the Pitch Competition list. This code does
 * not create them. entry_values are written only for slugs Attio already has.
 */
export const PITCH_LIST_ATTRIBUTES = {
  city: { slug: "city", type: "text" as const },
  state: { slug: "state", type: "select" as const },
  businessStage: { slug: "business_stage", type: "select" as const },
  opportunityType: { slug: "opportunity_type", type: "select" as const },
} as const;

const LEGACY_STAGE_VALUES: Record<string, (typeof BUSINESS_STAGE_OPTIONS)[number]["value"]> = {
  idea: "idea_concept",
  prototype: "development_testing",
  "prototype or testing": "development_testing",
  early_revenue: "early_revenue_traction",
  "early revenue": "early_revenue_traction",
  other: "other",
};

export type PitchListAttribute = {
  apiSlug: string;
  type: string;
  writable: boolean;
};

export function resolveBusinessStage(raw: string): { value: string; label: string } | null {
  const direct = BUSINESS_STAGE_OPTIONS.find((option) => option.value === raw);
  if (direct) return { value: direct.value, label: direct.label };
  const legacy = LEGACY_STAGE_VALUES[raw.trim().toLowerCase()];
  if (!legacy) return null;
  const mapped = BUSINESS_STAGE_OPTIONS.find((option) => option.value === legacy);
  return mapped ? { value: mapped.value, label: mapped.label } : null;
}

export function resolveOpportunity(raw: string): { value: string; label: string } | null {
  const match = OPPORTUNITY_OPTIONS.find((option) => option.value === raw);
  return match ? { value: match.value, label: match.label } : null;
}

export function resolveUsState(raw: string): { code: string; name: string } | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const match = US_STATE_OPTIONS.find(
    (state) => state.code.toLowerCase() === trimmed || state.name.toLowerCase() === trimmed,
  );
  return match ? { code: match.code, name: match.name } : null;
}

export function readPitchListAttributes(data: unknown): PitchListAttribute[] {
  if (!Array.isArray(data)) return [];
  const attributes: PitchListAttribute[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const apiSlug = typeof record.api_slug === "string" ? record.api_slug.trim() : "";
    const type = typeof record.type === "string" ? record.type.trim() : "";
    if (!apiSlug || !type || record.is_archived === true) continue;
    attributes.push({
      apiSlug,
      type,
      writable: record.is_writable !== false,
    });
  }
  return attributes;
}

export function pitchListEntryValues(
  input: {
    city: string | null;
    stateName: string | null;
    stateCode: string | null;
    businessStage: string | null;
    businessStageLabel: string | null;
    opportunityType: string | null;
    opportunityLabel: string | null;
  },
  attributes: readonly PitchListAttribute[],
): Record<string, unknown> {
  const bySlug = new Map(
    attributes.filter((attribute) => attribute.writable).map((attribute) => [attribute.apiSlug, attribute]),
  );
  const values: Record<string, unknown> = {};
  const city = bySlug.get(PITCH_LIST_ATTRIBUTES.city.slug);
  if (city?.type === "text" && input.city) values.city = [{ value: input.city }];

  const state = bySlug.get(PITCH_LIST_ATTRIBUTES.state.slug);
  if (state?.type === "select" && input.stateName) values.state = [{ option: input.stateName }];
  else if (state?.type === "text" && input.stateCode) values.state = [{ value: input.stateCode }];

  const stage = bySlug.get(PITCH_LIST_ATTRIBUTES.businessStage.slug);
  if (stage?.type === "select" && input.businessStageLabel) {
    values.business_stage = [{ option: input.businessStageLabel }];
  } else if (stage?.type === "text" && input.businessStage) {
    values.business_stage = [{ value: input.businessStage }];
  }

  const opportunity = bySlug.get(PITCH_LIST_ATTRIBUTES.opportunityType.slug);
  if (opportunity?.type === "select" && input.opportunityLabel) {
    values.opportunity_type = [{ option: input.opportunityLabel }];
  } else if (opportunity?.type === "text" && input.opportunityType) {
    values.opportunity_type = [{ value: input.opportunityType }];
  }
  return values;
}

export function pitchDescriptionTokens(input: {
  city: string;
  stateCode: string;
  businessStage: string;
  opportunityType: string;
}): string[] {
  return [
    `city:${tagToken(input.city)}`,
    `state:${tagToken(input.stateCode)}`,
    `stage:${tagToken(input.businessStage)}`,
    `opportunity:${tagToken(input.opportunityType)}`,
  ];
}

function tagToken(value: string): string {
  return value.replace(/[|[\]]/g, " ").replace(/\s+/g, " ").trim();
}
