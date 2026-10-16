/** Reads the published fit form. Question wording stays in Firestore. */

export type FitOption = { value: string; label: string };
export type FitShowIf = { id: string; equals: string };
export type FitFieldType = "short" | "long" | "single" | "multi" | "scale" | "grid" | "datetime" | "url";
export type FitValue = string | string[] | Record<string, string>;

export type FitField = {
  id: string;
  prompt: string;
  section: string;
  type: FitFieldType;
  required: boolean;
  maxLength?: number;
  help?: string;
  note?: string;
  group?: string;
  options: FitOption[];
  rows: FitOption[];
  columns: FitOption[];
  showIf?: FitShowIf;
};

export type FitForm = {
  placeholder: boolean;
  draft: boolean;
  version: string;
  notice: string;
  openingScript: string;
  confidentialityNote: string;
  closingScript: string;
  closingNote: string;
  closingFollowUp: string;
  sections: { id: string; title: string }[];
  items: FitField[];
};

const TYPES = new Set<FitFieldType>(["short", "long", "single", "multi", "scale", "grid", "datetime", "url"]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function options(value: unknown): FitOption[] {
  if (!Array.isArray(value)) return [];
  const parsed: FitOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { value?: unknown; label?: unknown };
    const optionValue = String(row.value ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!optionValue || !label) continue;
    parsed.push({ value: optionValue, label });
  }
  return parsed;
}

export function readPowerNowFit(data: unknown): FitForm {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const items = Array.isArray(record.items) ? record.items : [];
  const parsed: FitField[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const prompt = String(row.prompt ?? "").trim();
    if (!id || !prompt) continue;
    const rawType = String(row.type ?? "");
    const type = TYPES.has(rawType as FitFieldType) ? rawType as FitFieldType : "long";
    const maxLength = Number(row.maxLength);
    const show = row.showIf && typeof row.showIf === "object"
      ? row.showIf as { id?: unknown; equals?: unknown }
      : null;
    const showId = String(show?.id ?? "").trim();
    const showEquals = String(show?.equals ?? "");
    parsed.push({
      id,
      prompt,
      section: String(row.section ?? "").trim(),
      type,
      required: row.required === true || (typeof row.required !== "boolean" && type !== "url"),
      ...(Number.isInteger(maxLength) && maxLength > 0 ? { maxLength } : {}),
      ...(text(row.help) ? { help: text(row.help) } : {}),
      ...(text(row.note) ? { note: text(row.note) } : {}),
      ...(text(row.group) ? { group: text(row.group) } : {}),
      options: options(row.options),
      rows: options(row.rows),
      columns: options(row.columns),
      ...(showId && showEquals !== "" ? { showIf: { id: showId, equals: showEquals } } : {}),
    });
  }
  const sections = Array.isArray(record.sections) ? record.sections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; title?: unknown };
    const id = String(row.id ?? "").trim();
    const title = String(row.title ?? "").trim();
    return id && title ? [{ id, title }] : [];
  }) : [];
  return {
    placeholder: record.placeholder === true,
    draft: record.draft === true,
    version: text(record.version),
    notice: text(record.notice),
    openingScript: text(record.openingScript),
    confidentialityNote: text(record.confidentialityNote),
    closingScript: text(record.closingScript),
    closingNote: text(record.closingNote),
    closingFollowUp: text(record.closingFollowUp),
    sections,
    items: parsed,
  };
}

export function fieldVisible(field: FitField, answers: Record<string, FitValue>): boolean {
  if (!field.showIf) return true;
  return answers[field.showIf.id] === field.showIf.equals;
}
