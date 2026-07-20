#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const count = Number(process.argv[2] ?? 100);
const output = resolve(process.argv[3] ?? `tmp/opportunity-discovery-${count}.json`);
const allowedCounts = new Set([100, 1_000, 10_000]);
if (!allowedCounts.has(count)) {
  console.error("Fixture count must be 100, 1000, or 10000.");
  process.exit(1);
}

const industries = [
  { code: "236220", label: "Commercial and institutional building construction", capabilities: ["general contracting", "renovation", "project management"] },
  { code: "238210", label: "Electrical contractors", capabilities: ["electrical installation", "controls", "lighting"] },
  { code: "238220", label: "Plumbing and HVAC contractors", capabilities: ["HVAC", "building automation", "plumbing"] },
  { code: "238160", label: "Roofing contractors", capabilities: ["roof replacement", "waterproofing", "inspection"] },
  { code: "541330", label: "Engineering services", capabilities: ["civil engineering", "design", "inspection"] },
  { code: "541512", label: "Computer systems design services", capabilities: ["cybersecurity", "cloud migration", "systems integration"] },
  { code: "541611", label: "Administrative management consulting services", capabilities: ["strategic planning", "process improvement", "facilitation"] },
];
const cities = [
  { city: "Norfolk", county: "Norfolk", state: "VA", zip: "23510", fips: "51710", latitude: 36.8508, longitude: -76.2859 },
  { city: "Virginia Beach", county: "Virginia Beach", state: "VA", zip: "23451", fips: "51810", latitude: 36.8529, longitude: -75.9780 },
  { city: "Newport News", county: "Newport News", state: "VA", zip: "23607", fips: "51700", latitude: 37.0871, longitude: -76.4730 },
  { city: "Hampton", county: "Hampton", state: "VA", zip: "23669", fips: "51650", latitude: 37.0299, longitude: -76.3452 },
  { city: "Richmond", county: "Richmond", state: "VA", zip: "23219", fips: "51760", latitude: 37.5407, longitude: -77.4360 },
  { city: "Raleigh", county: "Wake", state: "NC", zip: "27601", fips: "37183", latitude: 35.7796, longitude: -78.6382 },
];
const issuerTypes = ["government", "nonprofit", "private", "institutional"];
const rfxTypes = ["RFP", "RFQ", "IFB", "RFI"];
const opportunityTypes = ["construction", "services", "professional_services", "goods", "mixed"];
const workArrangements = ["on_site", "remote", "hybrid", "flexible"];
const confidenceStates = ["exact", "approximate", "place_of_performance", "eligible_territory", "territory_centroid", "withheld", "remote", "not_geocoded"];
const now = Date.UTC(2026, 6, 18, 12, 0, 0);

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function jitter(seed, scale) {
  return ((hash(seed) % 10_001) / 10_000 - 0.5) * scale;
}

function fixture(index) {
  const id = `synthetic-rfx-${String(index + 1).padStart(6, "0")}`;
  const industry = industries[index % industries.length];
  const place = cities[index % cities.length];
  const confidence = confidenceStates[index % confidenceStates.length];
  const workArrangement = confidence === "remote"
    ? "remote"
    : workArrangements[index % workArrangements.length];
  const hasCoordinates = !["withheld", "remote", "not_geocoded"].includes(confidence);
  const postedAt = now - (index % 120) * 86_400_000;
  const updatedAt = postedAt + (index % 12) * 3_600_000;
  const responseDeadline = now + ((index % 90) - 10) * 86_400_000;
  const budgetMin = 25_000 + (index % 80) * 25_000;
  const budgetMax = budgetMin + 100_000 + (index % 20) * 50_000;
  const capabilityKeywords = [
    industry.capabilities[index % industry.capabilities.length],
    industry.capabilities[(index + 1) % industry.capabilities.length],
  ];
  const title = `${place.city} ${industry.label} opportunity ${index + 1}`;
  return {
    projectionVersion: 1,
    id,
    title,
    rfxNumber: `SYN-${2026}-${String(index + 1).padStart(6, "0")}`,
    searchableDescription: `Synthetic emulator-only ${industry.label.toLowerCase()} requirement serving ${place.city}.`,
    issuerOrganizationId: `synthetic-issuer-${index % 24}`,
    issuerDisplayName: `${place.city} Synthetic ${issuerTypes[index % issuerTypes.length]} issuer`,
    issuerType: issuerTypes[index % issuerTypes.length],
    issuerVerified: index % 5 !== 0,
    rfxType: rfxTypes[index % rfxTypes.length],
    opportunityType: opportunityTypes[index % opportunityTypes.length],
    naicsCodes: [industry.code],
    industryLabels: [industry.label],
    capabilityKeywords,
    postedAt,
    updatedAt,
    responseDeadline,
    deadlineTimezone: "America/New_York",
    budgetMin,
    budgetMax,
    budgetDisplay: `$${budgetMin.toLocaleString("en-US")}–$${budgetMax.toLocaleString("en-US")}`,
    currency: "USD",
    placeOfPerformance: confidence === "withheld"
      ? "Location withheld"
      : confidence === "remote"
        ? "Remote"
        : `${place.city}, ${place.state}`,
    workArrangement,
    territoryFips: place.fips,
    city: place.city,
    county: place.county,
    state: place.state,
    postalCode: place.zip,
    locationConfidence: confidence,
    ...(hasCoordinates ? {
      geo: {
        latitude: place.latitude + jitter(`${id}-lat`, 0.08),
        longitude: place.longitude + jitter(`${id}-lng`, 0.08),
        geohash: `synthetic-${place.fips}-${index % 50}`,
        confidence,
      },
    } : {}),
    visibility: index % 11 === 0 ? "restricted" : index % 5 === 0 ? "members" : "public",
    requiredCertifications: index % 4 === 0 ? ["SWaM"] : [],
    setAsideDesignations: index % 7 === 0 ? ["small_business"] : [],
    primeClassification: index % 6 === 0 ? "subcontract" : "prime",
    awardClassification: index % 8 === 0 ? "multiple" : "single",
    teamingSuitable: index % 3 === 0,
    addendumCount: index % 4,
    qAndAStatus: index % 3 === 0 ? "open" : "not_available",
    responseCount: index % 17,
    status: responseDeadline < now ? "closed" : "open",
    discoverable: responseDeadline >= now,
    recommendedRank: 1_000_000 - index,
    searchTokens: [...new Set([
      ...title.toLowerCase().split(/\s+/),
      industry.code,
      ...capabilityKeywords.flatMap((value) => value.toLowerCase().split(/\s+/)),
      place.city.toLowerCase(),
      place.state.toLowerCase(),
    ])],
    relationship: {
      saved: index % 9 === 0,
      viewed: index % 4 === 0,
      responded: index % 13 === 0,
      managed: index % 29 === 0,
      newSinceLastVisit: index % 10 === 0,
      updatedSinceViewed: index % 12 === 0,
      eligibleToRespond: index % 13 !== 0 && responseDeadline >= now,
    },
    synthetic: true,
  };
}

const records = Array.from({ length: count }, (_, index) => fixture(index));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({
  generatedAt: new Date(now).toISOString(),
  count,
  synthetic: true,
  records,
}, null, 2)}\n`, "utf8");
console.log(`Wrote ${count.toLocaleString("en-US")} synthetic opportunity projections to ${output}`);
