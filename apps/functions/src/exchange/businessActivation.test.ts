import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveBusinessActivationMarkerState,
  derivePublicBusinessMarkerState,
} from "./businessActivation";

const confirmed = {
  status: "active",
  locationType: "headquarters",
  physicalAddress: { line1: "1 Main", locality: "Smithfield", administrativeArea: "VA", countryCode: "US" },
  geocode: { latitude: 36.98, longitude: -76.63, confirmedAt: 1 },
  coordinatePublicationApproved: false,
};

test("activation marker derivation distinguishes authority, claims, private, and public visibility", () => {
  assert.equal(deriveBusinessActivationMarkerState({ authorized: false }), "unauthorized");
  assert.equal(deriveBusinessActivationMarkerState({ authorized: false, claimPending: true }), "claim_pending");
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    organization: { publicationStatus: "draft" },
    location: confirmed,
  }), "private_actor_visible");
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    organization: { publicationStatus: "approved" },
    location: { ...confirmed, coordinatePublicationApproved: true },
    publicLocationExists: true,
  }), "private_and_public_visible");
});

test("public marker derivation exposes actionable publication blockers", () => {
  assert.equal(derivePublicBusinessMarkerState({
    organization: { publicationStatus: "draft" },
    location: confirmed,
  }), "blocked_organization_not_published");
  assert.equal(derivePublicBusinessMarkerState({
    organization: { publicationStatus: "approved" },
    location: confirmed,
  }), "blocked_coordinate_not_approved");
  assert.equal(derivePublicBusinessMarkerState({
    organization: { publicationStatus: "approved" },
    location: { ...confirmed, privateHome: true },
  }), "private_home_suppressed");
});

test("activation marker derivation rejects incomplete or excluded establishments", () => {
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    location: { status: "active", locationType: "headquarters" },
  }), "blocked_missing_address");
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    location: { ...confirmed, geocode: undefined },
  }), "blocked_missing_geocode");
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    location: { status: "active", locationType: "mailing_only" },
  }), "mailing_only");
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    location: { status: "active", locationType: "virtual" },
  }), "virtual_location");
  assert.equal(deriveBusinessActivationMarkerState({
    authorized: true,
    location: { ...confirmed, privateHome: true },
  }), "private_home_suppressed");
});
