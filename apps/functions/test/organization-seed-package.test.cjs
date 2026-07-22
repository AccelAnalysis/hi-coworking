"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createReviewPacket, exportApprovedRows } = require("../scripts/organization-seed-lifecycle.cjs");
const { validate } = require("../scripts/import-organizations.cjs");

function candidate() {
  return {
    id: "seed_org_1", name: "Seed Example", normalizedName: "seed example",
    sources: ["test_source"], addressLine1: "1 Main St", city: "Smithfield", state: "VA",
    postalCode: "23430", territoryFips: "51093", status: "active", publicationApproved: true,
  };
}

test("preparation creates a governed organization package with zero inferred approvals", () => {
  const packet = createReviewPacket([candidate()]);
  assert.equal(packet.report.humanApproved, 0);
  assert.equal(packet.rows[0].seedPackageVersion, 2);
  assert.equal(packet.rows[0].organizationDecision, "defer");
  assert.equal(packet.rows[0].establishmentDecisions[0].decision, "defer_location");
  assert.deepEqual(packet.rows[0].contactDecisions, []);
});

test("approved export binds organization, establishments, contacts, routes, and a package hash", () => {
  const row = createReviewPacket([candidate()]).rows[0];
  row.reviewStatus = "approved";
  row.reviewedBy = "human_reviewer";
  row.reviewedAt = 1_700_000_000_000;
  row.organizationDecision = "approve_organization";
  row.establishmentDecisions[0] = {
    ...row.establishmentDecisions[0], decision: "approve_establishment",
    isPrimary: true, isHeadquarters: true,
    addressPublicationApproved: false, coordinatePublicationApproved: false,
  };
  const exported = exportApprovedRows([row]);
  assert.equal(exported.rows[0].approvedExportVersion, 2);
  assert.equal(exported.rows[0].establishments.length, 1);
  assert.equal(exported.rows[0].establishments[0].isPrimary, true);
  assert.equal(typeof exported.rows[0].seedPackageHash, "string");
  assert.deepEqual(validate(exported.rows[0], false), []);
});
