import { csvCell } from "@/lib/rosterCsv";
import {
  FOUND_US_OPTIONS,
  IMPROVE_OPTIONS,
  PURPOSE_OPTIONS,
  QUESTION_LABELS,
  RATING_ROWS,
  RATING_SCALE,
  RETURN_OPTIONS,
  VISIT_FEEDBACK_COLLECTION,
  WORKED_OPTIONS,
  optionLabel,
} from "@/lib/visitFeedbackQuestions";

export { VISIT_FEEDBACK_COLLECTION };

export type VisitFeedbackStatus = "invited" | "sent" | "failed" | "submitted";

export type VisitFeedbackRow = {
  id: string;
  bookingId: string;
  email: string;
  firstName: string;
  audience: "guest" | "member";
  visitStart: number | null;
  visitEnd: number | null;
  resourceName: string;
  status: VisitFeedbackStatus;
  invitedAt: number | null;
  submittedAt: number | null;
  nps: number | null;
  followupConsent: boolean | null;
  followupEmail: string | null;
  answers: Record<string, unknown> | null;
  adminNotes: string;
  createdAt: number | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ms(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function fromVisitFeedbackDoc(id: string, data: Record<string, unknown>): VisitFeedbackRow {
  const status = data.status === "sent" || data.status === "failed" || data.status === "submitted" ? data.status : "invited";
  const answers = data.answers && typeof data.answers === "object" ? data.answers as Record<string, unknown> : null;
  return {
    id,
    bookingId: text(data.bookingId),
    email: text(data.email),
    firstName: text(data.firstName),
    audience: data.audience === "member" ? "member" : "guest",
    visitStart: ms(data.visitStart),
    visitEnd: ms(data.visitEnd),
    resourceName: text(data.resourceName),
    status,
    invitedAt: ms(data.invitedAt),
    submittedAt: ms(data.submittedAt),
    nps: ms(data.nps),
    followupConsent: typeof data.followupConsent === "boolean" ? data.followupConsent : null,
    followupEmail: text(data.followupEmail) || null,
    answers,
    adminNotes: text(data.adminNotes),
    createdAt: ms(data.createdAt),
  };
}

export function displayName(row: VisitFeedbackRow): string {
  return row.firstName || "Visitor";
}

export function formatEastern(msValue: number | null): string {
  if (!msValue) return "—";
  return new Date(msValue).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}

function formatList(values: unknown, options: readonly { value: string; label: string }[]): string {
  if (!Array.isArray(values)) return "";
  return values.map((value) => optionLabel(options, String(value))).join(", ");
}

export function readableAnswers(row: VisitFeedbackRow): Array<{ question: string; answer: string }> {
  const answers = row.answers;
  if (!answers) return [];
  const purpose = optionLabel(PURPOSE_OPTIONS, String(answers.purpose || ""));
  const purposeOther = text(answers.purposeOther);
  const found = optionLabel(FOUND_US_OPTIONS, String(answers.foundUs || ""));
  const foundOther = text(answers.foundUsOther);
  const ratings = answers.ratings && typeof answers.ratings === "object"
    ? RATING_ROWS.map((rowDef) => {
      const value = optionLabel(RATING_SCALE, String((answers.ratings as Record<string, unknown>)[rowDef.value] || ""));
      return `${rowDef.label}: ${value}`;
    }).join("; ")
    : "";
  const worked = formatList(answers.worked, WORKED_OPTIONS);
  const workedOther = text(answers.workedOther);
  const improve = formatList(answers.improve, IMPROVE_OPTIONS);
  const improveOther = text(answers.improveOther);
  const ret = optionLabel(RETURN_OPTIONS, String(answers.returnLikelihood || ""));
  return [
    { question: QUESTION_LABELS.purpose, answer: purposeOther ? `${purpose} — ${purposeOther}` : purpose },
    { question: QUESTION_LABELS.foundUs, answer: foundOther ? `${found} — ${foundOther}` : found },
    { question: QUESTION_LABELS.ratings, answer: ratings },
    { question: QUESTION_LABELS.worked, answer: [worked, workedOther].filter(Boolean).join(" — ") },
    { question: QUESTION_LABELS.improve, answer: [improve, improveOther].filter(Boolean).join(" — ") },
    { question: QUESTION_LABELS.returnLikelihood, answer: ret },
    { question: QUESTION_LABELS.nps, answer: row.nps === null ? "" : String(row.nps) },
    { question: QUESTION_LABELS.comments, answer: text(answers.comments) },
    { question: "Follow-up consent", answer: row.followupConsent ? "Yes" : "No" },
  ].filter((item) => item.answer);
}

export function visitFeedbackCsv(rows: VisitFeedbackRow[]): string {
  const header = [
    "Status",
    "Name",
    "Email",
    "Audience",
    "Booking ID",
    "Visit date (ET)",
    "Space",
    "NPS",
    "Follow-up consent",
    "Follow-up email",
    "Answers",
    "Notes",
    "Submitted (ET)",
    "Invited (ET)",
    "Record",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const answers = readableAnswers(row).map((item) => `${item.question}: ${item.answer}`).join(" | ");
    lines.push([
      row.status,
      displayName(row),
      row.email,
      row.audience,
      row.bookingId,
      formatEastern(row.visitStart),
      row.resourceName,
      row.nps === null ? "" : String(row.nps),
      row.followupConsent ? "yes" : "no",
      row.followupConsent ? (row.followupEmail || row.email) : "",
      answers,
      row.adminNotes,
      formatEastern(row.submittedAt),
      formatEastern(row.invitedAt),
      `visitFeedback/${row.id}`,
    ].map(csvCell).join(","));
  }
  return lines.join("\n");
}

export function matchesVisitFeedbackSearch(row: VisitFeedbackRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.firstName, row.email, row.bookingId, row.resourceName, row.adminNotes]
    .some((value) => value.toLowerCase().includes(needle));
}
