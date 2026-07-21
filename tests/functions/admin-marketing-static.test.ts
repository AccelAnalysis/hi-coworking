import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const source = (path: string) => readFile(resolve(root, path), "utf8");

describe("administrative marketing email source boundaries", () => {
  it("contains no active SendGrid or Twilio provider source", async () => {
    const files = [
      "apps/functions/src/providers/emailProvider.ts",
      "apps/functions/src/eventMarketing.ts",
      "apps/functions/src/adminMarketingEmail.ts",
      "apps/functions/src/firebaseEntry.ts",
    ];
    const combined = (await Promise.all(files.map(source))).join("\n");
    expect(combined).not.toMatch(/SENDGRID_API_KEY|SendGridProvider|api\.sendgrid\.com/i);
    expect(combined).not.toMatch(/TWILIO_ACCOUNT_SID|TwilioSmsProvider|api\.twilio\.com/i);
  });

  it("does not grant a marketing capability during member signup", async () => {
    const functionsIndex = await source("apps/functions/src/index.ts");
    const authProvisioning = functionsIndex.slice(
      functionsIndex.indexOf("export const authBeforeCreate"),
      functionsIndex.indexOf("// --- Admin: Set User Role"),
    );
    expect(authProvisioning).toContain('customClaims: { role: "member" }');
    expect(authProvisioning).not.toContain("adminMarketingEmail");
  });

  it("contains no member mailbox connection or delegated OAuth UI", async () => {
    const files = [
      "apps/web/src/app/admin/marketing/email/page.tsx",
      "apps/web/src/app/email-preferences/page.tsx",
      "apps/web/src/lib/adminMarketingFunctions.ts",
    ];
    const combined = (await Promise.all(files.map(source))).join("\n");
    expect(combined).not.toMatch(/connect (?:your )?(?:outlook|microsoft|gmail|mailbox)/i);
    expect(combined).not.toMatch(/authorizationCode|oauthCallback|delegatedPermission/i);
    expect(combined).not.toContain("memberMailboxConnectionsEnabled: true");
  });

  it("keeps Microsoft credentials outside Firebase deployment secret bindings", async () => {
    const marketing = await source("apps/functions/src/adminMarketingEmail.ts");
    expect(marketing).not.toContain('defineSecret("MICROSOFT');
    expect(marketing).toContain("secretmanager.googleapis.com");
  });
});
