import { PITCH_COMPETITION_LIST } from "./powerNowModel";

const ATTIO_BASE = "https://api.attio.com/v2";

export const POWER_NOW_SCORE_PATH = "/power-now/score";
export const POWER_NOW_RUBRIC_PATH = "/power-now/rubric";
export const POWER_NOW_SLUG = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Placeholder copy lives on the server. The client fetches the published
 * Firestore documents at runtime and does not embed these sentences.
 */
export const POWER_NOW_FIT_PLACEHOLDER = {
  placeholder: true,
  notice: "Placeholder questions. Jonathan approves the real fit questions later.",
  items: [
    { id: "placeholder-problem", prompt: "Placeholder question: what problem is this business solving?" },
    { id: "placeholder-customer", prompt: "Placeholder question: who is the customer?" },
    { id: "placeholder-why-power-now", prompt: "Placeholder question: why is this a fit for a Power NOW night?" },
  ],
} as const;

export const POWER_NOW_CRITERIA_PLACEHOLDER = {
  placeholder: true,
  notice: "Placeholder rubric. Jonathan approves the real scoring criteria later.",
  items: [
    { id: "placeholder-clarity", label: "Placeholder criterion: clarity of the problem", max: 5 },
    { id: "placeholder-customer", label: "Placeholder criterion: customer and market", max: 5 },
    { id: "placeholder-ask", label: "Placeholder criterion: the ask and the next step", max: 5 },
  ],
} as const;

export class PowerNowInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PowerNowInputError";
  }
}

export type FitQuestion = { id: string; prompt: string };
export type Criterion = { id: string; label: string; max: number };
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

export function assertContinueUrl(origin: unknown, path: unknown): { continueUrl: string; audience: "judge" | "pitcher" } {
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
  if (rawPath !== POWER_NOW_SCORE_PATH && rawPath !== POWER_NOW_RUBRIC_PATH) {
    throw new PowerNowInputError("Choose the Power NOW page you are signing in from.");
  }
  return {
    continueUrl: `${url.origin}${rawPath}`,
    audience: rawPath === POWER_NOW_SCORE_PATH ? "judge" : "pitcher",
  };
}

export function signInAllowed(
  audience: "judge" | "pitcher",
  judges: DocRecord[],
  pitchers: DocRecord[],
): boolean {
  const rows = audience === "judge" ? judges : pitchers;
  return rows.some((row) => row.data.active === true);
}

