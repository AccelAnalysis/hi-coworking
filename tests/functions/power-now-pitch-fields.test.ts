import { describe, expect, it } from "vitest";
import { validatePowerNowPayload } from "../../apps/functions/src/expo/powerNowModel";
import {
  BUSINESS_STAGE_OPTIONS,
  OPPORTUNITY_OPTIONS,
  US_STATE_OPTIONS,
  pitchListEntryValues,
  readPitchListAttributes,
  resolveBusinessStage,
  resolveOpportunity,
  resolveUsState,
} from "../../apps/functions/src/expo/powerNowPitchFields";

const NOW = new Date("2026-10-07T21:35:00.000Z");
const PITCH_ID = "11111111-1111-4111-8111-111111111111";

function pitch(overrides: Record<string, unknown> = {}) {
  return {
    form: "power-now",
    path: "pitch",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "",
    businessName: "Analytical Engines",
    city: "Carrollton",
    state: "VA",
    businessStage: "development_testing",
    opportunityType: "growing_an_existing_business",
    businessDescription: "We help local makers test a first product.",
    pitchTopic: "A workshop kit for first customers.",
    progress: "",
    consent: { email: false, sms: false, phone: false },
    clientSubmissionId: PITCH_ID,
    submittedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("Power NOW pitch field validation", () => {
  it("accepts the new pitch fields and rejects values outside the lists", () => {
    const ok = validatePowerNowPayload(pitch(), NOW);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.lead).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      city: "Carrollton",
      stateCode: "VA",
      stateName: "Virginia",
      businessStage: "development_testing",
      businessStageLabel: "Development / Testing",
      opportunityType: "growing_an_existing_business",
      opportunityLabel: "Growing an existing business",
    });
    expect(ok.lead.descriptionTag).toContain("city:Carrollton");
    expect(ok.lead.descriptionTag).toContain("state:VA");
    expect(ok.lead.descriptionTag).toContain("stage:development_testing");
    expect(ok.lead.descriptionTag).toContain("opportunity:growing_an_existing_business");

    expect(validatePowerNowPayload(pitch({ businessStage: "Idea / Concept" }), NOW).ok).toBe(false);
    expect(validatePowerNowPayload(pitch({ opportunityType: "Growing an existing business" }), NOW).ok).toBe(false);
    expect(validatePowerNowPayload(pitch({ opportunityType: "" }), NOW)).toMatchObject({
      ok: false,
      fields: { opportunity: "Please add the opportunity you are pitching." },
    });
    expect(validatePowerNowPayload(pitch({ opportunityType: undefined }), NOW)).toMatchObject({
      ok: false,
      fields: { opportunity: "Please add the opportunity you are pitching." },
    });
    expect(validatePowerNowPayload(pitch({ state: "Ontario" }), NOW).ok).toBe(false);
    expect(validatePowerNowPayload(pitch({ city: "" }), NOW).ok).toBe(false);
    expect(validatePowerNowPayload(pitch({ firstName: "Ada", lastName: "" }), NOW)).toMatchObject({
      ok: false,
      fields: { lastName: "Please add your last name." },
    });
  });

  it("keeps idea, prototype, early_revenue, and other working for older clients", () => {
    const cases = [
      ["idea", "idea_concept", "Idea / Concept"],
      ["Idea", "idea_concept", "Idea / Concept"],
      ["prototype", "development_testing", "Development / Testing"],
      ["Prototype or testing", "development_testing", "Development / Testing"],
      ["early_revenue", "early_revenue_traction", "Early Revenue / Traction"],
      ["Early revenue", "early_revenue_traction", "Early Revenue / Traction"],
      ["other", "other", "Other"],
      ["Other", "other", "Other"],
    ] as const;
    for (const [raw, value, label] of cases) {
      const result = validatePowerNowPayload(pitch({
        firstName: undefined,
        lastName: undefined,
        fullName: "Ada Lovelace",
        businessStage: raw,
        businessStageOther: raw === "Other" ? "A co-op" : "",
      }), NOW);
      expect(result.ok, raw).toBe(true);
      if (!result.ok) continue;
      expect(result.lead.businessStage, raw).toBe(value);
      expect(result.lead.businessStageLabel, raw).toBe(label);
      expect(result.lead.firstName).toBe("Ada");
      expect(result.lead.lastName).toBe("Lovelace");
      if (raw === "Other") {
        expect(result.lead.answers.find((answer) => answer.label === "Business stage")?.value).toBe("Other: A co-op");
      }
    }
    expect(resolveBusinessStage("not-a-stage")).toBeNull();
    expect(resolveOpportunity("other")).toEqual({ value: "other", label: "Other" });
    expect(resolveUsState("dc")).toEqual({ code: "DC", name: "District of Columbia" });
    expect(resolveUsState("U.S. Virgin Islands")).toEqual({ code: "VI", name: "U.S. Virgin Islands" });
  });

  it("lists 50 states, D.C., and the inhabited territories, with stable option values", () => {
    expect(US_STATE_OPTIONS).toHaveLength(56);
    expect(new Set(US_STATE_OPTIONS.map((state) => state.code)).size).toBe(56);
    expect(US_STATE_OPTIONS.map((state) => state.code)).toEqual(expect.arrayContaining([
      "DC", "AS", "GU", "MP", "PR", "VI",
    ]));
    expect(BUSINESS_STAGE_OPTIONS.map((option) => option.value)).toEqual([
      "idea_concept",
      "research_validation",
      "development_testing",
      "launch_early_operations",
      "early_revenue_traction",
      "established_stable_operations",
      "growth_scaling",
      "expansion_diversification",
      "transformation_repositioning",
      "other",
    ]);
    expect(OPPORTUNITY_OPTIONS.map((option) => option.value)).toEqual([
      "starting_a_new_business",
      "launching_a_new_product_or_service",
      "growing_an_existing_business",
      "expanding_into_new_markets",
      "improving_or_transforming_operations",
      "revitalizing_or_turning_around_a_business",
      "acquiring_or_transitioning_business_ownership",
      "seeking_a_strategic_partnership",
      "other",
    ]);
    for (const option of [...BUSINESS_STAGE_OPTIONS, ...OPPORTUNITY_OPTIONS]) {
      expect(option.value).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("writes pitch list values only for attributes that are present and writable", () => {
    const lead = {
      city: "Carrollton",
      stateName: "Virginia",
      stateCode: "VA",
      businessStage: "development_testing",
      businessStageLabel: "Development / Testing",
      opportunityType: "growing_an_existing_business",
      opportunityLabel: "Growing an existing business",
    };
    expect(pitchListEntryValues(lead, readPitchListAttributes([
      { api_slug: "entry_id", type: "text", is_writable: false },
      { api_slug: "city", type: "text" },
    ]))).toEqual({ city: [{ value: "Carrollton" }] });
    expect(pitchListEntryValues(lead, [])).toEqual({});
    expect(pitchListEntryValues(lead, readPitchListAttributes([
      { api_slug: "state", type: "select", is_archived: true },
      { api_slug: "business_stage", type: "number" },
    ]))).toEqual({});
  });

  it("leaves watch and contribute on a single name field", () => {
    const watch = validatePowerNowPayload({
      path: "watch",
      fullName: "Grace Hopper",
      email: "grace@example.com",
      consent: { email: true, sms: false, phone: false },
      clientSubmissionId: "22222222-2222-4222-8222-222222222222",
    }, NOW);
    expect(watch.ok).toBe(true);
    if (!watch.ok) return;
    expect(watch.lead.city).toBeNull();
    expect(watch.lead.businessStage).toBeNull();
    expect(watch.lead.opportunityType).toBeNull();
    expect(watch.lead.descriptionTag).not.toContain("city:");
  });
});
