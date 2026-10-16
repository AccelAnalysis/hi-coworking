import { POWER_NOW_CRITERIA, POWER_NOW_FIT_QUESTIONS, POWER_NOW_NIGHTS } from "./powerNowApproved";
import { PITCH_COMPETITION_LIST } from "./powerNowModel";

export { POWER_NOW_CRITERIA, POWER_NOW_FIT_QUESTIONS, POWER_NOW_NIGHTS };
export const POWER_NOW_CRITERIA_PART_B = POWER_NOW_CRITERIA;

const ATTIO_BASE = "https://api.attio.com/v2";

export const POWER_NOW_SCORE_PATH = "/power-now/score";
export const POWER_NOW_RUBRIC_PATH = "/power-now/rubric";
export const POWER_NOW_RESULTS_PATH = "/power-now/results";
export const POWER_NOW_COMMENT_MAX = 2000;
export const POWER_NOW_SLUG = /^[A-Za-z0-9-]{1,64}$/;

/** Night operations config. Jonathan can edit the Firestore document without a code change. */
export const POWER_NOW_SETTINGS = {
  draft: true,
  scoringLockTime: "19:50",
  timeZone: "America/Chicago",
  tieBreak: ["j5-execution", "j2-customer-market", "j1-opportunity", "judge-preference", "jonathan"],
} as const;

const REPLACED_CRITERIA_VERSIONS = new Set(["part-b-2026-10-15", "v2-draft-2026-10-15"]);

export class PowerNowInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PowerNowInputError";
  }
}

export type FitOption = { value: string; label: string };
export type FitShowIf = { id: string; equals: string };
export type FitFieldType = "short" | "long" | "single" | "multi" | "scale" | "grid" | "datetime" | "url";
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
  options?: FitOption[];
  rows?: FitOption[];
  columns?: FitOption[];
  showIf?: FitShowIf;
};
export type FitAnswer = string | string[] | Record<string, string>;
export type FitDocument = {
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
export type FitQuestion = FitField;
export type SignInAudience = "judge" | "pitcher" | "host";
export type PitchFounder = { personId: string; name: string; email: string; company: string };

export type DocRecord = { id: string; data: Record<string, unknown> };

export type DocStore = {
  get(path: string): Promise<Record<string, unknown> | null>;
  set(path: string, data: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<void>;
  queryByEmail(collectionName: string, email: string): Promise<DocRecord[]>;
};

export type AuthStore = {
  getByEmail(email: string): Promise<{ uid: string; claims: Record<string, unknown> } | null>;
  create(email: string): Promise<{ uid: string }>;
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
};

type FetchLike = typeof fetch;

export function powerNowScoreDocId(nightId: string, pitcherId: string, judgeUid: string): string {
  return `${nightId}_${pitcherId}_${judgeUid}`;
}

function zonedParts(date: Date, timeZone: string) {
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)) {
    bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour === "24" ? "0" : bag.hour),
    minute: Number(bag.minute),
  };
}

/** Local clock time on a calendar date, as a UTC instant. */
export function scoringLockInstant(date: string, time: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new PowerNowInputError("The scoring lock needs a date and a time.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new PowerNowInputError("The scoring lock needs a date and a time.");
  }
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const desired = utc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    utc += desired - shown;
  }
  return new Date(utc).toISOString();
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function assertSlug(value: unknown, label: string): string {
  const next = String(value ?? "").trim();
  if (!POWER_NOW_SLUG.test(next)) {
    throw new PowerNowInputError(`${label} uses letters, numbers, and hyphens only.`);
  }
  return next;
}

