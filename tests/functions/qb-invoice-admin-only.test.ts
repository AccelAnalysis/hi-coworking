import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("payments_createQuickBooksInvoice", () => {
  const source = readFileSync("apps/functions/src/index.ts", "utf8");
  const start = source.indexOf("export const payments_createQuickBooksInvoice");
  const fn = source.slice(start, source.indexOf("createPayment(", start));

  it("rejects callers who are not admin or master before touching the ledger", () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn).toMatch(/callerRole !== "admin" && callerRole !== "master"/);
    expect(fn).toContain('"permission-denied"');
  });
});
