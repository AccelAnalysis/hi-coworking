import { describe, expect, it } from "vitest";
import type { RfxDoc } from "@hi/shared";
import {
  mergeExchangeRfx,
  mergeExchangeRfxWithPinned,
  resolvePinnedExchangeRfx,
  uniqueDiscoverableExchangeRfx,
} from "../../apps/web/src/features/exchange/data/exchangeRecordMerge";

function rfx(id: string, overrides: Partial<RfxDoc> = {}): RfxDoc {
  return {
    id,
    title: `RFx ${id}`,
    description: "Current opportunity",
    memberOnly: false,
    status: "open",
    createdBy: "issuer",
    createdByName: "Issuer",
    evaluationCriteria: [],
    requestedDocuments: [],
    adminApprovalStatus: "approved",
    responseCount: 0,
    createdAt: 1,
    ...overrides,
  };
}

describe("bounded Exchange RFx merge", () => {
  it("retains only approved, open RFx", () => {
    expect(uniqueDiscoverableExchangeRfx([
      rfx("approved"),
      rfx("pending", { adminApprovalStatus: "pending" }),
      rfx("closed", { status: "closed" }),
    ], 10).map((record) => record.id)).toEqual(["approved"]);
  });

  it("deduplicates IDs and honors the hard maximum", () => {
    expect(uniqueDiscoverableExchangeRfx([
      rfx("a"),
      rfx("a", { title: "duplicate" }),
      rfx("b"),
      rfx("c"),
    ], 2).map((record) => record.id)).toEqual(["a", "b"]);
  });

  it("prioritizes later viewport discoveries when the cache is full", () => {
    const result = mergeExchangeRfx(
      [rfx("old-a"), rfx("old-b"), rfx("old-c")],
      [rfx("new-a"), rfx("new-b")],
      3,
    );
    expect(result.map((record) => record.id)).toEqual(["new-a", "new-b", "old-a"]);
  });

  it("uses the viewport copy for a duplicate current record", () => {
    const result = mergeExchangeRfx(
      [rfx("same", { title: "Old" })],
      [rfx("same", { title: "Fresh" })],
      10,
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fresh");
  });

  it("preserves one loaded selection while later viewports continue replacing the cache", () => {
    const pinned = rfx("selected");
    const firstPan = mergeExchangeRfxWithPinned(
      [rfx("baseline")],
      [rfx("viewport-a"), rfx("viewport-b")],
      pinned,
      3,
    );
    expect(firstPan.map((record) => record.id)).toEqual([
      "selected",
      "viewport-a",
      "viewport-b",
    ]);

    const secondPan = mergeExchangeRfxWithPinned(
      [rfx("baseline")],
      [rfx("viewport-c"), rfx("viewport-d")],
      pinned,
      3,
    );
    expect(secondPan.map((record) => record.id)).toEqual([
      "selected",
      "viewport-c",
      "viewport-d",
    ]);
  });

  it("pins only a record that was loaded and keeps its freshest loaded copy", () => {
    const previous = rfx("selected", { title: "Previously loaded" });
    const fresh = rfx("selected", { title: "Fresh viewport copy" });

    expect(resolvePinnedExchangeRfx([], "never-loaded", null)).toBeNull();
    expect(resolvePinnedExchangeRfx([], "selected", previous)).toBe(previous);
    expect(resolvePinnedExchangeRfx([fresh], "selected", previous)).toBe(fresh);
    expect(resolvePinnedExchangeRfx([], "different-id", previous)).toBeNull();
  });
});
