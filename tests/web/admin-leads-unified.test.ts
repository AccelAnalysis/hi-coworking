import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEAD_FILTER_OPTIONS,
  filterLeads,
  fromIntakeRow,
  fromLeadDoc,
  leadDisplayName,
  leadKindLabel,
  leadsCsv,
  leadsCsvFilename,
  mergeLeads,
  readableSurveyAnswers,
} from "@/lib/adminLeads";
import { SURVEY_QUESTIONS, surveyQuestionText } from "@/lib/surveyQuestions";

const page = readFileSync("apps/web/src/app/admin/leads/page.tsx", "utf8");

const contact = fromLeadDoc("c1", {
  id: "c1",
  type: "contact",
  name: "Casey Contact",
  email: "casey@example.com",
  message: "Do you have a room on Friday?",
  createdAt: 3_000,
});
const survey = fromLeadDoc("s1", {
  id: "s1",
  type: "survey",
  name: "",
  email: "",
  surveyAnswers: { 2: ["Wi-Fi", "Quiet"], 1: "From home", 10: "  " },
  createdAt: 1_000,
});
const expo = fromIntakeRow({
  id: "e1",
  kind: "expo",
  name: "Eve Booth",
  email: "eve@example.com",
  phone: "",
  organization: "Example Org",
  role: "Founder",
  detail: "Desk space",
  interests: ["coworking"],
  event: "Expo",
  source: "booth",
  createdAtMs: 2_000,
  adminNotes: "Called back",
});
const powerNow = fromIntakeRow({
  id: "p1",
  kind: "power-now",
  name: "Pat Power",
  email: "pat@example.com",
  phone: "",
  organization: "",
  role: "",
  detail: "",
  interests: ["pitch"],
  event: "",
  source: "power-now",
  createdAtMs: 4_000,
  adminNotes: "",
});

describe("admin leads: one list for web and intake leads", () => {
  it("labels contact leads as Contact (not Survey) and every intake kind", () => {
    expect(contact.kind).toBe("contact");
    expect(leadKindLabel(contact.kind)).toBe("Contact");
    expect(leadKindLabel("expo")).toBe("Expo booth");
    expect(leadKindLabel("power-now")).toBe("Power NOW");
    expect(page).not.toContain('lead.type === "early_access" ? "Early Access" : "Survey"');
  });

  it("offers Contact, Expo booth and Power NOW filters", () => {
    expect(LEAD_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      "all",
      "early_access",
      "survey",
      "contact",
      "expo",
      "power-now",
    ]);
  });

  it("merges both sources newest first and keys rows by collection", () => {
    const merged = mergeLeads([contact, survey], [expo, powerNow]);
    expect(merged.map((l) => l.key)).toEqual(["intakeLeads/p1", "leads/c1", "intakeLeads/e1", "leads/s1"]);
  });

  it("filters by type and searches name, email and organization", () => {
    const merged = mergeLeads([contact, survey], [expo, powerNow]);
    expect(filterLeads(merged, "contact", "").map((l) => l.id)).toEqual(["c1"]);
    expect(filterLeads(merged, "all", "example org").map((l) => l.id)).toEqual(["e1"]);
    expect(filterLeads(merged, "power-now", "").map((l) => l.id)).toEqual(["p1"]);
  });

  it("shows an anonymous survey respondent instead of a blank or placeholder", () => {
    expect(leadDisplayName(survey)).toBe("Anonymous respondent");
  });
});

describe("admin leads: readable survey answers", () => {
  it("maps answer ids to question text, joins lists and drops blanks", () => {
    const rows = readableSurveyAnswers(survey.surveyAnswers);
    expect(rows).toEqual([
      { id: "1", question: SURVEY_QUESTIONS[0].question, answer: "From home" },
      { id: "2", question: surveyQuestionText(2), answer: "Wi-Fi, Quiet" },
    ]);
    expect(page).not.toContain("JSON.stringify(lead.surveyAnswers");
  });

  it("falls back to a numbered label for an unknown question id", () => {
    expect(surveyQuestionText(99)).toBe("Question 99");
  });
});

describe("admin leads: CSV export", () => {
  it("exports every filtered lead with notes and readable answers", () => {
    const csv = leadsCsv([expo, survey]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Notes"');
    expect(lines[1]).toContain('"Expo booth"');
    expect(lines[1]).toContain('"Called back"');
    expect(lines[2]).toContain(`${SURVEY_QUESTIONS[0].question}: From home`);
  });

  it("neutralises spreadsheet formulas in lead text", () => {
    const evil = fromLeadDoc("x", { type: "contact", name: "=HYPERLINK(1)", createdAt: 1 });
    expect(leadsCsv([evil])).toContain(`"'=HYPERLINK(1)"`);
  });

  it("names the file after the filter and date", () => {
    expect(leadsCsvFilename("contact", new Date("2026-11-02T12:00:00Z"))).toBe("hi-coworking-leads-contact-2026-11-02.csv");
  });
});

describe("admin leads page wiring", () => {
  it("reads intake leads only through the admin callables", () => {
    expect(page).toContain('"leadsAdmin_listIntake"');
    expect(page).toContain('"leadsAdmin_setIntakeNotes"');
    expect(page).not.toContain('collection(db, "intakeLeads")');
  });

  it("saves web lead notes on the lead document", () => {
    expect(page).toContain('updateDoc(doc(db, "leads", lead.id), { adminNotes: notes');
  });

  it("filters web leads by type with the type + createdAt index", () => {
    expect(page).toContain('where("type", "==", typeFilter)');
    const indexes = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order?: string }> }>;
    };
    expect(indexes.indexes).toContainEqual(
      expect.objectContaining({
        collectionGroup: "leads",
        fields: [
          { fieldPath: "type", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      }),
    );
  });
});
