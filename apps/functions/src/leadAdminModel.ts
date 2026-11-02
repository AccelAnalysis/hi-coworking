/**
 * Pure helpers for the admin Leads page's intake rows. No firebase-admin
 * import, so tests can load this without emulators.
 *
 * intakeLeads (booth and Power NOW) rules deny every client read, so the
 * Admin page reads them through leadsAdmin_listIntake, which returns this
 * trimmed row shape instead of the raw document (no consent wording, UTM or
 * Attio bookkeeping).
 */

export const INTAKE_LIST_LIMIT = 500;
export const ADMIN_NOTES_MAX_LENGTH = 4000;

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

function isoToMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function toIntakeAdminRow(id: string, data: Record<string, unknown>): IntakeAdminRow {
  const kind = data.kind === "expo" || data.kind === "power-now" ? data.kind : "unknown";
  const interestsRaw = data.interests && typeof data.interests === "object" ? (data.interests as Record<string, unknown>) : {};
  const interests = Object.keys(interestsRaw).filter((key) => interestsRaw[key] === true).sort();

  const detailParts: string[] = [];
  if (kind === "power-now") {
    for (const part of [text(data.opportunityLabel), text(data.businessStageLabel)]) {
      if (part) detailParts.push(part);
    }
    const place = [text(data.city), text(data.stateCode)].filter(Boolean).join(", ");
    if (place) detailParts.push(place);
  } else {
    for (const part of [text(data.need), text(data.timing), text(data.orgTypeLabel)]) {
      if (part) detailParts.push(part);
    }
  }

  return {
    id,
    kind,
    name: text(data.fullName),
    email: text(data.email).toLowerCase(),
    phone: text(data.phoneOriginal) || text(data.phoneE164),
    organization: text(data.organization) || text(data.companyName),
    role: text(data.roleTitle),
    detail: detailParts.join(" · "),
    interests,
    event: text(data.event),
    source: text(data.source),
    createdAtMs: isoToMs(data.storedAt) ?? isoToMs(data.submittedAt),
    adminNotes: typeof data.adminNotes === "string" ? data.adminNotes : "",
  };
}

export function sortIntakeRows(rows: IntakeAdminRow[]): IntakeAdminRow[] {
  return [...rows].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type NotesUpdate = { ok: true; id: string; notes: string } | { ok: false; error: string };

export function parseNotesUpdate(input: unknown): NotesUpdate {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!DOC_ID.test(id)) return { ok: false, error: "A valid lead id is required." };
  if (typeof body.notes !== "string") return { ok: false, error: "notes must be a string." };
  if (body.notes.length > ADMIN_NOTES_MAX_LENGTH) {
    return { ok: false, error: `Notes can be at most ${ADMIN_NOTES_MAX_LENGTH} characters.` };
  }
  return { ok: true, id, notes: body.notes };
}

export function isAdminRole(role: unknown): boolean {
  return role === "admin" || role === "master";
}
