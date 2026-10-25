import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin", () => ({
  apps: [{}],
  initializeApp: () => ({}),
  firestore: () => ({}),
}));

import { addOnWrite, setupWrite } from "../../apps/functions/src/spaceCatalog";

const source = readFileSync("apps/functions/src/spaceCatalog.ts", "utf8");

describe("add-on writes", () => {
  it("fills defaults and createdAt for a new add-on", () => {
    expect(addOnWrite(undefined, { name: "Coffee" }, "Coffee", "admin-1", 100)).toEqual({
      name: "Coffee",
      description: "",
      priceCents: 0,
      stripePriceId: "",
      serviceTypes: ["CONFERENCE"],
      published: true,
      createdAt: 100,
      updatedAt: 100,
      updatedBy: "admin-1",
    });
  });

  it("re-adding an existing add-on only changes what was sent", () => {
    const existing = { name: "Coffee", description: "Fresh pot", stripePriceId: "price_abcdef12", priceCents: 500, createdAt: 1 };
    const write = addOnWrite(existing, { name: "Coffee", priceCents: 600, serviceTypes: ["DESK"], published: true }, "Coffee", "admin-2", 200);
    expect(write).toEqual({ name: "Coffee", priceCents: 600, serviceTypes: ["DESK"], published: true, updatedAt: 200, updatedBy: "admin-2" });
    expect(write).not.toHaveProperty("description");
    expect(write).not.toHaveProperty("stripePriceId");
    expect(write).not.toHaveProperty("createdAt");
  });

  it("is the same write when a call is retried", () => {
    const input = { name: "Coffee", priceCents: 600 };
    expect(addOnWrite({ name: "Coffee" }, input, "Coffee", "a", 5)).toEqual(addOnWrite({ name: "Coffee" }, input, "Coffee", "a", 5));
  });
});

describe("setup writes", () => {
  const payload = { id: "s1", name: "Room A", updatedAt: 10, updatedBy: "admin-1" };

  it("publishes a new setup by default and stamps createdAt once", () => {
    expect(setupWrite(undefined, payload, undefined, 10)).toMatchObject({ published: true, createdAt: 10 });
    expect(setupWrite({ createdAt: 1, published: true }, payload, undefined, 20)).not.toHaveProperty("createdAt");
  });

  it("keeps a hidden setup hidden when it is saved again", () => {
    expect(setupWrite({ published: false }, payload, undefined, 20)).not.toHaveProperty("published");
    expect(setupWrite({ published: false }, payload, true, 20)).toMatchObject({ published: true });
  });
});

describe("catalog callables are retry-safe", () => {
  for (const name of ["space_adminUpsertSetup", "space_adminUpsertAddOn", "space_adminSetSetupPublished"]) {
    it(`${name} decides and writes in one transaction`, () => {
      const start = source.indexOf(`export const ${name}`);
      const end = source.indexOf("export const ", start + 10);
      const handler = source.slice(start, end === -1 ? undefined : end);
      expect(handler).toContain("db.runTransaction(");
      expect(handler).not.toMatch(/await ref\.(set|update)\(/);
    });
  }

  it("does not republish a setup whose floor plan was unpublished", () => {
    const handler = source.slice(source.indexOf("export const space_adminSetSetupPublished"));
    expect(handler).toContain('status !== "PUBLISHED"');
    expect(handler).toContain("changed: false");
  });
});
