import assert from "node:assert/strict";
import test from "node:test";
import { mergeOrganizationOnboardingSuggestions } from "./profileBusinessMigration";

test("legacy business fields become suggestions without replacing prior owner-reviewed values silently", () => {
  const result = mergeOrganizationOnboardingSuggestions(
    { organizationOnboardingSuggestions: { businessName: "Owner-reviewed name", uei: "OLD" } },
    { city: "Smithfield", website: "https://example.com", displayName: "Person Name" },
  );
  assert.deepEqual(result, {
    businessName: "Owner-reviewed name", uei: "OLD", city: "Smithfield", website: "https://example.com",
  });
  assert.equal("displayName" in result, false);
});

test("null compatibility fields do not erase an existing suggestion", () => {
  assert.deepEqual(
    mergeOrganizationOnboardingSuggestions({ organizationOnboardingSuggestions: { city: "Smithfield" } }, { city: null }),
    { city: "Smithfield" },
  );
});