export function assertContinueUrl(origin: unknown, path: unknown): { continueUrl: string; audience: SignInAudience } {
  const rawOrigin = String(origin ?? "").trim();
  const rawPath = String(path ?? "").trim();
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new PowerNowInputError("Choose the Power NOW page you are signing in from.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new PowerNowInputError("Choose the Power NOW page you are signing in from.");
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === "hi-coworking.com"
    || host === "www.hi-coworking.com"
    || host === "forms.accelanalysis.com"
    || host === "hi-coworking-plat.web.app"
    || host === "localhost"
    || host === "127.0.0.1"
    || (host.endsWith(".web.app") && host.startsWith("hi-coworking-plat"));
  if (!allowed || (url.protocol !== "https:" && !(url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1")))) {
    throw new PowerNowInputError("Choose the Power NOW page you are signing in from.");
  }
  if (rawPath !== POWER_NOW_SCORE_PATH && rawPath !== POWER_NOW_RUBRIC_PATH && rawPath !== POWER_NOW_RESULTS_PATH) {
    throw new PowerNowInputError("Choose the Power NOW page you are signing in from.");
  }
  const audience: SignInAudience = rawPath === POWER_NOW_SCORE_PATH
    ? "judge"
    : rawPath === POWER_NOW_RUBRIC_PATH
      ? "pitcher"
      : "host";
  return {
    continueUrl: `${url.origin}${rawPath}`,
    audience,
  };
}

export function signInAllowed(
  audience: SignInAudience,
  judges: DocRecord[],
  pitchers: DocRecord[],
  hosts: DocRecord[] = [],
): boolean {
  const rows = audience === "judge" ? judges : audience === "pitcher" ? pitchers : hosts;
  return rows.some((row) => row.data.active === true);
}

function fitShown(field: Pick<FitField, "showIf">, answers: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  return String(answers[field.showIf.id] ?? "") === field.showIf.equals;
}

function formatFitAnswer(field: Partial<FitField>, answer: FitAnswer | undefined): string {
  if (answer == null) return "";
  if (Array.isArray(answer)) return answer.join(", ");
  if (typeof answer === "object") {
    const rows = field.rows ?? [];
    return rows
      .map((row) => ({ label: row.label, value: answer[row.value] ?? "" }))
      .filter((row) => row.value)
      .map((row) => `${row.label}: ${row.value}`)
      .join("\n");
  }
  return answer;
}

export function buildFitConversationNote(input: {
  founderName: string;
  company: string;
  placeholder: boolean;
  version?: string;
  questions: Array<Pick<FitField, "id" | "prompt"> & Partial<FitField>>;
  answers: Record<string, FitAnswer>;
  savedAt: string;
}): string {
  const lines = [
    "Power NOW fit conversation",
    `Founder: ${input.founderName || "Not named"}`,
    `Company: ${input.company || "Not named"}`,
    input.placeholder
      ? "Question list: placeholder. Jonathan approves the real fit questions later."
      : `Question list: published${input.version ? ` (${input.version})` : ""}`,
    `Saved at: ${input.savedAt}`,
    "",
  ];
  let lastGroup = "";
  input.questions.forEach((question, index) => {
    if (!fitShown(question, input.answers)) return;
    if (question.group && question.group !== lastGroup) {
      lines.push(question.group);
      lastGroup = question.group;
    }
    lines.push(`${index + 1}. ${question.prompt}`);
    lines.push(formatFitAnswer(question, input.answers[question.id]));
    lines.push("");
  });
  return lines.join("\n").trim();
}

function optionValues(options: FitOption[] | undefined): Set<string> {
  return new Set((options ?? []).map((option) => option.value));
}

function parseFitAnswer(field: FitField, value: unknown): FitAnswer | undefined {
  if (field.type === "multi") {
    if (value == null || value === "") return undefined;
    if (!Array.isArray(value)) throw new PowerNowInputError("Choose one of the published options.");
    const allowed = optionValues(field.options);
    const picked = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
    if (picked.some((item) => !allowed.has(item))) throw new PowerNowInputError("Choose one of the published options.");
    return picked.length ? picked : undefined;
  }
  if (field.type === "grid") {
    if (value == null || value === "") return undefined;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new PowerNowInputError("Answer every fit question before saving.");
    }
    const rows = optionValues(field.rows);
    const columns = optionValues(field.columns);
    const clean: Record<string, string> = {};
    for (const [key, cell] of Object.entries(value as Record<string, unknown>)) {
      if (!rows.has(key)) throw new PowerNowInputError("Answer only the published fit questions.");
      const chosen = String(cell ?? "").trim();
      if (!chosen) continue;
      if (!columns.has(chosen)) throw new PowerNowInputError("Choose one of the published options.");
      clean[key] = chosen;
    }
    if (field.required && (field.rows ?? []).some((row) => !clean[row.value])) {
      throw new PowerNowInputError("Answer every fit question before saving.");
    }
    return Object.keys(clean).length ? clean : undefined;
  }
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const limit = field.maxLength ?? (field.type === "long" ? 4000 : field.type === "url" ? 500 : 300);
  if (text.length > limit || text.length > 4000) throw new PowerNowInputError("One answer is too long.");
  if (field.type === "url") {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new PowerNowInputError("Enter a full web address.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new PowerNowInputError("Enter a full web address.");
    }
  }
  if (field.type === "datetime" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    throw new PowerNowInputError("Enter the call date and time.");
  }
  if ((field.type === "single" || field.type === "scale") && (field.options?.length ?? 0) > 0) {
    if (!optionValues(field.options).has(text)) throw new PowerNowInputError("Choose one of the published options.");
  }
  return text;
}

export function validateFitAnswers(
  questions: FitField[],
  answers: Record<string, unknown>,
): Record<string, FitAnswer> {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new PowerNowInputError("Publish the fit questions before saving a conversation.");
  }
  const allowed = new Set(questions.map((question) => question.id));
  for (const key of Object.keys(answers)) {
    if (!allowed.has(key)) throw new PowerNowInputError("Answer only the published fit questions.");
  }
  const clean: Record<string, FitAnswer> = {};
  for (const question of questions) {
    if (!fitShown(question, answers)) continue;
    const parsed = parseFitAnswer(question, answers[question.id]);
    if (parsed === undefined) {
      if (question.required) throw new PowerNowInputError("Answer every fit question before saving.");
      continue;
    }
    clean[question.id] = parsed;
  }
  return clean;
}

type AttioRecord = {
  id?: { record_id?: string } | string;
  values?: Record<string, unknown[]>;
  parent_record_id?: string;
  parent_object?: string;
};

function recordId(record: AttioRecord | null | undefined): string {
  if (!record) return "";
  if (typeof record.id === "string") return record.id;
  return record.id?.record_id ?? record.parent_record_id ?? "";
}

function valuesOf(record: AttioRecord | null | undefined, slug: string): unknown[] {
  const values = record?.values?.[slug];
  return Array.isArray(values) ? values : [];
}

function readName(record: AttioRecord | null | undefined): string {
  const first = valuesOf(record, "name")[0];
  if (!first || typeof first !== "object") return "";
  const row = first as { value?: unknown; full_name?: unknown; first_name?: unknown; last_name?: unknown };
  if (typeof row.full_name === "string" && row.full_name.trim()) return row.full_name.trim();
  if (typeof row.value === "string" && row.value.trim()) return row.value.trim();
  const parts = [row.first_name, row.last_name].filter((part) => typeof part === "string" && part.trim());
  return parts.join(" ").trim();
}

function readEmail(record: AttioRecord | null | undefined): string {
  for (const value of valuesOf(record, "email_addresses")) {
    if (!value || typeof value !== "object") continue;
    const email = (value as { email_address?: unknown }).email_address;
    if (typeof email === "string" && email.includes("@")) return normalizeEmail(email);
  }
  return "";
}

function peopleReferenced(record: AttioRecord | null | undefined): string[] {
  const ids: string[] = [];
  for (const values of Object.values(record?.values ?? {})) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const row = value as { target_object?: unknown; target_record_id?: unknown };
      if (row.target_object === "people" && typeof row.target_record_id === "string") {
        ids.push(row.target_record_id);
      }
    }
  }
  return ids;
}

