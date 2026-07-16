import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

interface FieldOverride {
  collectionGroup?: string;
  fieldPath?: string;
  indexes?: Array<{
    order?: string;
    queryScope?: string;
  }>;
}

interface CompositeIndex {
  collectionGroup?: string;
  queryScope?: string;
  fields?: Array<{
    fieldPath?: string;
    order?: string;
    arrayConfig?: string;
  }>;
}

describe("Firestore cleanup indexes", () => {
  test("uploadGrants cleanup uses the required collection-group composite", () => {
    const config = JSON.parse(readFileSync(resolve("firestore.indexes.json"), "utf8")) as {
      indexes?: CompositeIndex[];
    };
    const index = config.indexes?.find(
      (candidate) => candidate.collectionGroup === "uploadGrants"
        && candidate.queryScope === "COLLECTION_GROUP",
    );

    expect(index?.fields).toEqual([
      { fieldPath: "grantType", order: "ASCENDING" },
      { fieldPath: "expiresAt", order: "ASCENDING" },
    ]);
  });

  test.each(["readGrants", "storageGrants"])(
    "%s exposes an ascending collection-group expiresAt index",
    (collectionGroup) => {
      const config = JSON.parse(readFileSync(resolve("firestore.indexes.json"), "utf8")) as {
        fieldOverrides?: FieldOverride[];
      };
      const override = config.fieldOverrides?.find(
        (candidate) => candidate.collectionGroup === collectionGroup
          && candidate.fieldPath === "expiresAt",
      );

      expect(override).toBeDefined();
      expect(override?.indexes).toContainEqual({
        order: "ASCENDING",
        queryScope: "COLLECTION_GROUP",
      });
    },
  );

  test("team members expose the collection-group uid index used by team_listMine", () => {
    const config = JSON.parse(readFileSync(resolve("firestore.indexes.json"), "utf8")) as {
      fieldOverrides?: FieldOverride[];
    };
    const override = config.fieldOverrides?.find(
      (candidate) => candidate.collectionGroup === "members"
        && candidate.fieldPath === "uid",
    );

    expect(override?.indexes).toContainEqual({
      order: "ASCENDING",
      queryScope: "COLLECTION_GROUP",
    });
  });

  test("Run 3 versions the referral list, timeline, offer, report, relationship, and analytics indexes", () => {
    const config = JSON.parse(readFileSync(resolve("firestore.indexes.json"), "utf8")) as {
      indexes?: CompositeIndex[];
    };
    const signatures = new Set((config.indexes ?? []).map((index) => JSON.stringify({
      collectionGroup: index.collectionGroup,
      fields: index.fields,
    })));
    const required: Array<{ collectionGroup: string; fields: NonNullable<CompositeIndex["fields"]> }> = [
      {
        collectionGroup: "businessReferrals",
        fields: [
          { fieldPath: "referrerOrgId", order: "ASCENDING" },
          { fieldPath: "status", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      },
      {
        collectionGroup: "businessReferrals",
        fields: [
          { fieldPath: "recipientOrgId", order: "ASCENDING" },
          { fieldPath: "status", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      },
      {
        collectionGroup: "businessReferrals",
        fields: [
          { fieldPath: "assignedStaffUids", arrayConfig: "CONTAINS" },
          { fieldPath: "createdAt", order: "DESCENDING" },
          { fieldPath: "__name__", order: "ASCENDING" },
        ],
      },
      {
        collectionGroup: "referralServiceOffers",
        fields: [
          { fieldPath: "status", order: "ASCENDING" },
          { fieldPath: "acceptingReferrals", order: "ASCENDING" },
          { fieldPath: "__name__", order: "ASCENDING" },
        ],
      },
      {
        collectionGroup: "referralServiceOffers",
        fields: [
          { fieldPath: "status", order: "ASCENDING" },
          { fieldPath: "acceptingReferrals", order: "ASCENDING" },
          { fieldPath: "serviceCategory", order: "ASCENDING" },
          { fieldPath: "publishedAt", order: "DESCENDING" },
        ],
      },
      {
        collectionGroup: "businessReferralTimeline",
        fields: [
          { fieldPath: "referralId", order: "ASCENDING" },
          { fieldPath: "occurredAt", order: "ASCENDING" },
        ],
      },
      {
        collectionGroup: "referralTransactionReports",
        fields: [
          { fieldPath: "referralId", order: "ASCENDING" },
          { fieldPath: "status", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      },
      {
        collectionGroup: "referralRelationshipInsights",
        fields: [
          { fieldPath: "participantSubjectKeys", arrayConfig: "CONTAINS" },
          { fieldPath: "state", order: "ASCENDING" },
          { fieldPath: "updatedAt", order: "DESCENDING" },
        ],
      },
      {
        collectionGroup: "referralAnalyticsSnapshots",
        fields: [
          { fieldPath: "scopeType", order: "ASCENDING" },
          { fieldPath: "scopeId", order: "ASCENDING" },
          { fieldPath: "kind", order: "ASCENDING" },
          { fieldPath: "windowEnd", order: "DESCENDING" },
        ],
      },
    ];

    for (const index of required) {
      expect(signatures).toContain(JSON.stringify(index));
    }
  });

  test("Run 3 exempts protected unqueried referral payloads from automatic indexes", () => {
    const config = JSON.parse(readFileSync(resolve("firestore.indexes.json"), "utf8")) as {
      fieldOverrides?: FieldOverride[];
    };
    for (const [collectionGroup, fieldPath] of [
      ["businessReferralContacts", "email"],
      ["businessReferralContacts", "phone"],
      ["businessReferrals", "acceptedTermsSnapshot"],
      ["businessReferralTimeline", "metadata"],
      ["referralTransactionReports", "evidenceStoragePaths"],
      ["referralTransactionReports", "calculation"],
    ]) {
      expect(config.fieldOverrides).toContainEqual({ collectionGroup, fieldPath, indexes: [] });
    }
  });
});
