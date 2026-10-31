import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSayHiFlags } from "../../apps/web/src/lib/sayhiFlags";
import { ACCESS_CODE_HINT, accessCodeView } from "../../apps/web/src/lib/accessCodeView";
import { demoData, demoKind } from "../../apps/web/src/lib/sayhiDemo";

const read = (path: string) => readFileSync(path, "utf8");
/** Source without comments, so only shipped strings are checked. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const NOW = Date.UTC(2026, 10, 20, 15);
const HOUR = 3_600_000;
const grant = {
  grantId: "g1", bookingId: "b1", doorName: "Front door", startsAt: NOW - HOUR, endsAt: NOW + HOUR,
  grantStatus: "active", codeStatus: "active", codeLast2: "34", codeId: "c1",
};

describe("SayHi flags", () => {
  it("are all off when nothing is set (production)", () => {
    expect(resolveSayHiFlags({})).toEqual({ flow: false, virtualAddress: false, demo: false });
  });
  it("keeps the virtual address off unless the SayHi flow is also on", () => {
    expect(resolveSayHiFlags({ NEXT_PUBLIC_VIRTUAL_ADDRESS: "true" }).virtualAddress).toBe(false);
    expect(resolveSayHiFlags({ NEXT_PUBLIC_SAYHI_FLOW: "true" }).virtualAddress).toBe(false);
    expect(resolveSayHiFlags({ NEXT_PUBLIC_SAYHI_FLOW: "true", NEXT_PUBLIC_VIRTUAL_ADDRESS: "true" }).virtualAddress).toBe(true);
  });
  it("does not set any SayHi flag in committed env files", () => {
    for (const file of readdirSync("apps/web").filter((name) => name.startsWith(".env"))) {
      expect(read(join("apps/web", file))).not.toMatch(/NEXT_PUBLIC_(SAYHI_FLOW|VIRTUAL_ADDRESS|SAYHI_PREVIEW_DEMO)\s*=\s*true/i);
    }
  });
});

describe("door code visibility on SayHi", () => {
  it("shows the full code only when the server returned it for a live booking", () => {
    const view = accessCodeView({ ...grant, code: "482915" }, { now: NOW });
    expect(view).toMatchObject({ kind: "code", code: "482915", text: ACCESS_CODE_HINT });
    expect(accessCodeView({ ...grant, code: null }, { now: NOW }).kind).toBe("pending");
    expect(accessCodeView({ ...grant, code: "482915" }, { now: NOW + 2 * HOUR }).kind).toBe("ended");
    expect(accessCodeView(undefined, { now: NOW }).kind).toBe("pending");
  });
  it("never says the code was emailed or sent", () => {
    for (const state of [
      accessCodeView(undefined), accessCodeView({ ...grant, codeStatus: "failed" }, { now: NOW }),
      accessCodeView({ ...grant, code: "1234" }, { now: NOW }), accessCodeView(grant, { loading: true }),
    ]) {
      expect(state.text).not.toMatch(/email|sent|securely|stripe|tour/i);
    }
  });
  it("has no 'sent securely' line anywhere in the web app", () => {
    for (const file of walk("apps/web/src")) expect(read(file), file).not.toMatch(/sent securely/i);
  });
  it("keeps the front-desk card and kiosk free of a permanent check-in code", () => {
    const card = code("apps/web/src/components/kiosk/FrontDeskCard.tsx");
    expect(card).not.toMatch(/check-in code|checkInCode|door code/i);
    expect(code("apps/web/src/lib/frontDeskKiosk.ts")).not.toMatch(/checkInCode/);
  });
});

describe("customer copy", () => {
  const customerFiles = [
    "apps/web/src/app/account/bookings/page.tsx",
    "apps/web/src/app/book/complete/page.tsx",
    "apps/web/src/components/sayhi/AccessCodeBlock.tsx",
    "apps/web/src/components/sayhi/AccessCodeStack.tsx",
    "apps/web/src/app/register/page.tsx",
    "apps/web/src/app/virtual-address/page.tsx",
    "apps/web/src/components/PaymentMethodSelector.tsx",
    "apps/web/src/components/BillingPortalButton.tsx",
  ];
  it("never mentions Stripe, emailing a code, or tours", () => {
    for (const file of customerFiles) {
      const source = code(file).replace(/import[^;]+;/g, "");
      const strings = source.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g)?.join(" ") ?? "";
      const literals = source.match(/"[^"\n]*"|`[^`]*`/g)?.filter((s) => /\s/.test(s)).join(" ") ?? "";
      const visible = `${strings} ${literals}`;
      expect(visible, file).not.toMatch(/\bStripe\b/);
      expect(visible, file).not.toMatch(/\btour\b/i);
      expect(visible, file).not.toMatch(/emailed|sent to your email|check your email for (your|the) code/i);
    }
  });
  it("writes SayHi as one word", () => {
    for (const file of customerFiles) expect(read(file), file).not.toMatch(/Say Hi\b|My Hi\b/);
  });
  it("sends a finished booking to the SayHi page", () => {
    const complete = read("apps/web/src/app/book/complete/page.tsx");
    expect(complete).toContain('const SAYHI_AFTER_BOOKING = "/my-hi?booked=1#bookings"');
    expect(complete).toContain("window.location.replace(SAYHI_AFTER_BOOKING)");
    expect(complete).not.toMatch(/export const SAYHI_AFTER_BOOKING/);
  });
});

describe("preview demo", () => {
  it("only runs behind the preview flag and only with a known ?demo value", () => {
    expect(read("apps/web/src/app/account/bookings/page.tsx")).toContain("SAYHI_PREVIEW_DEMO ? demoKind(");
    expect(demoKind("?demo=member")).toBe("member");
    expect(demoKind("?demo=admin")).toBeNull();
    expect(demoKind("")).toBeNull();
  });
  it("uses fictional sample data with no real people or contact details", () => {
    const sample = JSON.stringify([demoData("member", NOW), demoData("guest", NOW)]);
    expect(sample).not.toMatch(/@|\+1\d{10}|\(\d{3}\)/);
  });
});

describe("Jessica's follow-up queue in Admin", () => {
  const page = read("apps/web/src/app/admin/follow-ups/page.tsx");
  it("is admin-only and reads staffFollowUps", () => {
    expect(page).toContain('requiredRole="admin"');
    expect(page).toContain("collection(db, FOLLOW_UPS_COLLECTION)");
    expect(read("apps/web/src/lib/followUps.ts")).toContain('FOLLOW_UPS_COLLECTION = "staffFollowUps"');
  });
  it("never implies software confirms a Form 1583 signature", () => {
    const visible = code("apps/web/src/app/admin/follow-ups/page.tsx") + code("apps/web/src/lib/followUps.ts");
    expect(visible).not.toMatch(/\b(AI|bot|automatic(ally)?)\b[^.]{0,40}(sign|confirm)/i);
    const va = code("apps/web/src/app/virtual-address/page.tsx");
    expect(va).toMatch(/member of the Hi Coworking team confirms your signature with you live/);
    expect(va).toContain("notary");
  });
});

describe("virtual address stays hidden while off", () => {
  it("gates the pricing option, pop-up, register redirect and Form 1583 page on the flag", () => {
    const pricing = read("apps/web/src/app/pricing/page.tsx");
    expect(pricing).toContain("{VIRTUAL_ADDRESS ? (");
    expect(pricing).toContain("if (VIRTUAL_ADDRESS && !isVirtualOffice && !vaChosen) setVaOfferFor(tier.id);");
    expect(read("apps/web/src/app/virtual-address/page.tsx")).toContain("if (!VIRTUAL_ADDRESS) {");
    expect(read("apps/web/src/lib/sayhiAccount.ts")).toContain("VIRTUAL_ADDRESS && virtualAddressChoice() === true");
    const sayhi = read("apps/web/src/app/account/bookings/page.tsx");
    expect(sayhi).toMatch(/VIRTUAL_ADDRESS \?/);
  });
  it("keeps the pricing success URL", () => {
    expect(read("apps/web/src/lib/sayhiAccount.ts")).toContain("/my-hi?payment=success&plan=${encodeURIComponent(tierId)}");
  });
});