export function buildFitConversationNote(input: {
  founderName: string;
  company: string;
  placeholder: boolean;
  questions: FitQuestion[];
  answers: Record<string, string>;
  savedAt: string;
}): string {
  const lines = [
    "Power NOW fit conversation",
    `Founder: ${input.founderName || "Not named"}`,
    `Company: ${input.company || "Not named"}`,
    input.placeholder
      ? "Question list: placeholder. Jonathan approves the real fit questions later."
      : "Question list: published",
    `Saved at: ${input.savedAt}`,
    "",
  ];
  input.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.prompt}`);
    lines.push(input.answers[question.id] ?? "");
    lines.push("");
  });
  return lines.join("\n").trim();
}

export function validateFitAnswers(
  questions: FitQuestion[],
  answers: Record<string, unknown>,
): Record<string, string> {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new PowerNowInputError("Publish the fit questions before saving a conversation.");
  }
  const clean: Record<string, string> = {};
  const allowed = new Set(questions.map((question) => question.id));
  for (const key of Object.keys(answers)) {
    if (!allowed.has(key)) throw new PowerNowInputError("Answer only the published fit questions.");
  }
  for (const question of questions) {
    const answer = String(answers[question.id] ?? "").trim();
    if (!answer) throw new PowerNowInputError("Answer every fit question before saving.");
    if (answer.length > 4000) throw new PowerNowInputError("Each answer must be 4000 characters or fewer.");
    clean[question.id] = answer;
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

export async function seedPowerNowPlaceholders(store: DocStore): Promise<{ questions: boolean; criteria: boolean }> {
  const questionsPath = "powerNowFitQuestions/current";
  const criteriaPath = "powerNowCriteria/current";
  const questions = await store.get(questionsPath);
  const criteria = await store.get(criteriaPath);
  if (!questions) await store.set(questionsPath, { ...POWER_NOW_FIT_PLACEHOLDER, updatedAt: new Date().toISOString() });
  if (!criteria) await store.set(criteriaPath, { ...POWER_NOW_CRITERIA_PLACEHOLDER, updatedAt: new Date().toISOString() });
  return { questions: !questions, criteria: !criteria };
}

async function ensureUser(auth: AuthStore, email: string): Promise<{ uid: string; claims: Record<string, unknown> }> {
  const existing = await auth.getByEmail(email);
  if (existing) return existing;
  const created = await auth.create(email);
  return { uid: created.uid, claims: {} };
}

export async function addPowerNowJudge(store: DocStore, auth: AuthStore, emailInput: unknown, addedBy: string) {
  const email = normalizeEmail(emailInput);
  if (!email.includes("@") || email.length > 200) throw new PowerNowInputError("Enter the judge's email address.");
  const user = await ensureUser(auth, email);
  await auth.setClaims(user.uid, { ...user.claims, powerNowJudge: true });
  await store.set(`powerNowJudges/${user.uid}`, {
    email,
    active: true,
    addedBy,
    updatedAt: new Date().toISOString(),
  });
  return { uid: user.uid, email };
}

export async function removePowerNowJudge(store: DocStore, auth: AuthStore, uidInput: unknown) {
  const uid = String(uidInput ?? "").trim();
  if (!uid) throw new PowerNowInputError("Choose a judge to remove.");
  const existing = await store.get(`powerNowJudges/${uid}`);
  if (!existing) throw new PowerNowInputError("That judge is not on the list.");
  const email = normalizeEmail(existing.email);
  const user = email ? await auth.getByEmail(email) : null;
  if (user) await auth.setClaims(user.uid, { ...user.claims, powerNowJudge: false });
  await store.set(`powerNowJudges/${uid}`, { ...existing, active: false, updatedAt: new Date().toISOString() });
  return { uid };
}

export async function savePowerNowNight(store: DocStore, nightIdInput: unknown, labelInput: unknown) {
  const nightId = assertSlug(nightIdInput, "The night id");
  const label = String(labelInput ?? "").trim();
  if (!label || label.length > 120) throw new PowerNowInputError("Name the pitch night in 120 characters or fewer.");
  const existing = await store.get(`powerNowNights/${nightId}`);
  await store.set(`powerNowNights/${nightId}`, {
    label,
    locked: existing?.locked === true,
    createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { nightId };
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
): Promise<{ continueUrl: string; email: string; audience: "judge" | "pitcher" } | null> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.length > 200) throw new PowerNowInputError("Enter the email address on the list.");
  const target = assertContinueUrl(input.origin, input.path);
  const [judges, pitchers] = await Promise.all([
    store.queryByEmail("powerNowJudges", email),
    store.queryByEmail("powerNowPitchers", email),
  ]);
  if (!signInAllowed(target.audience, judges, pitchers)) return null;
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

export function readFitQuestions(data: Record<string, unknown> | null): { placeholder: boolean; notice: string; items: FitQuestion[] } {
  const items = Array.isArray(data?.items) ? data.items : [];
  const questions: FitQuestion[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; prompt?: unknown };
    const id = String(row.id ?? "").trim();
    const prompt = String(row.prompt ?? "").trim();
    if (!id || !prompt) continue;
    questions.push({ id, prompt });
  }
  return {
    placeholder: data?.placeholder === true,
    notice: typeof data?.notice === "string" ? data.notice : "",
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
    questions: config.items,
    answers,
    savedAt,
  });
  await createPersonNote(input.fetchImpl, input.apiKey, input.personId, title, content);
  return { title };
}
