import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  deleteApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

const PROJECT_ID = "demo-hi-coworking";
const FIRESTORE_EMULATOR_URL = "http://127.0.0.1:8081";
const functionsRequire = createRequire(resolve("apps/functions/package.json"));
const functionsAdmin = functionsRequire("firebase-admin") as typeof import("firebase-admin");

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

let app: App;
let db: Firestore;
let offers: typeof import("../../apps/functions/src/referralServiceOffers");
let commerce: typeof import("../../apps/functions/src/referralCommerce");

async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Could not clear Firestore: ${response.status} ${await response.text()}`);
  }
}

function request(
  uid: string,
  role: "member" | "admin",
  data: unknown,
): CallableRequest<unknown> {
  return {
    data,
    auth: {
      uid,
      token: {
        role,
        email: `${uid}@example.test`,
      },
    },
  } as unknown as CallableRequest<unknown>;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected callable error ${code}`);
  } catch (error) {
    expect((error as { code?: unknown }).code).toBe(code);
  }
}

const percentageTerms = {
  serviceName: "Facilities support",
  serviceCategory: "facilities",
  naicsCodes: ["561210"],
  territoryFips: ["51095"],
  acceptingReferrals: true,
  compensationType: "percentage" as const,
  compensationRateBasisPoints: 1_000,
  percentageBasis: "first_collected_invoice" as const,
  currency: "USD",
  attributionWindowDays: 90,
  payoutTrigger: "After confirmed collection",
};

beforeAll(async () => {
  for (const existing of getApps()) await deleteApp(existing);
  app = initializeApp({ projectId: PROJECT_ID });
  if (functionsAdmin.apps.length === 0) functionsAdmin.initializeApp({ projectId: PROJECT_ID });
  db = getFirestore(app);
  [offers, commerce] = await Promise.all([
    import("../../apps/functions/src/referralServiceOffers"),
    import("../../apps/functions/src/referralCommerce"),
  ]);
});

beforeEach(clearFirestore);

afterAll(async () => {
  await deleteApp(app);
  await Promise.all(functionsAdmin.apps.map((existing) => existing.delete()));
});

describe("Run 3 referral service-offer authority and immutability", () => {
  it("requires current org-manager authority and publishes immutable versions", async () => {
    await Promise.all([
      db.collection("orgs").doc("provider-org").set({ id: "provider-org", status: "active" }),
      db.collection("orgMembers").doc("provider-org_manager").set({
        id: "provider-org_manager",
        orgId: "provider-org",
        uid: "manager",
        role: "owner",
        status: "active",
      }),
      db.collection("orgMembers").doc("provider-org_member").set({
        id: "provider-org_member",
        orgId: "provider-org",
        uid: "member",
        role: "member",
        status: "active",
      }),
    ]);

    const createInput = {
      idempotencyKey: "offer-create-0001",
      providerOrgId: "provider-org",
      ...percentageTerms,
    };
    const created = await offers.referralServiceOffer_create.run(
      request("manager", "member", createInput),
    ) as { serviceOfferVersionId: string; stateVersion: number; idempotent?: boolean };
    expect(created).toMatchObject({ stateVersion: 0, status: "draft", version: 1 });

    const replay = await offers.referralServiceOffer_create.run(
      request("manager", "member", createInput),
    ) as { serviceOfferVersionId: string; idempotent?: boolean };
    expect(replay).toMatchObject({
      serviceOfferVersionId: created.serviceOfferVersionId,
      idempotent: true,
    });
    await expectCode(
      offers.referralServiceOffer_create.run(request("manager", "member", {
        ...createInput,
        serviceName: "Different terms under the same key",
      })),
      "already-exists",
    );
    await expectCode(
      offers.referralServiceOffer_publish.run(request("member", "member", {
        idempotencyKey: "offer-publish-denied-0001",
        serviceOfferVersionId: created.serviceOfferVersionId,
        expectedStateVersion: 0,
      })),
      "permission-denied",
    );

    const published = await offers.referralServiceOffer_publish.run(request("manager", "member", {
      idempotencyKey: "offer-publish-0001",
      serviceOfferVersionId: created.serviceOfferVersionId,
      expectedStateVersion: 0,
    })) as { stateVersion: number; status: string };
    expect(published).toMatchObject({ stateVersion: 1, status: "published" });
    const versionOneBefore = (await db.collection("referralServiceOffers")
      .doc(created.serviceOfferVersionId).get()).data();

    const versionTwo = await offers.referralServiceOffer_createVersion.run(request("manager", "member", {
      idempotencyKey: "offer-version-0002",
      sourceVersionId: created.serviceOfferVersionId,
      expectedStateVersion: 1,
      ...percentageTerms,
      compensationRateBasisPoints: 1_250,
    })) as { serviceOfferVersionId: string; version: number };
    expect(versionTwo.version).toBe(2);
    expect((await db.collection("referralServiceOffers").doc(created.serviceOfferVersionId).get()).data())
      .toEqual(versionOneBefore);

    await offers.referralServiceOffer_publish.run(request("manager", "member", {
      idempotencyKey: "offer-publish-0002",
      serviceOfferVersionId: versionTwo.serviceOfferVersionId,
      expectedStateVersion: 0,
    }));
    const [versionOneAfter, versionTwoAfter] = await Promise.all([
      db.collection("referralServiceOffers").doc(created.serviceOfferVersionId).get(),
      db.collection("referralServiceOffers").doc(versionTwo.serviceOfferVersionId).get(),
    ]);
    expect(versionOneAfter.data()).toMatchObject({
      status: "inactive",
      compensationRateBasisPoints: 1_000,
      percentageBasis: "first_collected_invoice",
      version: 1,
    });
    expect(versionTwoAfter.data()).toMatchObject({
      status: "published",
      compensationRateBasisPoints: 1_250,
      version: 2,
    });
    const discoverable = await offers.referralServiceOffer_listDiscoverable.run(
      request("member", "member", { limit: 10 }),
    ) as { offers: Array<{ id: string }> };
    expect(discoverable.offers.map((offer) => offer.id)).toEqual([versionTwo.serviceOfferVersionId]);

    await db.collection("orgMembers").doc("provider-org_manager").delete();
    await expectCode(
      offers.referralServiceOffer_create.run(request("manager", "member", createInput)),
      "permission-denied",
    );
    await db.collection("orgs").doc("provider-org").update({ status: "inactive" });
    const afterDeactivation = await offers.referralServiceOffer_listDiscoverable.run(
      request("member", "member", { limit: 10 }),
    ) as { offers: unknown[] };
    expect(afterDeactivation.offers).toEqual([]);
  });
});

