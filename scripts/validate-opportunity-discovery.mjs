#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const requiredFiles = [
  "packages/shared/src/opportunityDiscovery.ts",
  "apps/functions/src/opportunityDiscovery.ts",
  "apps/functions/src/opportunityDiscoveryGateway.ts",
  "apps/functions/src/opportunityDiscoveryFallback.ts",
  "apps/functions/src/opportunityPersonalization.ts",
  "apps/functions/src/opportunityGovernance.ts",
  "apps/functions/src/opportunityRecentSearches.ts",
  "apps/web/src/features/exchange/data/opportunityDiscoveryGateway.ts",
  "apps/web/src/features/exchange/data/opportunityLocationSearchProvider.ts",
  "apps/web/src/features/exchange/data/useOpportunityDiscovery.ts",
  "apps/web/src/features/exchange/components/OpportunityLocationSearch.tsx",
  "apps/web/src/features/exchange/components/ExchangeFilters.tsx",
  "apps/web/src/features/exchange/components/ExchangeRfxCard.tsx",
  "apps/web/src/features/exchange/components/OpportunityGovernancePanel.tsx",
  "apps/web/src/features/exchange/components/SavedOpportunitySearchManager.tsx",
  "apps/web/src/features/exchange/views/ExchangeOpportunitiesView.tsx",
  "docs/exchange/opportunity-discovery-100-audit.md",
  "docs/exchange/opportunity-discovery-search.md",
  "docs/exchange/opportunity-discovery-geography.md",
  "docs/exchange/opportunity-discovery-filters-and-sorting.md",
  "docs/exchange/opportunity-discovery-scaling.md",
  "docs/exchange/opportunity-discovery-accessibility.md",
  "docs/exchange/opportunity-discovery-performance.md",
  "docs/exchange/opportunity-discovery-acceptance.md",
];

const checks = [];
const failures = [];

function pass(message) {
  checks.push(`PASS ${message}`);
}

function fail(message) {
  failures.push(`FAIL ${message}`);
}

async function exists(path) {
  try {
    await stat(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}

for (const path of requiredFiles) {
  if (await exists(path)) pass(`required file: ${path}`);
  else fail(`required file missing: ${path}`);
}

const shared = await text("packages/shared/src/opportunityDiscovery.ts");
for (const token of [
  "OPPORTUNITY_DISCOVERY_PROJECTION_VERSION",
  "opportunityDiscoveryQuerySchema",
  "opportunityDiscoveryRecordSchema",
  "OpportunityLocationFilter",
  "haversineDistanceMiles",
  "locationConfidence",
]) {
  if (shared.includes(token)) pass(`shared contract includes ${token}`);
  else fail(`shared contract missing ${token}`);
}

const workspaceTypes = await text("apps/web/src/features/exchange/state/exchangeWorkspaceTypes.ts");
for (const sort of [
  "recommended",
  "relevance",
  "nearest",
  "newest",
  "updated",
  "deadline_soonest",
  "deadline_latest",
  "local_first",
  "capability_match",
  "budget_high",
  "budget_low",
]) {
  if (workspaceTypes.includes(`\"${sort}\"`)) pass(`workspace sort: ${sort}`);
  else fail(`workspace sort missing: ${sort}`);
}

const urlState = await text("apps/web/src/features/exchange/state/exchangeUrlState.ts");
for (const parameter of [
  "placeLat",
  "placeLng",
  "radius",
  "west",
  "south",
  "east",
  "north",
  "personalized",
  "opportunityType",
  "budgetMin",
  "budgetMax",
]) {
  if (urlState.includes(`\"${parameter}\"`)) pass(`URL state includes ${parameter}`);
  else fail(`URL state missing ${parameter}`);
}

const opportunitiesView = await text("apps/web/src/features/exchange/views/ExchangeOpportunitiesView.tsx");
if (opportunitiesView.includes("Search this map area")) pass("contextual map-area search exists");
else fail("contextual map-area search missing");
if (opportunitiesView.includes("Matching opportunities have no authoritative coordinates")) pass("no-fabricated-coordinate state exists");
else fail("no-fabricated-coordinate state missing");
if (opportunitiesView.match(/openMobileFilter/g)?.length === 1) pass("one Opportunities mobile filter entry point");
else fail("unexpected duplicate Opportunities mobile filter entry point");

const commandBar = await text("apps/web/src/features/exchange/components/ExchangeCommandBar.tsx");
if (commandBar.includes("OpportunityLocationSearch")) pass("location search is integrated into command bar");
else fail("location search not integrated into command bar");
if (commandBar.includes("aria-controls=\"exchange-filter-drawer\"")) pass("filter button identifies drawer");
else fail("filter button does not identify drawer");

const card = await text("apps/web/src/features/exchange/components/ExchangeRfxCard.tsx");
for (const behavior of ["Remove saved opportunity", "Share", "Team up", "Closing soon"]) {
  if (card.includes(behavior)) pass(`card behavior: ${behavior}`);
  else fail(`card behavior missing: ${behavior}`);
}

const governance = await text("apps/functions/src/opportunityGovernance.ts");
for (const boundary of [
  "immutable: true",
  "idempotencyRef",
  "writeExchangeAudit",
  "externalDeliveryEnabled: false",
  "visibility: \"private\"",
]) {
  if (governance.includes(boundary)) pass(`governance boundary: ${boundary}`);
  else fail(`governance boundary missing: ${boundary}`);
}

const filesToScan = requiredFiles.filter((path) => /\.(?:ts|tsx|md)$/.test(path));
const secretPatterns = [
  /sk_live_[A-Za-z0-9]+/,
  /sk_test_[A-Za-z0-9]+/,
  /pk_live_[A-Za-z0-9]+/,
  /pk_test_[A-Za-z0-9]+/,
  /AIza[0-9A-Za-z_-]{25,}/,
  /pk\.[A-Za-z0-9_-]{20,}/,
];
for (const path of filesToScan) {
  const content = await text(path);
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) fail(`possible committed credential in ${path}`);
  }
}
if (!failures.some((failure) => failure.includes("credential"))) pass("no obvious credential literals in discovery files");

for (const line of checks) console.log(line);
for (const line of failures) console.error(line);
console.log(`\n${checks.length} checks passed; ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
