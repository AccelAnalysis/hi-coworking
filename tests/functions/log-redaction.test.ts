import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redactEmails, safeErrorForLog } from "../../apps/functions/src/logRedaction";

const read = (path: string) => readFileSync(path, "utf8");

describe("log redaction", () => {
  it("replaces email addresses in free text", () => {
    expect(redactEmails("No customer for Person.Name+tag@Example.co.uk, retry"))
      .toBe("No customer for [email], retry");
    expect(redactEmails(undefined)).toBe("");
    expect(redactEmails("x".repeat(600)).length).toBeLessThanOrEqual(501);
  });

  it("reduces Stripe-style errors to an email-free summary", () => {
    const error = Object.assign(new Error("No such customer with email someone@example.com"), {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      statusCode: 404,
      requestId: "req_123",
      raw: { param: "email", email: "someone@example.com" },
      headers: { authorization: "Bearer should-not-appear" },
    });
    const safe = safeErrorForLog(error);
    expect(safe).toEqual({
      name: "Error",
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      statusCode: 404,
      requestId: "req_123",
      message: "No such customer with email [email]",
    });
    expect(JSON.stringify(safe)).not.toContain("someone@example.com");
    expect(JSON.stringify(safe)).not.toContain("Bearer");
    expect(safeErrorForLog("plain a@b.co")).toEqual({ message: "plain [email]" });
  });

  it("is used where membership and QuickBooks code used to log raw emails or errors", () => {
    for (const path of [
      "apps/functions/src/adminMembershipAuthority.ts",
      "apps/functions/src/adminMemberOperationsAuthority.ts",
    ]) {
      const source = read(path);
      const block = source.slice(source.indexOf('"Could not resolve membership subscription by email"'));
      expect(block.slice(0, 200)).toContain("error: safeErrorForLog(error)");
    }
    const qbo = read("apps/functions/src/payments/qboAccountingSync.ts");
    expect(qbo).not.toMatch(/QBO customer creation failed", \{\s*email/);
    expect(qbo).toContain('logger.error("QBO customer creation failed", { paymentId, status: createResp.status })');
    expect(qbo).toContain("body: redactEmails(errBody)");
    expect(qbo).toContain("err: safeErrorForLog(err)");
  });
});