async function attio(
  fetchImpl: FetchLike,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data?: unknown }> {
  const response = await fetchImpl(`${ATTIO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: { data?: unknown } | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as { data?: unknown };
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const error = new Error(`Attio ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return json ?? {};
}

function asRecords(data: unknown): AttioRecord[] {
  return Array.isArray(data) ? data.filter((row) => row && typeof row === "object") as AttioRecord[] : [];
}

export async function listPitchInterestFounders(fetchImpl: FetchLike, apiKey: string): Promise<PitchFounder[]> {
  if (!apiKey.trim()) throw new PowerNowInputError("Attio is not configured for this project.");
  let entries: AttioRecord[] = [];
  try {
    const listed = await attio(
      fetchImpl,
      apiKey,
      "GET",
      `/lists/${PITCH_COMPETITION_LIST.apiSlug}/entries?limit=200`,
    );
    entries = asRecords(listed.data);
  } catch {
    throw new PowerNowInputError("The Power NOW pitch list could not be read.");
  }

  const founders = new Map<string, PitchFounder>();
  const addPerson = (person: AttioRecord, company: string) => {
    const personId = recordId(person);
    if (!personId || founders.has(personId)) return;
    founders.set(personId, {
      personId,
      name: readName(person),
      email: readEmail(person),
      company,
    });
  };

  for (const entry of entries) {
    const parentId = entry.parent_record_id || recordId(entry);
    const parentObject = entry.parent_object || PITCH_COMPETITION_LIST.parentObject;
    if (!parentId) continue;
    if (parentObject === "people") {
      try {
        const person = await attio(fetchImpl, apiKey, "GET", `/objects/people/records/${parentId}`);
        const record = (person.data ?? null) as AttioRecord | null;
        if (record) addPerson(record, "");
      } catch {
        continue;
      }
      continue;
    }

    let companyName = "";
    let companyRecord: AttioRecord | null = null;
    try {
      const company = await attio(fetchImpl, apiKey, "GET", `/objects/companies/records/${parentId}`);
      companyRecord = (company.data ?? null) as AttioRecord | null;
      companyName = readName(companyRecord);
    } catch {
      companyRecord = null;
    }

    let people: AttioRecord[] = [];
    try {
      const queried = await attio(fetchImpl, apiKey, "POST", "/objects/people/records/query", {
        filter: { company: { target_record_id: parentId } },
        limit: 25,
      });
      people = asRecords(queried.data);
    } catch {
      people = [];
    }
    for (const person of people) addPerson(person, companyName);

    for (const personId of peopleReferenced(companyRecord)) {
      if (founders.has(personId)) continue;
      try {
        const person = await attio(fetchImpl, apiKey, "GET", `/objects/people/records/${personId}`);
        const record = (person.data ?? null) as AttioRecord | null;
        if (record) addPerson(record, companyName);
      } catch {
        continue;
      }
    }
  }

  return [...founders.values()].sort((a, b) => a.name.localeCompare(b.name, "en-US"));
}

export async function createPersonNote(
  fetchImpl: FetchLike,
  apiKey: string,
  personId: string,
  title: string,
  content: string,
): Promise<void> {
  if (!apiKey.trim()) throw new PowerNowInputError("Attio is not configured for this project.");
  if (!/^[0-9a-f-]{36}$/i.test(personId)) {
    throw new PowerNowInputError("Choose a founder from the pitch list.");
  }
  try {
    await attio(fetchImpl, apiKey, "POST", "/notes", {
      data: {
        parent_object: "people",
        parent_record_id: personId,
        title: title.slice(0, 200),
        format: "plaintext",
        content,
      },
    });
  } catch {
    throw new PowerNowInputError("The fit conversation note could not be saved.");
  }
}

export async function seedPowerNowPlaceholders(store: DocStore): Promise<{ questions: boolean; criteria: boolean; settings: boolean }> {
  const questionsPath = "powerNowFitQuestions/current";
  const criteriaPath = "powerNowCriteria/current";
  const settingsPath = "powerNowSettings/current";
  const questions = await store.get(questionsPath);
  const criteria = await store.get(criteriaPath);
  const settings = await store.get(settingsPath);
  const writeQuestions = !questions || questions.placeholder === true;
  const writeCriteria = !criteria || criteria.placeholder === true || REPLACED_CRITERIA_VERSIONS.has(String(criteria.version ?? ""));
  const writeSettings = !settings;
  const updatedAt = new Date().toISOString();
  if (writeQuestions) await store.set(questionsPath, { ...POWER_NOW_FIT_QUESTIONS, updatedAt });
  if (writeCriteria) await store.set(criteriaPath, { ...POWER_NOW_CRITERIA, updatedAt });
  if (writeSettings) await store.set(settingsPath, { ...POWER_NOW_SETTINGS, updatedAt });
  for (const night of POWER_NOW_NIGHTS) {
    if (await store.get(`powerNowNights/${night.id}`)) continue;
    await savePowerNowNight(store, night.id, night.label);
  }
  return { questions: writeQuestions, criteria: writeCriteria, settings: writeSettings };
}

type ListedRole = {
  collectionName: "powerNowJudges" | "powerNowHosts";
  claim: "powerNowJudge" | "powerNowHost";
  noun: string;
};

const JUDGE_ROLE: ListedRole = { collectionName: "powerNowJudges", claim: "powerNowJudge", noun: "judge" };
const HOST_ROLE: ListedRole = { collectionName: "powerNowHosts", claim: "powerNowHost", noun: "host" };

async function addListedPerson(
  store: DocStore,
  auth: AuthStore,
  emailInput: unknown,
  addedBy: string,
  role: ListedRole,
) {
  const email = normalizeEmail(emailInput);
  if (!email.includes("@") || email.length > 200) {
    throw new PowerNowInputError(`Enter the ${role.noun}'s email address.`);
  }
  const user = await ensureUser(auth, email);
  await auth.setClaims(user.uid, { ...user.claims, [role.claim]: true });
  await store.set(`${role.collectionName}/${user.uid}`, {
    email,
    active: true,
    addedBy,
    updatedAt: new Date().toISOString(),
  });
  return { uid: user.uid, email };
}

async function removeListedPerson(store: DocStore, auth: AuthStore, uidInput: unknown, role: ListedRole) {
  const uid = String(uidInput ?? "").trim();
  if (!uid) throw new PowerNowInputError(`Choose a ${role.noun} to remove.`);
  const existing = await store.get(`${role.collectionName}/${uid}`);
  if (!existing) throw new PowerNowInputError(`That ${role.noun} is not on the list.`);
  const email = normalizeEmail(existing.email);
  const user = email ? await auth.getByEmail(email) : null;
  if (user) await auth.setClaims(user.uid, { ...user.claims, [role.claim]: false });
  await store.set(`${role.collectionName}/${uid}`, { ...existing, active: false, updatedAt: new Date().toISOString() });
  return { uid };
}

async function ensureUser(auth: AuthStore, email: string): Promise<{ uid: string; claims: Record<string, unknown> }> {
  const existing = await auth.getByEmail(email);
  if (existing) return existing;
  const created = await auth.create(email);
  return { uid: created.uid, claims: {} };
}

export function addPowerNowJudge(store: DocStore, auth: AuthStore, emailInput: unknown, addedBy: string) {
  return addListedPerson(store, auth, emailInput, addedBy, JUDGE_ROLE);
}

export function removePowerNowJudge(store: DocStore, auth: AuthStore, uidInput: unknown) {
  return removeListedPerson(store, auth, uidInput, JUDGE_ROLE);
}

export function addPowerNowHost(store: DocStore, auth: AuthStore, emailInput: unknown, addedBy: string) {
  return addListedPerson(store, auth, emailInput, addedBy, HOST_ROLE);
}

export function removePowerNowHost(store: DocStore, auth: AuthStore, uidInput: unknown) {
  return removeListedPerson(store, auth, uidInput, HOST_ROLE);
}

export async function savePowerNowNight(store: DocStore, nightIdInput: unknown, labelInput: unknown) {
  const nightId = assertSlug(nightIdInput, "The night id");
  const label = String(labelInput ?? "").trim();
  if (!label || label.length > 120) throw new PowerNowInputError("Name the pitch night in 120 characters or fewer.");
  const existing = await store.get(`powerNowNights/${nightId}`);
  const settings = await store.get("powerNowSettings/current");
  const lockTime = typeof settings?.scoringLockTime === "string" ? settings.scoringLockTime : POWER_NOW_SETTINGS.scoringLockTime;
  const timeZone = typeof settings?.timeZone === "string" ? settings.timeZone : POWER_NOW_SETTINGS.timeZone;
  const lockAt = existing?.lockAt
    ?? (/^\d{4}-\d{2}-\d{2}$/.test(nightId) ? new Date(scoringLockInstant(nightId, lockTime, timeZone)) : null);
  await store.set(`powerNowNights/${nightId}`, {
    label,
    locked: existing?.locked === true,
    founderCommentsReleased: existing?.founderCommentsReleased === true,
    lockAt,
    createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { nightId, lockAt: lockAt instanceof Date ? lockAt.toISOString() : null };
}

export async function lockPowerNowNight(store: DocStore, nightIdInput: unknown, locked: boolean) {
  const nightId = assertSlug(nightIdInput, "The night id");
  const existing = await store.get(`powerNowNights/${nightId}`);
  if (!existing) throw new PowerNowInputError("Save the pitch night before locking it.");
  await store.set(`powerNowNights/${nightId}`, {
    ...existing,
    locked: locked === true,
    updatedAt: new Date().toISOString(),
  });
  return { nightId, locked: locked === true };
}

export async function setSelectedPitcher(
  store: DocStore,
  auth: AuthStore,
  input: {
    nightId?: unknown;
    pitcherId?: unknown;
    name?: unknown;
    email?: unknown;
    company?: unknown;
    attioPersonId?: unknown;
    selected?: unknown;
  },
) {
  const nightId = assertSlug(input.nightId, "The night id");
  const night = await store.get(`powerNowNights/${nightId}`);
  if (!night) throw new PowerNowInputError("Save the pitch night before selecting a pitcher.");
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new PowerNowInputError("A selected pitcher needs an email address.");
  const name = String(input.name ?? "").trim().slice(0, 160);
  const company = String(input.company ?? "").trim().slice(0, 160);
  const pitcherId = assertSlug(input.pitcherId, "The pitcher id");
  const selected = input.selected !== false;
  const user = await ensureUser(auth, email);
  const rolePath = `powerNowPitchers/${user.uid}`;
  const role = (await store.get(rolePath)) ?? {};
  const nightIds = Array.isArray(role.nightIds) ? role.nightIds.filter((item) => typeof item === "string") as string[] : [];
  const nextNights = new Set(nightIds);
  if (selected) nextNights.add(nightId);
  else nextNights.delete(nightId);
  const active = nextNights.size > 0;
  await auth.setClaims(user.uid, { ...user.claims, powerNowPitcher: active });
  await store.set(rolePath, {
    email,
    name,
    active,
    nightIds: [...nextNights],
    updatedAt: new Date().toISOString(),
  });
  const pitcherPath = `powerNowNights/${nightId}/pitchers/${pitcherId}`;
  if (!selected) {
    await store.delete(pitcherPath);
  } else {
    await store.set(pitcherPath, {
      name,
      email,
      company,
      attioPersonId: String(input.attioPersonId ?? "").trim(),
      uid: user.uid,
      selected: true,
      updatedAt: new Date().toISOString(),
    });
  }
  return { uid: user.uid, pitcherId, selected };
}

export async function prepareSignInLink(
  store: DocStore,
  input: { email?: unknown; origin?: unknown; path?: unknown },
): Promise<{ continueUrl: string; email: string; audience: SignInAudience } | null> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.length > 200) throw new PowerNowInputError("Enter the email address on the list.");
  const target = assertContinueUrl(input.origin, input.path);
  const [judges, pitchers, hosts] = await Promise.all([
    store.queryByEmail("powerNowJudges", email),
    store.queryByEmail("powerNowPitchers", email),
    store.queryByEmail("powerNowHosts", email),
  ]);
  if (!signInAllowed(target.audience, judges, pitchers, hosts)) return null;
  return { continueUrl: target.continueUrl, email, audience: target.audience };
}

export async function requestFirebaseEmailSignIn(
  fetchImpl: FetchLike,
  apiKey: string,
  email: string,
  continueUrl: string,
  authEmulatorHost?: string,
): Promise<void> {
  const endpoint = authEmulatorHost
    ? `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`
    : `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestType: "EMAIL_SIGNIN",
      email,
      continueUrl,
      canHandleCodeInApp: true,
    }),
  });
  if (!response.ok) {
    throw new PowerNowInputError("The sign-in email could not be sent. Try again in a moment.");
  }
}

const FIT_TYPES = new Set<FitFieldType>(["short", "long", "single", "multi", "scale", "grid", "datetime", "url"]);

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOptions(value: unknown): FitOption[] {
  if (!Array.isArray(value)) return [];
  const options: FitOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { value?: unknown; label?: unknown };
    const optionValue = String(row.value ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!optionValue || !label) continue;
    options.push({ value: optionValue, label });
  }
  return options;
}

function readShowIf(value: unknown): FitShowIf | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { id?: unknown; equals?: unknown };
  const id = String(row.id ?? "").trim();
  const equals = String(row.equals ?? "");
  if (!id || equals === "") return undefined;
  return { id, equals };
}

export function readFitQuestions(data: Record<string, unknown> | null): FitDocument {
  const items = Array.isArray(data?.items) ? data.items : [];
  const questions: FitField[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const prompt = String(row.prompt ?? "").trim();
    if (!id || !prompt) continue;
    const rawType = String(row.type ?? "");
    const type: FitFieldType = FIT_TYPES.has(rawType as FitFieldType) ? rawType as FitFieldType : "long";
    const maxLength = Number(row.maxLength);
    const showIf = readShowIf(row.showIf);
    questions.push({
      id,
      prompt,
      section: String(row.section ?? "").trim(),
      type,
      required: typeof row.required === "boolean" ? row.required : true,
      ...(Number.isInteger(maxLength) && maxLength > 0 ? { maxLength } : {}),
      ...(readText(row.help) ? { help: readText(row.help) } : {}),
      ...(readText(row.note) ? { note: readText(row.note) } : {}),
      ...(readText(row.group) ? { group: readText(row.group) } : {}),
      ...(Array.isArray(row.options) ? { options: readOptions(row.options) } : {}),
      ...(Array.isArray(row.rows) ? { rows: readOptions(row.rows) } : {}),
      ...(Array.isArray(row.columns) ? { columns: readOptions(row.columns) } : {}),
      ...(showIf ? { showIf } : {}),
    });
  }
  const sections = Array.isArray(data?.sections) ? data.sections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; title?: unknown };
    const id = String(row.id ?? "").trim();
    const title = String(row.title ?? "").trim();
    return id && title ? [{ id, title }] : [];
  }) : [];
  return {
    placeholder: data?.placeholder === true,
    draft: data?.draft === true,
    version: readText(data?.version),
    notice: readText(data?.notice),
    openingScript: readText(data?.openingScript),
    confidentialityNote: readText(data?.confidentialityNote),
    closingScript: readText(data?.closingScript),
    closingNote: readText(data?.closingNote),
    closingFollowUp: readText(data?.closingFollowUp),
    sections,
    items: questions,
  };
}

export async function saveFitConversation(input: {
  fetchImpl: FetchLike;
  apiKey: string;
  store: DocStore;
  personId: string;
  founderName: string;
  company: string;
  answers: Record<string, unknown>;
  now?: Date;
}): Promise<{ title: string }> {
  const config = readFitQuestions(await input.store.get("powerNowFitQuestions/current"));
  const answers = validateFitAnswers(config.items, input.answers);
  const savedAt = (input.now ?? new Date()).toISOString();
  const title = "Power NOW fit conversation";
  const content = buildFitConversationNote({
    founderName: input.founderName,
    company: input.company,
    placeholder: config.placeholder,
    version: config.version,
    questions: config.items,
    answers,
    savedAt,
  });
  await createPersonNote(input.fetchImpl, input.apiKey, input.personId, title, content);
  return { title };
}
