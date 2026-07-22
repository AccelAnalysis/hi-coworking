import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const enabled = process.env.EXCHANGE_DEV_ORGANIZATION_CONTINUITY === "true";
const PROJECT_ID = "hi-coworking-plat";
const TEST_PURPOSE = "configured-organization-continuity-acceptance";
const axePath = resolve(process.cwd(), "node_modules/axe-core/axe.min.js");

type Fixture = {
  ownerUid: string;
  externalOwnerUid: string;
  ownerEmail: string;
  ownerPassword: string;
  actorOrganizationId: string;
  subjectOrganizationId: string;
  actorName: string;
  subjectName: string;
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
    const selfParams = new URLSearchParams({
      view: "opportunities",
      actorOrg: fixture.actorOrganizationId,
      subjectOrg: fixture.actorOrganizationId,
      drawer: "organization",
      q: "commercial construction",
      lng: "-76.7093",
      lat: "36.9066",
      z: "10",
    });
    await page.goto(`/exchange?${selfParams.toString()}`);
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Organization context drawer")).toContainText(/self/i);
    await expect(page.getByLabel("Organization context drawer")).toContainText(/private owner/i);

    const params = new URLSearchParams(selfParams);
    params.set("subjectOrg", fixture.subjectOrganizationId);
    await page.goto(`/exchange?${params.toString()}`);
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

    const viewNavigation = page.getByRole("navigation", { name: /Exchange views|Primary Exchange navigation/ });
    for (const view of ["Referrals", "Intelligence", "Resources", "Opportunities"] as const) {
      await viewNavigation.getByRole("button", { name: view, exact: true }).click();
      await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
      await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
      await expectWorkspaceSearchPreserved();
      await expect(drawer).toBeVisible();
      await expect(page.locator('[data-exchange-map-host="persistent"]')).toHaveCount(1);
      expect(await originalMapHost!.evaluate((node) => node.isConnected)).toBe(true);
    }
    await expect(drawer).toContainText(new RegExp(`Opportunities for ${fixture.actorName} related to ${fixture.subjectName}`, "i"));

    const currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("actorOrg")).toBe(fixture.actorOrganizationId);
    expect(currentUrl.searchParams.get("subjectOrg")).toBe(fixture.subjectOrganizationId);
    expect(currentUrl.searchParams.get("q")).toBe("commercial construction");
    expect(Number(currentUrl.searchParams.get("lng"))).toBeCloseTo(-76.7093, 1);
    expect(Number(currentUrl.searchParams.get("lat"))).toBeCloseTo(36.9066, 1);

    await page.reload();
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
    await expectWorkspaceSearchPreserved();
    await page.goBack();
    await page.goForward();
    await expect(page.getByLabel("Working as organization")).toHaveValue(fixture.actorOrganizationId);
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);

    await expect.poll(() => perspectiveResponses.length).toBeGreaterThan(0);
    const responseText = JSON.stringify(perspectiveResponses);
    expect(responseText).not.toContain("never-return-external-private-gap");
    expect(responseText).not.toContain("never-return-external-billing@example.test");
    expect(responseText).not.toContain("never-return-external-admin-notes");
    expect(responseText).not.toContain(fixture.externalOwnerUid);

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

    await revokeActorMembership(fixture, testInfo.project.name);
    await page.reload();
    await expect(page.getByLabel("Working as organization")).toHaveValue("");
    await expect(page.getByLabel("Exchange organization context")).toContainText(fixture.subjectName);
    await expect(page.getByLabel("Organization context drawer")).not.toContainText(/private owner/i);
    await expect(page.getByLabel("Organization context drawer")).not.toContainText(/never-return-external/i);
  } finally {
    await cleanupFixture(fixture, testInfo.project.name);
  }
});
