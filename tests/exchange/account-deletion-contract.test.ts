import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("account deletion contract", () => {
  it("requires recent authentication and protects sole organization owners", async () => {
    const callable = await source("apps/functions/src/accountDeletion.ts");
    expect(callable).toContain("RECENT_AUTH_REQUIRED");
    expect(callable).toContain("SOLE_ORGANIZATION_OWNER");
    expect(callable).toContain("admin.auth().deleteUser(uid)");
  });

  it("removes private account records while preserving shared organizations", async () => {
    const callable = await source("apps/functions/src/accountDeletion.ts");
    for (const collection of [
      "users",
      "profiles",
      "publicProfiles",
      "orgMembers",
      "notifications",
      "savedExchangeItems",
      "verificationDocuments",
      "exchangeOnboardingEvents",
    ]) {
      expect(callable).toContain(`"${collection}"`);
    }
    expect(callable).not.toContain('db.collection("orgs").doc(orgId).delete');
  });

  it("routes deletion through the existing account callable", async () => {
    const [accounts, page] = await Promise.all([
      source("apps/functions/src/accounts.ts"),
      source("apps/web/src/app/account/page.tsx"),
    ]);
    expect(accounts).toContain('operation === "delete_account"');
    expect(accounts).toContain("deleteAccountForRequest(request)");
    expect(page).toContain('(functions, "account_initialize")');
    expect(page).toContain('operation: "delete_account"');
  });

  it("exposes a destructive confirmation UI from the authenticated dashboard", async () => {
    const [page, dashboard] = await Promise.all([
      source("apps/web/src/app/account/page.tsx"),
      source("apps/web/src/app/dashboard/page.tsx"),
    ]);
    expect(page).toContain('confirmation === "DELETE"');
    expect(page).toContain("reauthenticateWithCredential");
    expect(page).toContain("Permanently delete account");
    expect(dashboard).toContain('href="/account"');
    expect(dashboard).toContain("Account & privacy");
  });
});
