import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTES_MAX_LENGTH,
  isAdminRole,
  parseNotesUpdate,
  sortIntakeRows,
  toIntakeAdminRow,
} from "../../apps/functions/src/leadAdminModel";

const read = (path: string) => readFileSync(path, "utf8");

describe("intake leads for the admin Leads page", () => {
  it("trims an expo booth document to the admin row", () => {
    const row = toIntakeAdminRow("id-1", {
      kind: "expo",
      fullName: " Eve Booth ",
      email: "Eve@Example.com",
      phoneOriginal: "(555) 010-0000",
      organization: "Example Org",
      roleTitle: "Founder",
      need: "Desk space",
      timing: "This month",
      orgTypeLabel: "Startup",
      interests: { coworking: true, events: false, office: true },
      consent: [{ key: "email", optIn: true, wording: "long consent text" }],
      event: "Expo",
      source: "booth",
      storedAt: "2026-10-20T15:00:00.000Z",
      submittedAt: "2026-10-20T14:59:00.000Z",
    });
    expect(row).toEqual({
      id: "id-1",
      kind: "expo",
      name: "Eve Booth",
      email: "eve@example.com",
      phone: "(555) 010-0000",
      organization: "Example Org",
      role: "Founder",
      detail: "Desk space · This month · Startup",
      interests: ["coworking", "office"],
      event: "Expo",
      source: "booth",
      createdAtMs: Date.parse("2026-10-20T15:00:00.000Z"),
      adminNotes: "",
    });
    expect(JSON.stringify(row)).not.toContain("consent");
  });

  it("describes a Power NOW lead by opportunity, stage and place", () => {
    const row = toIntakeAdminRow("id-2", {
      kind: "power-now",
      fullName: "Pat Power",
      email: "pat@example.com",
      companyName: "Pat Co",
      opportunityLabel: "Pitch",
      businessStageLabel: "Idea",
      city: "Hampton",
      stateCode: "VA",
      interests: { pitch: true, watch: false, contribute: false },
      submittedAt: "2026-10-21T10:00:00.000Z",
      adminNotes: "Follow up",
    });
    expect(row.kind).toBe("power-now");
    expect(row.organization).toBe("Pat Co");
    expect(row.detail).toBe("Pitch · Idea · Hampton, VA");
    expect(row.interests).toEqual(["pitch"]);
    expect(row.createdAtMs).toBe(Date.parse("2026-10-21T10:00:00.000Z"));
    expect(row.adminNotes).toBe("Follow up");
  });

  it("sorts rows newest first and puts undated rows last", () => {
    const rows = [
      toIntakeAdminRow("a", { kind: "expo", storedAt: "2026-10-01T00:00:00Z" }),
      toIntakeAdminRow("b", { kind: "expo" }),
      toIntakeAdminRow("c", { kind: "power-now", storedAt: "2026-10-02T00:00:00Z" }),
    ];
    expect(sortIntakeRows(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("validates a notes update", () => {
    expect(parseNotesUpdate({ id: "abc-123", notes: "Called" })).toEqual({ ok: true, id: "abc-123", notes: "Called" });
    expect(parseNotesUpdate({ id: "../x", notes: "" }).ok).toBe(false);
    expect(parseNotesUpdate({ id: "abc", notes: 5 }).ok).toBe(false);
    expect(parseNotesUpdate({ id: "abc", notes: "x".repeat(ADMIN_NOTES_MAX_LENGTH + 1) }).ok).toBe(false);
  });

  it("only admin and master roles pass", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("master")).toBe(true);
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("lead-admin deploy isolation", () => {
  it("requires an admin role in both callables and keeps intakeLeads client-closed", () => {
    const source = read("apps/functions/src/leadAdmin.ts");
    expect(source.match(/requireAdmin\(request\)/g)).toHaveLength(2);
    const rules = read("firestore.rules");
    expect(rules).toMatch(/match \/intakeLeads\/\{leadId\} \{\s*allow read, write: if false;/);
  });

  it("deploys only the lead-admin functions from an entry with no new secrets", () => {
    const entry = read("firebase/lead-admin-functions/src/index.ts");
    expect(entry).toContain(
      'export { leadsAdmin_listIntake, leadsAdmin_setIntakeNotes } from "../../../apps/functions/src/leadAdmin"',
    );
    expect(read("apps/functions/src/leadAdmin.ts")).not.toContain("defineSecret");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["deploy:lead-admin"]).toBe(
      "firebase deploy --config firebase.lead-admin.json --project hi-coworking-plat --only functions:leadsAdmin_listIntake,functions:leadsAdmin_setIntakeNotes,functions:intake_onNewLead",
    );
    expect(read("apps/functions/src/main.ts")).toContain(
      'export { leadsAdmin_listIntake, leadsAdmin_setIntakeNotes } from "./leadAdmin"',
    );
  });
});
