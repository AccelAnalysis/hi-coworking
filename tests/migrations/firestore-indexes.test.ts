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
});