describe("Run 3 referral commerce configuration", () => {
  it("defaults to 100 bps, rejects member changes, and records prospective admin versions", async () => {
    const initial = await commerce.referralCommerce_getConfiguration.run(
      request("member", "member", {}),
    ) as { configuration: Record<string, unknown> };
    expect(initial.configuration).toMatchObject({
      platformFeeBasisPoints: 100,
      version: 1,
      commerceEnabled: true,
      settlementEnabled: false,
    });

    const updateInput = {
      idempotencyKey: "commerce-config-0001",
      expectedVersion: 1,
      platformFeeBasisPoints: 125,
      commerceEnabled: true,
      settlementEnabled: false as const,
    };
    await expectCode(
      commerce.referralCommerce_updateConfiguration.run(request("member", "member", updateInput)),
      "permission-denied",
    );
    const updated = await commerce.referralCommerce_updateConfiguration.run(
      request("admin", "admin", updateInput),
    ) as { configuration: Record<string, unknown>; idempotent?: boolean };
    expect(updated.configuration).toMatchObject({
      platformFeeBasisPoints: 125,
      version: 2,
      commerceEnabled: true,
      settlementEnabled: false,
    });

    const replay = await commerce.referralCommerce_updateConfiguration.run(
      request("admin", "admin", updateInput),
    ) as { configuration: Record<string, unknown>; idempotent?: boolean };
    expect(replay).toMatchObject({ idempotent: true });
    await expectCode(
      commerce.referralCommerce_updateConfiguration.run(request("admin", "admin", {
        idempotencyKey: "commerce-config-stale-0002",
        expectedVersion: 1,
        platformFeeBasisPoints: 150,
      })),
      "aborted",
    );
    await expectCode(
      commerce.referralCommerce_updateConfiguration.run(request("admin", "admin", {
        idempotencyKey: "commerce-config-settlement-0003",
        expectedVersion: 2,
        settlementEnabled: true,
      })),
      "invalid-argument",
    );

    const [versionOne, versionTwo, current] = await Promise.all([
      db.doc("platformConfiguration/referralCommerce/versions/1").get(),
      db.doc("platformConfiguration/referralCommerce/versions/2").get(),
      db.doc("platformConfiguration/referralCommerce").get(),
    ]);
    expect(versionOne.data()).toMatchObject({ platformFeeBasisPoints: 100, version: 1 });
    expect(versionTwo.data()).toMatchObject({ platformFeeBasisPoints: 125, version: 2 });
    expect(current.data()).toMatchObject({ platformFeeBasisPoints: 125, version: 2 });
  });
});
