import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  projectApprovedPublicOrganization,
  projectPrivateOrganization,
  resolveOrganizationPerspectiveModel,
} from "./organizationPerspective";

test("actor and external subject resolve to public claimed without private actions", () => {
  const result = resolveOrganizationPerspectiveModel({
    actorValid: true,
    actorOrganizationId: "actor-org",
    actorName: "Actor",
    actorMembershipRole: "owner",
    subjectOrganizationId: "subject-org",
    subjectName: "Subject",
    subjectAvailable: true,
    subjectMembershipRole: null,
    subjectClaimStatus: "claimed",
    subjectResourceProviderApproved: false,
    subjectIssuerApproved: false,
    relationshipExists: false,
    relationshipDisclosurePermitted: false,
    relationshipTrusted: false,
    saved: false,
    mode: "opportunities",
  });
  assert.equal(result.contextType, "external_claimed");
  assert.equal(result.projectionLevel, "public_claimed");
  assert.ok(result.allowedActions.includes("initiate_teaming"));
  assert.equal(result.allowedActions.includes("view_private_organization"), false);
  assert.equal(result.heading, "Opportunities for Actor related to Subject.");
});

test("resources keep a non-provider subject only as context", () => {
  const result = resolveOrganizationPerspectiveModel({
    actorValid: true,
    actorOrganizationId: "actor-org",
    actorName: "Actor",
    actorMembershipRole: "member",
    subjectOrganizationId: "subject-org",
    subjectName: "Subject",
    subjectAvailable: true,
    subjectMembershipRole: null,
    subjectClaimStatus: "claimed",
    subjectResourceProviderApproved: false,
    subjectIssuerApproved: false,
    relationshipExists: false,
    relationshipDisclosurePermitted: false,
    relationshipTrusted: false,
    saved: false,
    mode: "resources",
  });
  assert.equal(result.isModeResultEligible, false);
  assert.equal(result.contextMarkerOnly, true);
  assert.equal(result.allowedActions.includes("view_public_resources"), false);
});

test("resource providers receive only resource-public projection", () => {
  const result = resolveOrganizationPerspectiveModel({
    actorValid: true,
    actorOrganizationId: "actor-org",
    actorName: "Actor",
    actorMembershipRole: "admin",
    subjectOrganizationId: "provider-org",
    subjectName: "Provider",
    subjectAvailable: true,
    subjectMembershipRole: null,
    subjectClaimStatus: "claimed",
    subjectResourceProviderApproved: true,
    subjectIssuerApproved: false,
    relationshipExists: true,
    relationshipDisclosurePermitted: true,
    relationshipTrusted: true,
    saved: false,
    mode: "resources",
  });
  assert.equal(result.contextType, "resource_provider");
  assert.equal(result.projectionLevel, "resource_public");
  assert.equal(result.isModeResultEligible, true);
});

test("public projection requires explicit publication and coordinate approvals", () => {
  const base = {
    name: "Public Organization",
    normalizedName: "public organization",
    status: "active",
    publicationApproved: true,
    claimStatus: "claimed",
    latitude: 36.9,
    longitude: -76.7,
    coordinateConfidence: "verified",
    ownerUid: "private-owner",
    sourceIds: { duns: "private" },
  };
  const withoutCoordinateApproval = projectApprovedPublicOrganization("public-org", base);
  assert.ok(withoutCoordinateApproval);
  assert.equal(withoutCoordinateApproval?.latitude, undefined);
  assert.equal(withoutCoordinateApproval?.ownerUid, undefined);
  assert.equal(withoutCoordinateApproval?.sourceIds, undefined);

  const approved = projectApprovedPublicOrganization("public-org", {
    ...base,
    coordinatePublicationApproved: true,
  });
  assert.equal(approved?.latitude, 36.9);
  assert.equal(approved?.longitude, -76.7);
  assert.equal(approved?.coordinatePublicationApproved, true);

  assert.equal(projectApprovedPublicOrganization("hidden-org", {
    ...base,
    publicationApproved: false,
  }), null);
});

test("private role projections remain final allowlists", () => {
  const source = {
    id: "private-org",
    name: "Private Organization",
    status: "active",
    publicationApproved: false,
    ownerUid: "owner-uid",
    billingEmail: "billing@example.test",
    addressLine1: "100 Private Way",
    sourceIds: { secret: "never" },
    verificationDocuments: ["never"],
  };
  const member = projectPrivateOrganization("private-org", source, "member");
  assert.equal(member.ownerUid, undefined);
  assert.equal(member.billingEmail, undefined);
  assert.equal(member.addressLine1, undefined);
  assert.equal(member.sourceIds, undefined);
  assert.equal(member.verificationDocuments, undefined);

  const owner = projectPrivateOrganization("private-org", source, "owner");
  assert.equal(owner.ownerUid, "owner-uid");
  assert.equal(owner.billingEmail, "billing@example.test");
  assert.equal(owner.addressLine1, "100 Private Way");
  assert.equal(owner.sourceIds, undefined);
});
