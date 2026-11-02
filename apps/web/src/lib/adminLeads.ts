/**
 * Shapes for /admin/leads, which lists web leads (Firestore leads: early
 * access, survey, contact) and booth / Power NOW intake leads (intakeLeads,
 * read through the leadsAdmin_listIntake callable) in one list.
 */
import { csvCell } from "@/lib/rosterCsv";
import { surveyQuestionText } from "@/lib/surveyQuestions";

export type LeadKind = "early_access" | "survey" | "contact" | "expo" | "power-now" | "other";
export type LeadFilter = "all" | LeadKind;
export type LeadOrigin = "leads" | "intakeLeads";

export const LEAD_FILTER_OPTIONS: Array<{ value: LeadFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "early_access", label: "Early Access" },
  { value: "survey", label: "Survey" },
  { value: "contact", label: "Contact" },
  { value: "expo", label: "Expo booth" },
  { value: "power-now", label: "Power NOW" },
];

/** Filters that are answered by the Firestore leads collection. */
export const WEB_LEAD_TYPES: LeadKind[] = ["early_access", "survey", "contact"];
/** Filters that are answered by intakeLeads. */
export const INTAKE_LEAD_TYPES: LeadKind[] = ["expo", "power-now"];

export type UnifiedLead = {
  key: string;
  origin: LeadOrigin;
  id: string;
  kind: LeadKind;
  name: string;
  email: string;
  phone: string;
  organization: string;
  detail: string;
  message: string;
  interests: string[];
  intent: string;
  source: string;
  version: string;
  interestScore: number | null;
  recaptchaScore: number | null;
  surveyAnswers: Record<string, unknown> | null;
  createdAtMs: number | null;
  adminNotes: string;
};

export type IntakeAdminRow = {
  id: string;
  kind: "expo" | "power-now" | "unknown";
  name: string;
  email: string;
  phone: string;
  organization: string;
  role: string;
  detail: string;
  interests: string[];
  event: string;
  source: string;
  createdAtMs: number | null;
  adminNotes: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis(): number }).toMillis();
  }
  return null;
}

function webKind(type: unknown): LeadKind {
  return type === "early_access" || type === "survey" || type === "contact" ? type : "other";
}

export function fromLeadDoc(id: string, data: Record<string, unknown>): UnifiedLead {
  const answers = data.surveyAnswers && typeof data.surveyAnswers === "object" ? (data.surveyAnswers as Record<string, unknown>) : null;
  return {
    key: `leads/${id}`,
    origin: "leads",
    id,
    kind: webKind(data.type),
    name: text(data.name),
    email: text(data.email),
    phone: text(data.phone),
    organization: text(data.company),
    detail: "",
    message: text(data.message),
    interests: Array.isArray(data.interests) ? data.interests.filter((i): i is string => typeof i === "string") : [],
    intent: text(data.intent),
    source: text(data.source),
    version: text(data.version),
    interestScore: finiteNumber(data.interestScore),
    recaptchaScore: finiteNumber(data.recaptchaScore),
    surveyAnswers: answers && Object.keys(answers).length > 0 ? answers : null,
    createdAtMs: timestampMs(data.createdAt),
    adminNotes: typeof data.adminNotes === "string" ? data.adminNotes : "",
  };
}

export function fromIntakeRow(row: IntakeAdminRow): UnifiedLead {
  return {
    key: `intakeLeads/${row.id}`,
    origin: "intakeLeads",
    id: row.id,
    kind: row.kind === "expo" || row.kind === "power-now" ? row.kind : "other",
    name: row.name,
    email: row.email,
    phone: row.phone,
    organization: [row.organization, row.role].filter(Boolean).join(" · "),
    detail: row.detail,
    message: "",
    interests: row.interests,
    intent: "",
    source: [row.source, row.event].filter(Boolean).join(" · "),
    version: "",
    interestScore: null,
    recaptchaScore: null,
    surveyAnswers: null,
    createdAtMs: row.createdAtMs,
    adminNotes: row.adminNotes,
  };
}

export function mergeLeads(...lists: UnifiedLead[][]): UnifiedLead[] {
  return lists.flat().sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

export function filterLeads(leads: UnifiedLead[], filter: LeadFilter, search: string): UnifiedLead[] {
  const term = search.trim().toLowerCase();
  return leads.filter((lead) => {
    if (filter !== "all" && lead.kind !== filter) return false;
    if (!term) return true;
    return [lead.name, lead.email, lead.organization].some((value) => value.toLowerCase().includes(term));
  });
}

export function leadKindLabel(kind: LeadKind): string {
  switch (kind) {
    case "early_access":
      return "Early Access";
    case "survey":
      return "Survey";
    case "contact":
      return "Contact";
    case "expo":
      return "Expo booth";
    case "power-now":
      return "Power NOW";
    default:
      return "Other";
  }
}

export function leadDisplayName(lead: Pick<UnifiedLead, "name" | "email" | "kind">): string {
  if (lead.name) return lead.name;
  if (lead.kind === "survey") return "Anonymous respondent";
  return lead.email ? lead.email : "No name given";
}

export type ReadableAnswer = { id: string; question: string; answer: string };

function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

export function readableSurveyAnswers(answers: Record<string, unknown> | null): ReadableAnswer[] {
  if (!answers) return [];
  return Object.keys(answers)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((id) => ({ id, question: surveyQuestionText(id), answer: answerText(answers[id]) }))
    .filter((row) => row.answer !== "");
}

export const LEADS_CSV_HEADER = [
  "Type",
  "Name",
  "Email",
  "Phone",
  "Organization",
  "Details",
  "Interests",
  "Message",
  "Intent",
  "Interest score",
  "Source",
  "Survey answers",
  "Notes",
  "Created (UTC)",
  "Record",
];

export function leadsCsv(leads: UnifiedLead[]): string {
  const rows = leads.map((lead) => [
    leadKindLabel(lead.kind),
    lead.name,
    lead.email,
    lead.phone,
    lead.organization,
    lead.detail,
    lead.interests.join("; "),
    lead.message,
    lead.intent,
    lead.interestScore ?? "",
    lead.source,
    readableSurveyAnswers(lead.surveyAnswers)
      .map((row) => `${row.question}: ${row.answer}`)
      .join(" | "),
    lead.adminNotes,
    lead.createdAtMs ? new Date(lead.createdAtMs).toISOString() : "",
    lead.key,
  ]);
  return [LEADS_CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function leadsCsvFilename(filter: LeadFilter, now: Date = new Date()): string {
  return `hi-coworking-leads-${filter === "all" ? "all" : filter}-${now.toISOString().slice(0, 10)}.csv`;
}
