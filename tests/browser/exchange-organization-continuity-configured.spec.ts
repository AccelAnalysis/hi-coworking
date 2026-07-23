import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const enabled = process.env.EXCHANGE_DEV_ORGANIZATION_CONTINUITY === "true";
const PROJECT_ID = "hi-coworking-plat";
const TEST_PURPOSE = "configured-organization-continuity-acceptance";
const axePath = resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
const evidenceDirectory = resolve(
  process.cwd(),
  "docs/exchange/evidence/business-registration-map-activation",
);

type Fixture = {
  ownerUid: string;
  externalOwnerUid: string;
  ownerEmail: string;
  ownerPassword: string;
  actorOrganizationId: string;
  subjectOrganizationId: string;
  actorName: string;
  subjectName: string;
  actorHeadquartersId: string;
  subjectHeadquartersId: string;
  subjectBranchId: string;
  subjectMailingId: string;
  subjectHomeId: string;
  subjectPublicGeneralContactId: string;
  subjectPrivateReferralContactId: string;
  subjectReferralRouteId: string;
  createdAt: number;
};

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/exchange(?:\?|$)/, { timeout: 40_000 });
  await expect(page.locator('[data-exchange-map-host="persistent"]')).toHaveCount(1);
  await expect(page.getByLabel("Working as organization")).toBeVisible();
  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) <= 640) {
    await expect(page).toHaveURL(/[?&]mode=map(?:&|$)/);
  }
}

