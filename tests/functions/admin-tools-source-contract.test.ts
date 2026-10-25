import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NURTURE_POSTAL_ADDRESS, NURTURE_ROUTE_ALIASES, campaignHref } from "../../apps/functions/src/nurtureLinks";

const read = (file: string) => readFileSync(file, "utf8");

describe("nurture email links", () => {
  const origin = "https://hi-coworking.com";

  it("rewrites retired routes saved in older campaign documents", () => {
    expect(campaignHref(origin, "/visit")).toBe(`${origin}/contact`);
    expect(campaignHref(origin, "/membership/")).toBe(`${origin}/pricing`);
    expect(campaignHref(origin, "/dashboard/membership?src=nurture#plans")).toBe(`${origin}/my-hi?src=nurture#plans`);
    expect(campaignHref(origin, "/events")).toBe(`${origin}/events`);
  });

  it("refuses external or protocol-relative links", () => {
    expect(campaignHref(origin, "https://evil.example")).toBeUndefined();
    expect(campaignHref(origin, "//evil.example")).toBeUndefined();
    expect(campaignHref(origin, undefined)).toBeUndefined();
  });

  it("only aliases to routes that exist in the web app", () => {
    for (const target of new Set(Object.values(NURTURE_ROUTE_ALIASES))) {
      const dir = `apps/web/src/app${target}`;
      expect(() => read(`${dir}/page.tsx`)).not.toThrow();
    }
  });

  it("puts the postal address in both the HTML and text footers", () => {
    const source = read("apps/functions/src/nurture.ts");
    expect(NURTURE_POSTAL_ADDRESS).toContain("Carrollton");
    expect(source.match(/NURTURE_POSTAL_ADDRESS/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(/nurture_scanLifecycle = onSchedule\(\s*\{\s*schedule: "every day 09:00",\s*timeZone: "America\/New_York"/);
  });
});

describe("bookstore reservations", () => {
  const commerce = read("apps/functions/src/bookstoreCommerce.ts");
  const cancel = read("apps/functions/src/bookstoreCancel.ts");

  it("clears reservationExpiresAt whenever an order leaves pending payment", () => {
    // release, finalize, the sweep's cleanup of finished orders
    expect(commerce.match(/reservationExpiresAt: FieldValue\.delete\(\)/g)).toHaveLength(3);
    expect(cancel).toContain("reservationExpiresAt: FieldValue.delete()");
  });

  it("closes the Stripe Checkout Session before putting stock back", () => {
    expect(commerce).toContain("stripe.checkout.sessions.expire(sessionId)");
    expect(commerce).toMatch(/if \(sessionState === "completed"\) continue;/);
    expect(commerce).toMatch(/schedule: "every 15 minutes", secrets: \[stripeSecretKey\]/);
  });

  it("only sends Stripe customers back to Hi Coworking pages", () => {
    expect(commerce).toContain("isBookstoreReturnUrl(text)");
    expect(commerce).toContain('"https://hi-coworking.com"');
    expect(commerce).not.toMatch(/url\.protocol !== "https:" && url\.protocol !== "http:"/);
  });
});

describe("Firestore sentinels", () => {
  it("use the modular FieldValue, which is defined at runtime", () => {
    for (const file of ["bookstoreCommerce.ts", "bookstoreCancel.ts", "eventSeries.ts", "spaceCatalog.ts", "nurture.ts"]) {
      expect(read(`apps/functions/src/${file}`)).not.toMatch(/admin\.firestore\.(FieldValue|Timestamp|FieldPath)/);
    }
  });
});

describe("published setups", () => {
  const catalog = read("apps/functions/src/spaceCatalog.ts");

  it("does not rely on a collection-group index", () => {
    expect(catalog).not.toContain(".collectionGroup(");
  });

  it("returns only public fields to customers", () => {
    const start = catalog.indexOf("export const space_getPublishedCatalog");
    const handler = catalog.slice(start, catalog.indexOf("export const space_adminGetCatalog"));
    expect(handler).toContain("publicSetup(");
    expect(handler).toContain("publicAddOn(");
    expect(handler).not.toContain("...doc.data()");
    const publicSetup = catalog.slice(catalog.indexOf("export function publicSetup"), catalog.indexOf("export function publicAddOn"));
    expect(publicSetup).not.toMatch(/updatedBy|createdAt/);
  });

  it("checks the resource is on the layout and the Stripe price id shape", () => {
    expect(catalog).toContain("Choose a resource that is placed on this layout.");
    expect(catalog).toContain("/^price_[A-Za-z0-9]{6,}$/");
  });
});

describe("no new composite indexes", () => {
  it("sorts series occurrences and book purchases on the client", () => {
    const firestore = read("apps/web/src/lib/firestore.ts");
    const occurrences = firestore.slice(firestore.indexOf("export async function getSeriesOccurrences"));
    expect(occurrences.slice(0, occurrences.indexOf("\n}\n"))).not.toContain("orderBy(");
    const purchases = firestore.slice(firestore.indexOf("export async function getUserBookPurchases"));
    expect(purchases.slice(0, purchases.indexOf("\n}\n"))).not.toContain("orderBy(");
  });
});
