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
      expect(callable).toContain(`\"${collection}\"`);
    }
    expect(callable).not.toContain('db.collection("orgs").doc(orgId).delete');
  });

  it("exposes a destructive confirmation UI from the account menu", async () => {
    const [page, shell] = await Promise.all([
      source("apps/web/src/app/account/page.tsx"),
      source("apps/web/src/components/AppShell.tsx"),
    ]);
    expect(page).toContain('confirmation === "DELETE"');
    expect(page).toContain("reauthenticateWithCredential");
    expect(page).toContain("Permanently delete account");
    expect(shell).toContain('href="/account"');
  });
});