async function gotoStable(page: import("@playwright/test").Page, path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.split("?")[0].replaceAll("/", "\\/")}(?:\\?|$)`));
      return;
    } catch (error) {
      lastError = error;
      const message = String(error).toLowerCase();
      if (!message.includes("interrupted by another navigation") && !message.includes("frame load interrupted")) throw error;
    }
  }
  throw lastError;
}

async function createFixture(projectName: string): Promise<Fixture> {
  const appName = `configured-org-continuity-${projectName}-${crypto.randomUUID()}`;
  const app = getApps().find((candidate) => candidate.name === appName)
    ?? initializeApp({ projectId: PROJECT_ID }, appName);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const ownerEmail = `codex-org-continuity-owner-${suffix}@example.test`;
  const externalEmail = `codex-org-continuity-external-${suffix}@example.test`;
  const ownerPassword = `Codex!${crypto.randomUUID()}9a`;
  const externalPassword = `Codex!${crypto.randomUUID()}9b`;
  const actorName = `Codex Actor Organization ${suffix}`;
  const subjectName = `Codex External Organization ${suffix}`;
  const actorOrganizationId = `codex-org-actor-${suffix}`;
  const subjectOrganizationId = `codex-org-subject-${suffix}`;
  const actorHeadquartersId = `${actorOrganizationId}-hq`;
  const subjectHeadquartersId = `${subjectOrganizationId}-hq`;
  const subjectBranchId = `${subjectOrganizationId}-branch`;
  const subjectMailingId = `${subjectOrganizationId}-mailing`;
  const subjectHomeId = `${subjectOrganizationId}-home`;
  const subjectPublicGeneralContactId = `${subjectOrganizationId}-public-general`;
  const subjectPrivateReferralContactId = `${subjectOrganizationId}-private-referral`;
  const subjectReferralRouteId = `${subjectOrganizationId}-referral-route`;
  const createdAt = Date.now();
  const owner = await auth.createUser({
    email: ownerEmail,
    password: ownerPassword,
    displayName: `Codex Organization Owner ${suffix}`,
    emailVerified: true,
  });
  const externalOwner = await auth.createUser({
    email: externalEmail,
    password: externalPassword,
    displayName: `Codex External Owner ${suffix}`,
    emailVerified: true,
  });
  await Promise.all([
    auth.setCustomUserClaims(owner.uid, {
      role: "member",
      developmentTestAccount: true,
      developmentTestPurpose: TEST_PURPOSE,
    }),
    auth.setCustomUserClaims(externalOwner.uid, {
      role: "member",
      developmentTestAccount: true,
      developmentTestPurpose: TEST_PURPOSE,
    }),
  ]);
  const ownerPermissions = [
    "view_exchange",
    "edit_profile",
    "respond_to_opportunities",
    "manage_referrals",
    "spend_credits",
    "purchase_credits",
    "manage_billing",
    "manage_members",
  ];
  const actorPrivate = {
    id: actorOrganizationId,
    schemaVersion: 2,
    name: actorName,
    normalizedName: actorName.toLowerCase(),
    searchTokens: ["codex", "actor", "construction"],
    slug: actorOrganizationId,
    city: "Smithfield",
    county: "Isle of Wight",
    state: "VA",
    territoryFips: "51093",
    ownerUid: owner.uid,
    status: "active",
    claimStatus: "claimed",
    verificationStatus: "unverified",
    resourceProviderStatus: "none",
    issuerStatus: "none",
    publicationApproved: true,
    addressPublicationApproved: false,
    coordinatePublicationApproved: true,
    latitude: 36.9824,
    longitude: -76.6311,
    capabilityKeywords: ["commercial construction"],
    industries: ["Construction"],
    internalCapabilityGaps: ["synthetic private actor gap"],
    billingEmail: "private-actor-billing@example.test",
    developmentTestPurpose: TEST_PURPOSE,
    createdAt,
    updatedAt: createdAt,
    primaryLocationId: actorHeadquartersId,
    headquartersLocationId: actorHeadquartersId,
    publicLocationCount: 1,
  };
  const subjectPrivate = {
    id: subjectOrganizationId,
    schemaVersion: 2,
    name: subjectName,
    normalizedName: subjectName.toLowerCase(),
    searchTokens: ["codex", "external", "engineering"],
    slug: subjectOrganizationId,
    city: "Windsor",
    county: "Isle of Wight",
    state: "VA",
    territoryFips: "51093",
    ownerUid: externalOwner.uid,
    status: "active",
    claimStatus: "claimed",
    verificationStatus: "unverified",
    resourceProviderStatus: "none",
    issuerStatus: "none",
    publicationApproved: true,
    addressPublicationApproved: false,
    coordinatePublicationApproved: true,
    latitude: 36.8085,
    longitude: -76.7441,
    capabilityKeywords: ["civil engineering"],
    industries: ["Engineering"],
    internalCapabilityGaps: ["never-return-external-private-gap"],
    billingEmail: "never-return-external-billing@example.test",
    administrativeNotes: "never-return-external-admin-notes",
    developmentTestPurpose: TEST_PURPOSE,
    createdAt,
    updatedAt: createdAt,
    primaryLocationId: subjectHeadquartersId,
    headquartersLocationId: subjectHeadquartersId,
    publicLocationCount: 4,
    primaryPublicLocation: {
      id: subjectHeadquartersId, name: "Smithfield Headquarters", city: "Smithfield",
      county: "Isle of Wight", administrativeArea: "VA", coordinatePublicationApproved: true,
    },
  };
  const publicProjection = (source: typeof actorPrivate) => ({
    id: source.id,
    schemaVersion: 2,
    name: source.name,
    normalizedName: source.normalizedName,
    searchTokens: source.searchTokens,
    slug: source.slug,
    city: source.city,
    county: source.county,
    state: source.state,
    territoryFips: source.territoryFips,
    status: "active",
    claimStatus: "claimed",
    verificationStatus: "unverified",
    resourceProviderStatus: "not_provider",
    resourceCategories: [],
    issuerStatus: "not_issuer",
    acceptsReferrals: true,
    publicContactAvailable: false,
    publicationApproved: true,
    addressPublicationApproved: false,
    coordinatePublicationApproved: true,
    latitude: source.latitude,
    longitude: source.longitude,
    capabilityKeywords: source.capabilityKeywords,
    industries: source.industries,
    naicsCodes: [],
    certifications: [],
    description: "Synthetic public projection for configured-development browser acceptance.",
    website: "",
    developmentTestPurpose: TEST_PURPOSE,
    createdAt,
    updatedAt: createdAt,
    publicLocationCount: source.id === subjectOrganizationId ? 4 : 1,
    ...(source.id === subjectOrganizationId ? { primaryPublicLocation: subjectPrivate.primaryPublicLocation } : {}),
  });
  const address = (line1: string, locality: string) => ({
    line1, locality, administrativeArea: "VA", postalCode: "23430", countryCode: "US", county: "Isle of Wight",
  });
  const geocode = (line1: string, latitude: number, longitude: number) => ({
    provider: "configured_fixture", normalizedAddress: `${line1}, Smithfield, VA 23430`, latitude, longitude,
    precision: "address", confidence: "high", source: "administrator_confirmed", geocodedAt: createdAt,
    confirmedByUid: owner.uid, confirmedAt: createdAt,
  });
  const privateLocation = (input: Record<string, unknown>) => ({
    organizationId: subjectOrganizationId, status: "active", addressPublicationApproved: false,
    coordinatePublicationApproved: false, publicContactAvailable: false, privateHome: false,
    createdBy: owner.uid, createdAt, updatedAt: createdAt, version: 1, recordVersion: 1,
    ...input,
  });
  const publicLocation = (input: Record<string, unknown>) => ({
    organizationId: subjectOrganizationId, addressPublicationApproved: false, coordinatePublicationApproved: false,
    publicContactAvailable: false, version: 1, updatedAt: createdAt, ...input,
  });
  const batch = db.batch();
  for (const [uid, email, displayName] of [
    [owner.uid, ownerEmail, owner.displayName],
    [externalOwner.uid, externalEmail, externalOwner.displayName],
  ] as const) {
    batch.set(db.collection("users").doc(uid), {
      uid,
      email,
      displayName,
      role: "member",
      membershipStatus: "none",
      developmentTestPurpose: TEST_PURPOSE,
      createdAt,
      updatedAt: createdAt,
    });
  }
  batch.set(db.collection("profiles").doc(owner.uid), {
    uid: owner.uid,
    displayName: owner.displayName,
    businessName: "Compatibility-only owner suggestion",
    published: false,
    profileSchemaVersion: 4,
    profileVersion: 0,
    enrichmentProposals: {
      [`configured-enrichment-${suffix}`]: {
        status: "proposed",
        provider: "configured_external_provider",
        proposedFields: { businessName: "Never overwrite the authoritative actor name" },
        proposedAddresses: [{
          id: `configured-address-${suffix}`,
          address: {
            line1: "4600 Silver Hill Road",
            locality: "Washington",
            administrativeArea: "DC",
            postalCode: "20233",
            countryCode: "US",
          },
        }],
        proposedContacts: [{
          id: `configured-contact-${suffix}`,
          type: "email",
          value: `configured-proposal-${suffix}@example.test`,
          label: "External general contact",
        }],
        createdAt,
      },
    },
    createdAt,
    updatedAt: createdAt,
  });
  batch.set(db.collection("profiles").doc(externalOwner.uid), {
    uid: externalOwner.uid,
    displayName: externalOwner.displayName,
    published: false,
    profileSchemaVersion: 4,
    profileVersion: 0,
    createdAt,
    updatedAt: createdAt,
  });
  batch.set(db.collection("orgs").doc(actorOrganizationId), actorPrivate);
  batch.set(db.collection("orgs").doc(subjectOrganizationId), subjectPrivate);
  batch.set(db.collection("publicOrganizations").doc(actorOrganizationId), publicProjection(actorPrivate));
  batch.set(db.collection("publicOrganizations").doc(subjectOrganizationId), publicProjection(subjectPrivate));
  batch.set(db.collection("orgMembers").doc(`${actorOrganizationId}_${owner.uid}`), {
    id: `${actorOrganizationId}_${owner.uid}`,
    orgId: actorOrganizationId,
    uid: owner.uid,
    role: "owner",
    status: "active",
    permissions: ownerPermissions,
    developmentTestPurpose: TEST_PURPOSE,
    joinedAt: createdAt,
    updatedAt: createdAt,
  });
  batch.set(db.collection("orgMembers").doc(`${subjectOrganizationId}_${externalOwner.uid}`), {
    id: `${subjectOrganizationId}_${externalOwner.uid}`,
    orgId: subjectOrganizationId,
    uid: externalOwner.uid,
    role: "owner",
    status: "active",
    permissions: ownerPermissions,
    developmentTestPurpose: TEST_PURPOSE,
    joinedAt: createdAt,
    updatedAt: createdAt,
  });
  batch.set(db.collection("exchangeWorkspacePreferences").doc(owner.uid), {
    uid: owner.uid,
    actorOrganizationId,
    developmentTestPurpose: TEST_PURPOSE,
    updatedAt: createdAt,
  });
  batch.set(db.collection("organizationLocations").doc(actorHeadquartersId), {
    ...privateLocation({ id: actorHeadquartersId, organizationId: actorOrganizationId, name: "Actor Headquarters",
      locationType: "headquarters", isHeadquarters: true, isPrimary: true, physicalAddress: address("100 Main Street", "Smithfield"),
      geocode: geocode("100 Main Street", 36.9824, -76.6311), coordinatePublicationApproved: true }),
  });
  batch.set(db.collection("publicOrganizationLocations").doc(actorHeadquartersId), publicLocation({
    id: actorHeadquartersId, organizationId: actorOrganizationId, name: "Actor Headquarters", locationType: "headquarters",
    isHeadquarters: true, isPrimary: true, city: "Smithfield", county: "Isle of Wight", administrativeArea: "VA",
    countryCode: "US", coordinatePublicationApproved: true, latitude: 36.9824, longitude: -76.6311,
    coordinatePrecision: "address",
  }));
  batch.set(db.collection("organizationLocations").doc(subjectHeadquartersId), privateLocation({
    id: subjectHeadquartersId, name: "Smithfield Headquarters", locationType: "headquarters", isHeadquarters: true,
    isPrimary: true, physicalAddress: address("319 Main Street", "Smithfield"),
    geocode: geocode("319 Main Street", 36.9827, -76.6320), coordinatePublicationApproved: true,
  }));
  batch.set(db.collection("organizationLocations").doc(subjectBranchId), privateLocation({
    id: subjectBranchId, name: "Windsor Branch", locationType: "branch", isHeadquarters: false,
    isPrimary: false, physicalAddress: address("70 East Windsor Boulevard", "Windsor"),
    serviceArea: { city: "Windsor", county: "Isle of Wight", region: "VA", countryCode: "US" },
    geocode: geocode("70 East Windsor Boulevard", 36.8085, -76.7441), coordinatePublicationApproved: true,
  }));
  batch.set(db.collection("organizationLocations").doc(subjectMailingId), privateLocation({
    id: subjectMailingId, name: "Mail processing", locationType: "mailing_only", isHeadquarters: false,
    isPrimary: false, mailingAddress: address("319 Main Street", "Smithfield"),
  }));
  batch.set(db.collection("organizationLocations").doc(subjectHomeId), privateLocation({
    id: subjectHomeId, name: "Owner private home", locationType: "office", isHeadquarters: false,
    isPrimary: false, privateHome: true, physicalAddress: address("1 Private Lane", "Smithfield"),
    serviceArea: { city: "Smithfield", county: "Isle of Wight", region: "VA", countryCode: "US" },
    geocode: geocode("1 Private Lane", 36.95, -76.65),
  }));
  for (const projection of [
    publicLocation({ id: subjectHeadquartersId, name: "Smithfield Headquarters", locationType: "headquarters", isHeadquarters: true,
      isPrimary: true, city: "Smithfield", county: "Isle of Wight", administrativeArea: "VA", countryCode: "US",
      coordinatePublicationApproved: true, latitude: 36.9827, longitude: -76.6320, coordinatePrecision: "address" }),
    publicLocation({ id: subjectBranchId, name: "Windsor Branch", locationType: "branch", isHeadquarters: false,
      isPrimary: false, city: "Windsor", county: "Isle of Wight", administrativeArea: "VA", countryCode: "US",
      coordinatePublicationApproved: true, latitude: 36.8085, longitude: -76.7441, coordinatePrecision: "address" }),
    publicLocation({ id: subjectMailingId, name: "Mail processing", locationType: "mailing_only", isHeadquarters: false, isPrimary: false }),
    publicLocation({ id: subjectHomeId, name: "Smithfield service area", locationType: "service_location", isHeadquarters: false,
      isPrimary: false, city: "Smithfield", county: "Isle of Wight", administrativeArea: "VA", countryCode: "US" }),
  ]) batch.set(db.collection("publicOrganizationLocations").doc(String(projection.id)), projection);
  batch.set(db.collection("organizationContactPoints").doc(subjectPublicGeneralContactId), {
    id: subjectPublicGeneralContactId, organizationId: subjectOrganizationId, type: "email", purposes: ["general"],
    normalizedValue: "public-general@example.test", displayValue: "public-general@example.test", verificationStatus: "verified",
    visibility: "public", publicationStatus: "approved", consentAuthorityBasis: "configured_fixture", status: "active",
    createdBy: externalOwner.uid, createdAt, updatedAt: createdAt, version: 1, recordVersion: 1,
  });
  batch.set(db.collection("publicOrganizationContactPoints").doc(subjectPublicGeneralContactId), {
    id: subjectPublicGeneralContactId, organizationId: subjectOrganizationId, type: "email", purposes: ["general"],
    displayValue: "public-general@example.test", visibility: "public", publicationStatus: "approved", status: "active",
    version: 1, updatedAt: createdAt,
  });
  batch.set(db.collection("organizationContactPoints").doc(subjectPrivateReferralContactId), {
    id: subjectPrivateReferralContactId, organizationId: subjectOrganizationId, type: "email", purposes: ["referrals"],
    normalizedValue: "never-return-private-referral@example.test", displayValue: "Private referral intake",
    verificationStatus: "verified", visibility: "private_operational", publicationStatus: "draft",
    consentAuthorityBasis: "configured_fixture", status: "active", createdBy: externalOwner.uid,
    createdAt, updatedAt: createdAt, version: 1, recordVersion: 1,
  });
  batch.set(db.collection("organizationCommunicationRoutes").doc(subjectReferralRouteId), {
    id: subjectReferralRouteId, organizationId: subjectOrganizationId, purpose: "referrals",
    primaryContactPointIds: [subjectPrivateReferralContactId], fallbackContactPointIds: [], fallbackMemberRoles: ["owner"],
    inAppEnabled: true, emailEnabled: true, phoneEnabled: false, status: "active", createdBy: externalOwner.uid,
    createdAt, updatedAt: createdAt, version: 1, recordVersion: 1,
  });
  await batch.commit();
  return {
    ownerUid: owner.uid,
    externalOwnerUid: externalOwner.uid,
    ownerEmail,
    ownerPassword,
    actorOrganizationId,
    subjectOrganizationId,
    actorName,
    subjectName,
    actorHeadquartersId,
    subjectHeadquartersId,
    subjectBranchId,
    subjectMailingId,
    subjectHomeId,
    subjectPublicGeneralContactId,
    subjectPrivateReferralContactId,
    subjectReferralRouteId,
    createdAt,
  };
}

async function deleteQueryDocuments(
  db: ReturnType<typeof getFirestore>,
  collection: string,
  field: string,
  values: readonly string[],
) {
  for (const value of values) {
    const snapshot = await db.collection(collection).where(field, "==", value).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
}

async function cleanupFixture(fixture: Fixture, projectName: string) {
  const appName = `configured-org-continuity-cleanup-${projectName}-${crypto.randomUUID()}`;
  const app = initializeApp({ projectId: PROJECT_ID }, appName);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (Date.now() - fixture.createdAt > 60 * 60 * 1_000) {
    throw new Error("Refusing cleanup because the configured fixture is older than one hour");
  }
  const [owner, externalOwner, actor, subject] = await Promise.all([
    auth.getUser(fixture.ownerUid),
    auth.getUser(fixture.externalOwnerUid),
    db.collection("orgs").doc(fixture.actorOrganizationId).get(),
    db.collection("orgs").doc(fixture.subjectOrganizationId).get(),
  ]);
  const safe = [owner, externalOwner].every((record) => (
    record.email?.startsWith("codex-org-continuity-")
    && record.email.endsWith("@example.test")
    && record.customClaims?.developmentTestPurpose === TEST_PURPOSE
  )) && [actor, subject].every((snapshot) => (
    snapshot.id.startsWith("codex-org-")
    && snapshot.data()?.developmentTestPurpose === TEST_PURPOSE
  ));
  if (!safe) throw new Error("Refusing cleanup because a configured fixture marker did not match");

  // Auth first prevents any authenticated repair listener from recreating data.
  await auth.deleteUsers([fixture.ownerUid, fixture.externalOwnerUid]);
  await Promise.all([
    deleteQueryDocuments(db, "exchangeAudit", "actorUid", [fixture.ownerUid, fixture.externalOwnerUid]),
    deleteQueryDocuments(db, "opportunityRecentSearches", "ownerUid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "opportunitySavedSearches", "ownerUid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "organizationContactRequests", "requestedByUid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "organizationIntroductionRequests", "requestedByUid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "organizationRouteDeliveries", "actorUid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "notifications", "uid", [fixture.ownerUid, fixture.externalOwnerUid]),
    deleteQueryDocuments(db, "organizationGeocodeRateLimits", "uid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "organizationGeocodeCandidateSessions", "uid", [fixture.ownerUid]),
    deleteQueryDocuments(db, "organizationLocations", "organizationId", [fixture.actorOrganizationId, fixture.subjectOrganizationId]),
    deleteQueryDocuments(db, "publicOrganizationLocations", "organizationId", [fixture.actorOrganizationId, fixture.subjectOrganizationId]),
    deleteQueryDocuments(db, "organizationContactPoints", "organizationId", [fixture.actorOrganizationId, fixture.subjectOrganizationId]),
    deleteQueryDocuments(db, "publicOrganizationContactPoints", "organizationId", [fixture.actorOrganizationId, fixture.subjectOrganizationId]),
    deleteQueryDocuments(db, "organizationCommunicationRoutes", "organizationId", [fixture.actorOrganizationId, fixture.subjectOrganizationId]),
  ]);
  const batch = db.batch();
  for (const uid of [fixture.ownerUid, fixture.externalOwnerUid]) {
    batch.delete(db.collection("users").doc(uid));
    batch.delete(db.collection("profiles").doc(uid));
    batch.delete(db.collection("publicProfiles").doc(uid));
  }
  batch.delete(db.collection("exchangeWorkspacePreferences").doc(fixture.ownerUid));
  batch.delete(db.collection("orgMembers").doc(`${fixture.actorOrganizationId}_${fixture.ownerUid}`));
  batch.delete(db.collection("orgMembers").doc(`${fixture.subjectOrganizationId}_${fixture.externalOwnerUid}`));
  for (const organizationId of [fixture.actorOrganizationId, fixture.subjectOrganizationId]) {
    batch.delete(db.collection("publicOrganizations").doc(organizationId));
    batch.delete(db.collection("orgs").doc(organizationId));
  }
  for (const locationId of [fixture.actorHeadquartersId, fixture.subjectHeadquartersId, fixture.subjectBranchId, fixture.subjectMailingId, fixture.subjectHomeId]) {
    batch.delete(db.collection("organizationLocations").doc(locationId));
    batch.delete(db.collection("publicOrganizationLocations").doc(locationId));
  }
  for (const contactId of [fixture.subjectPublicGeneralContactId, fixture.subjectPrivateReferralContactId]) {
    batch.delete(db.collection("organizationContactPoints").doc(contactId));
    batch.delete(db.collection("publicOrganizationContactPoints").doc(contactId));
  }
  batch.delete(db.collection("organizationCommunicationRoutes").doc(fixture.subjectReferralRouteId));
  await batch.commit();
}

async function revokeActorMembership(fixture: Fixture, projectName: string) {
  const app = initializeApp(
    { projectId: PROJECT_ID },
    `configured-org-continuity-revoke-${projectName}-${crypto.randomUUID()}`,
  );
  const db = getFirestore(app);
  const reference = db.collection("orgMembers")
    .doc(`${fixture.actorOrganizationId}_${fixture.ownerUid}`);
  const snapshot = await reference.get();
  if (
    !snapshot.exists
    || snapshot.data()?.developmentTestPurpose !== TEST_PURPOSE
    || snapshot.data()?.status !== "active"
  ) {
    throw new Error("Refusing membership revocation because the synthetic marker did not match");
  }
  await reference.update({ status: "removed", updatedAt: Date.now() });
}

test("configured development preserves external organization context through every mode", async ({ page }, testInfo) => {
  test.skip(!enabled, "Set EXCHANGE_DEV_ORGANIZATION_CONTINUITY=true for the guarded configured-development journey.");
  const fixture = await createFixture(testInfo.project.name);
  const perspectiveResponses: unknown[] = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/exchange_resolveOrganizationPerspective") || response.status() !== 200) return;
    try {
      perspectiveResponses.push(await response.json());
    } catch {
      // A failed diagnostic parse must not expose request credentials or block cleanup.
    }
  });

  try {
    await login(page, fixture.ownerEmail, fixture.ownerPassword);
    await gotoStable(page, `/org/settings?id=${fixture.actorOrganizationId}&tab=establishments`);
    await expect(page.getByRole("heading", { name: fixture.actorName })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Establishments" })).toBeVisible();
    await expect(page.getByText("Actor Headquarters", { exact: true })).toBeVisible();
    await expect(page.getByText("Address private", { exact: true })).toBeVisible();
    const settingsOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(settingsOverflow.scrollWidth).toBeLessThanOrEqual(settingsOverflow.clientWidth + 1);

    if (testInfo.project.name === "configured-development-chromium") {
      const headquartersCard = page.getByRole("listitem").filter({ hasText: "Actor Headquarters" });
      await headquartersCard.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Address line 1").fill("4600 Silver Hill Road");
      await page.getByLabel("City").fill("Washington");
      await page.getByLabel("State / region").fill("DC");
      await page.getByLabel("Postal code").fill("20233");
      await page.getByLabel("County").fill("Prince George's");
      const geocodeResponse = page.waitForResponse((response) => response.url().includes("/exchange_searchOrganizationGeocodes") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Search standardized addresses" }).click();
      const geocodeResult = await geocodeResponse;
      expect(geocodeResult.status(), JSON.stringify(await geocodeResult.json())).toBe(200);
      const candidate = page.getByRole("radio", { name: /4600 SILVER HILL/i }).first();
      await expect(candidate).toBeVisible({ timeout: 30_000 });
      await candidate.focus();
      await candidate.press("Space");
      await expect(page.getByRole("img", { name: /Map coordinate preview/ })).toBeVisible();
      await page.getByLabel("Publish street address").uncheck();
      await page.getByLabel("Publish exact map coordinate").check();
      await page.getByRole("button", { name: "Save establishment" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Establishment updated." })).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { name: fixture.actorName })).toBeVisible({ timeout: 60_000 });
      const persistedHeadquarters = page.getByRole("listitem").filter({ hasText: "Actor Headquarters" });
      await expect(persistedHeadquarters).toContainText("Address private");
      await expect(persistedHeadquarters).toContainText("Marker public");
      await persistedHeadquarters.getByRole("button", { name: "Edit" }).click();
      await expect(page.getByLabel("Address line 1")).toHaveValue("4600 Silver Hill Road");
      await expect(page.getByLabel("City")).toHaveValue("Washington");

      await page.getByRole("tab", { name: "Contact & Routing" }).click();
      const contactSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Contact points" }) });
      const routeSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Communication routes" }) });
      const privateEmail = `configured-general-${fixture.ownerUid}@example.test`;
      const editedPrivateEmail = `configured-edited-${fixture.ownerUid}@example.test`;
      const privatePhone = "+1 202 555 0147";
      await contactSection.getByLabel("Contact type").selectOption("email");
      await contactSection.getByLabel("Contact value").fill(privateEmail);
      await contactSection.getByLabel(/^Purpose/).selectOption("general");
      await contactSection.getByLabel("Visibility").selectOption("private_operational");
      await contactSection.getByRole("button", { name: "Add contact" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Contact point added." })).toBeVisible();

      await contactSection.getByLabel("Contact type").selectOption("phone");
      await contactSection.getByLabel("Contact value").fill(privatePhone);
      await contactSection.getByLabel(/^Purpose/).selectOption("general");
      await contactSection.getByRole("button", { name: "Add contact" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Contact point added." })).toBeVisible();

      await routeSection.getByLabel(/^Route purpose/).selectOption("referrals");
      await routeSection.getByLabel("Primary contact").selectOption({ label: privateEmail });
      await routeSection.getByRole("button", { name: "Add route" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Communication route saved." })).toBeVisible();
      await routeSection.getByLabel(/^Route purpose/).selectOption("opportunities");
      await routeSection.getByLabel("Primary contact").selectOption({ label: privatePhone });
      await routeSection.getByRole("button", { name: "Add route" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Communication route saved." })).toBeVisible();

      await contactSection.getByRole("listitem").filter({ hasText: privateEmail }).getByRole("button", { name: "Edit" }).click();
      await contactSection.getByLabel("Contact value").fill(editedPrivateEmail);
      await contactSection.getByRole("button", { name: "Save contact" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Contact point updated." })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: fixture.actorName })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("tab", { name: "Contact & Routing" }).click();
      await expect(contactSection.getByRole("strong").filter({ hasText: editedPrivateEmail })).toBeVisible({ timeout: 60_000 });
      await expect(routeSection.getByRole("listitem").filter({ hasText: "referrals" })).toBeVisible();
      await expect(routeSection.getByRole("listitem").filter({ hasText: "opportunities" })).toBeVisible();

      await page.getByRole("tab", { name: "1. Enrichment" }).click();
      await expect(page.getByRole("heading", { name: "Enrichment proposals" })).toBeVisible();
      await page.getByLabel(/^Classify proposed address /).selectOption("branch");
      await page.getByLabel("Location label").fill("Reviewed enrichment branch");
      await page.getByRole("button", { name: "Record address decision" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Enrichment address decision recorded." })).toBeVisible();
      await page.getByLabel(/^Classify proposed contact /).selectOption("private_operational");
      await page.getByRole("button", { name: "Record contact decision" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Enrichment contact decision recorded." })).toBeVisible();

      const evidenceApp = initializeApp({ projectId: PROJECT_ID }, `configured-management-evidence-${crypto.randomUUID()}`);
      const evidenceDb = getFirestore(evidenceApp);
      const [privateLocations, publicLocations, privateContacts, publicContacts, routes, organization] = await Promise.all([
        evidenceDb.collection("organizationLocations").where("organizationId", "==", fixture.actorOrganizationId).get(),
        evidenceDb.collection("publicOrganizationLocations").where("organizationId", "==", fixture.actorOrganizationId).get(),
        evidenceDb.collection("organizationContactPoints").where("organizationId", "==", fixture.actorOrganizationId).get(),
        evidenceDb.collection("publicOrganizationContactPoints").where("organizationId", "==", fixture.actorOrganizationId).get(),
        evidenceDb.collection("organizationCommunicationRoutes").where("organizationId", "==", fixture.actorOrganizationId).get(),
        evidenceDb.collection("orgs").doc(fixture.actorOrganizationId).get(),
      ]);
      const persistedHeadquartersData = privateLocations.docs.find((document) => document.id === fixture.actorHeadquartersId)?.data();
      expect(persistedHeadquartersData).toMatchObject({
        isPrimary: true,
        isHeadquarters: true,
        addressPublicationApproved: false,
        coordinatePublicationApproved: true,
        geocode: { provider: "census", source: "owner_confirmed" },
      });
      const publicHeadquarters = publicLocations.docs.find((document) => document.id === fixture.actorHeadquartersId)?.data();
      expect(publicHeadquarters).not.toHaveProperty("addressLine1");
      expect(publicHeadquarters).toMatchObject({ coordinatePublicationApproved: true });
      expect(privateLocations.docs.find((document) => document.get("name") === "Reviewed enrichment branch")?.data()).toMatchObject({
        isPrimary: false,
        addressPublicationApproved: false,
        coordinatePublicationApproved: false,
      });
      expect(publicLocations.docs.find((document) => document.get("name") === "Reviewed enrichment branch")?.data()).not.toHaveProperty("addressLine1");
      expect(privateContacts.docs.map((document) => document.data())).toEqual(expect.arrayContaining([
        expect.objectContaining({ normalizedValue: editedPrivateEmail.toLowerCase(), visibility: "private_operational" }),
        expect.objectContaining({ normalizedValue: "+12025550147", visibility: "private_operational" }),
      ]));
      expect(publicContacts.empty).toBe(true);
      expect(routes.docs.map((document) => document.get("purpose"))).toEqual(expect.arrayContaining(["referrals", "opportunities"]));
      expect(organization.get("name")).toBe(fixture.actorName);
    }

    const selfParams = new URLSearchParams({
      view: "opportunities",
      actorOrg: fixture.actorOrganizationId,
      subjectOrg: fixture.actorOrganizationId,
      secondaryEntity: "establishment",
      secondarySelected: fixture.actorHeadquartersId,
      drawer: "organization",
      q: "commercial construction",
      lng: "-76.6311",
      lat: "36.9824",
      z: "16.5",
      p: "55",
      b: "-20",
    });
    await gotoStable(page, `/exchange?${selfParams.toString()}`);
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Organization context drawer")).toContainText(/self/i);
    await expect(page.getByLabel("Organization context drawer")).toContainText(/private owner/i);
    const dimensionControl = page.getByRole("group", { name: "Map dimension" });
    await expect(dimensionControl).toBeVisible();
    await expect(dimensionControl.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-map-dimension="3d"]')).toBeVisible();
    const controlPosition = await dimensionControl.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: Math.round(bounds.left),
        top: Math.round(bounds.top),
        right: Math.round(bounds.right),
        bottom: Math.round(bounds.bottom),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
    });
    console.log(`MAP_CONTROL_POSITION ${JSON.stringify({
      project: testInfo.project.name,
      viewport: page.viewportSize(),
      control: controlPosition,
    })}`);
    for (const name of ["2D", "3D"] as const) {
      const button = dimensionControl.getByRole("button", { name });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      const viewport = page.viewportSize();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
      expect(await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return hit === element || element.contains(hit);
      })).toBe(true);
    }
    await dimensionControl.getByRole("button", { name: "3D" }).click();
    await expect(page.locator('[data-map-dimension="3d"]')).toBeVisible();
    await expect(dimensionControl.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
    await dimensionControl.getByRole("button", { name: "2D" }).click();
    await expect(page.locator('[data-map-dimension="2d"]')).toBeVisible();
    await dimensionControl.getByRole("button", { name: "3D" }).click();
    await expect(page.locator('[data-map-dimension="3d"]')).toBeVisible();
    await page.screenshot({
      path: resolve(evidenceDirectory, `map-control-${testInfo.project.name}.png`),
      fullPage: false,
      animations: "disabled",
    });

    const params = new URLSearchParams(selfParams);
    params.set("subjectOrg", fixture.subjectOrganizationId);
    params.set("entity", "establishment");
    params.set("selected", fixture.subjectBranchId);
    params.set("secondaryEntity", "establishment");
    params.set("secondarySelected", fixture.subjectBranchId);
    params.set("panel", "detail");
    await gotoStable(page, `/exchange?${params.toString()}`);
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
    const drawer = page.getByLabel("Organization context drawer");
    const workspaceSearch = page.getByLabel("Search current Exchange view");
    const expectWorkspaceSearchPreserved = async () => {
      await expect(workspaceSearch).toHaveCount(4);
      await expect.poll(() => workspaceSearch.evaluateAll((inputs) => (
        inputs.map((input) => (input as HTMLInputElement).value)
      ))).toEqual(
        Array(4).fill("commercial construction"),
      );
    };
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(fixture.subjectName);
    await expect(drawer).toContainText(/external claimed/i);
    await expect(drawer).not.toContainText(/never-return-external/i);
    await expectWorkspaceSearchPreserved();

    const mapHost = page.locator('[data-exchange-map-host="persistent"]');
    await expect(mapHost).toHaveCount(1);
    await expect(page.locator(".mapboxgl-canvas")).toHaveCount(1, { timeout: 40_000 });
    const originalMapHost = await mapHost.elementHandle();
    expect(originalMapHost).toBeTruthy();
    const originalDimensionControl = await dimensionControl.elementHandle();
    expect(originalDimensionControl).toBeTruthy();

    const viewNavigation = page.getByRole("navigation", { name: /Exchange views|Primary Exchange navigation/ });
    for (const view of ["Referrals", "Intelligence", "Resources", "Opportunities"] as const) {
      await viewNavigation.getByRole("button", { name: view, exact: true }).click();
      await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
      await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
      await expectWorkspaceSearchPreserved();
      await expect(drawer).toBeVisible();
      await expect(page.locator('[data-exchange-map-host="persistent"]')).toHaveCount(1);
      expect(await originalMapHost!.evaluate((node) => node.isConnected)).toBe(true);
      expect(await originalDimensionControl!.evaluate((node) => node.isConnected)).toBe(true);
      await expect(dimensionControl).toBeVisible();
      const modeUrl = new URL(page.url());
      expect(modeUrl.searchParams.get("subjectOrg")).toBe(fixture.subjectOrganizationId);
      expect(modeUrl.searchParams.get("entity")).toBe("establishment");
      expect(modeUrl.searchParams.get("selected")).toBe(fixture.subjectBranchId);
    }
    await expect(drawer).toContainText(new RegExp(`Opportunities for ${fixture.actorName} related to ${fixture.subjectName}`, "i"));

    const currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("actorOrg")).toBe(fixture.actorOrganizationId);
    expect(currentUrl.searchParams.get("subjectOrg")).toBe(fixture.subjectOrganizationId);
    expect(currentUrl.searchParams.get("q")).toBe("commercial construction");
    expect(Number(currentUrl.searchParams.get("lng"))).toBeCloseTo(-76.6311, 1);
    expect(Number(currentUrl.searchParams.get("lat"))).toBeCloseTo(36.9824, 1);

    const externalHistoryUrl = page.url();
    await page.evaluate((url) => {
      window.history.pushState(window.history.state, "", url);
    }, `/exchange?${selfParams.toString()}`);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.actorName);
    await page.evaluate((url) => {
      window.history.pushState(window.history.state, "", url);
    }, externalHistoryUrl);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);

    await page.reload();
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
    await expectWorkspaceSearchPreserved();
    await page.goBack();
    await expect(page).toHaveURL(/\/exchange(?:\?|$)/);
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    const backSubjectOrganizationId = new URL(page.url()).searchParams.get("subjectOrg");
    expect(backSubjectOrganizationId).toBe(fixture.actorOrganizationId);
    await expect(page.getByLabel("Exchange organization context")).toContainText(
      backSubjectOrganizationId === fixture.actorOrganizationId
        ? fixture.actorName
        : fixture.subjectName,
    );
    await page.goForward();
    await expect(page).toHaveURL(/\/exchange(?:\?|$)/);
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);

    await expect.poll(() => perspectiveResponses.length).toBeGreaterThan(0);
    const responseText = JSON.stringify(perspectiveResponses);
    expect(responseText).not.toContain("never-return-external-private-gap");
    expect(responseText).not.toContain("never-return-external-billing@example.test");
    expect(responseText).not.toContain("never-return-external-admin-notes");
    expect(responseText).not.toContain(fixture.externalOwnerUid);
    expect(responseText).not.toContain("never-return-private-referral@example.test");

    const drawerRequest = page.getByLabel("Organization context drawer");
    await drawerRequest.getByLabel("Request message").fill("Configured routing acceptance request.");
    await drawerRequest.getByRole("button", { name: "Request contact" }).click();
    await expect(drawerRequest.getByText("Contact request submitted. Protected contact details were not disclosed.")).toBeVisible();
    await expect(drawerRequest).not.toContainText("never-return-private-referral@example.test");
    const evidenceApp = initializeApp({ projectId: PROJECT_ID }, `configured-route-evidence-${testInfo.project.name}-${crypto.randomUUID()}`);
    const evidenceDb = getFirestore(evidenceApp);
    await expect.poll(async () => {
      const requests = await evidenceDb.collection("organizationContactRequests")
        .where("requestedByUid", "==", fixture.ownerUid).get();
      const request = requests.docs.find((document) => document.data().subjectOrganizationId === fixture.subjectOrganizationId)?.data();
      return request?.routeResolution ?? null;
    }).toMatchObject({
      organizationId: fixture.subjectOrganizationId,
      purpose: "general",
      publicDisclosureLevel: "public",
      fallbackUsed: "none",
    });

    await page.addScriptTag({ path: axePath });
    const accessibility = await page.evaluate(async () => {
      const axe = (window as unknown as {
        axe: { run: (context: Document, options: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
      }).axe;
      return axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
    });
    expect(accessibility.violations.filter((violation) => (
      violation.impact === "critical" || violation.impact === "serious"
    ))).toEqual([]);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await gotoStable(page, `/org/settings?id=${fixture.actorOrganizationId}&tab=establishments`);
    await expect(page.getByRole("heading", { name: fixture.actorName })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("listitem").filter({ hasText: "Actor Headquarters" }).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Location label").fill("Unsaved revoked establishment draft");
    await revokeActorMembership(fixture, testInfo.project.name);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Organization settings unavailable" })).toBeVisible({ timeout: 60_000 });
    const revokedEvidenceApp = initializeApp({ projectId: PROJECT_ID }, `configured-revoked-evidence-${crypto.randomUUID()}`);
    const revokedEvidenceDb = getFirestore(revokedEvidenceApp);
    expect((await revokedEvidenceDb.collection("organizationLocations").doc(fixture.actorHeadquartersId).get()).get("name"))
      .toBe("Actor Headquarters");

    await page.goto(`/exchange?${params.toString()}`);
    await expect(page.getByLabel("Working as organization")).toHaveValue("");
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
    await expect(page.getByLabel("Organization context drawer")).not.toContainText(/private owner/i);
    await expect(page.getByLabel("Organization context drawer")).not.toContainText(/never-return-external/i);
  } finally {
    await cleanupFixture(fixture, testInfo.project.name);
  }
});
