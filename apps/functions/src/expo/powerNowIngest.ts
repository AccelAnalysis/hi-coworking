/**
 * Power NOW writes through the shared Attio client used by intake.
 * No new Attio lists or attributes. Pitch companies join the existing
 * Pitch Competition list. Consent is also stored in Firestore.
 *
 * Each submission's follow-up task is assigned to Jonathan Holman.
 * Override the workspace member with POWER_NOW_TASK_ASSIGNEE_ID.
 * If that assign call fails, the task stays unassigned and the submission still succeeds.
 */

import * as admin from "firebase-admin";
import {
  companyNameKey,
  mergeDescription,
  normalizePhone,
  splitPersonName,
} from "./nasaLeadModel";
import {
  confirmationEmailEnabled,
  confirmationFailureNote,
  createFirestoreConfirmationStore,
  prefixConfirmationFailure,
  runPowerNowConfirmation,
  type PowerNowConfirmationOptions,
} from "./powerNowConfirmation";
import { readPowerNowSecret } from "./powerNowConfirmationSecrets";
import {
  PITCH_COMPETITION_LIST,
  POWER_NOW_RATE_LIMIT_ERROR,
  POWER_NOW_SEND_ERROR,
  buildPowerNowNote,
  buildPowerNowTaskContent,
  powerNowFlags,
  powerNowNoteTitle,
  validatePowerNowPayload,
  type NormalizedPowerNow,
  type PowerNowConsentRecord,
} from "./powerNowModel";

const ATTIO_BASE = "https://api.attio.com/v2";
const POWER_NOW_RATE_LIMIT = 8;
const POWER_NOW_RATE_WINDOW_MS = 10 * 60 * 1000;

/** Jonathan Holman (jholman@accelanalysis.com). */
export const POWER_NOW_TASK_ASSIGNEE_DEFAULT_ID = "2029a271-1072-4dd9-849e-6a32fdb71df5";

export function powerNowTaskAssigneeId(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.POWER_NOW_TASK_ASSIGNEE_ID?.trim();
  return configured || POWER_NOW_TASK_ASSIGNEE_DEFAULT_ID;
}

export class PowerNowAttioError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PowerNowAttioError";
    this.status = status;
  }
}

export type PowerNowRateLimiter = {
  allow(key: string): boolean;
};

export function createPowerNowRateLimiter(options?: {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}): PowerNowRateLimiter {
  const limit = options?.limit ?? POWER_NOW_RATE_LIMIT;
  const windowMs = options?.windowMs ?? POWER_NOW_RATE_WINDOW_MS;
  const now = options?.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    allow(key: string) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => time - stamp < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(time);
      hits.set(key, recent);
      return true;
    },
  };
}

const sharedRateLimiter = createPowerNowRateLimiter();

export type PowerNowConsentLog = {
  clientSubmissionId: string;
  path: NormalizedPowerNow["path"];
  source: NormalizedPowerNow["source"];
  capturedAtEt: string;
  submittedAt: string;
  email: string;
  fullName: string;
  phone: string | null;
  companyName: string | null;
  unnamedBusiness: boolean;
  utm: NormalizedPowerNow["utm"];
  referrerPath: string | null;
  consent: PowerNowConsentRecord[];
  answers: NormalizedPowerNow["answers"];
  flags: string[];
  personRecordId: string;
  companyRecordId: string | null;
  listStatus: "added" | "already_listed" | "skipped" | "not_applicable";
  descriptionTag: string;
};

export async function writePowerNowConsentLog(entry: PowerNowConsentLog): Promise<void> {
  if (admin.apps.length === 0) admin.initializeApp();
  await admin.firestore().collection("powerNowConsentLog").doc(entry.clientSubmissionId).set(entry);
}

type AttioRecord = {
  id?: { record_id?: string } | string;
  values?: Record<string, unknown>;
};

type FetchLike = typeof fetch;

export type PowerNowIngestResult = {
  ok: true;
  action: "created" | "updated";
  path: NormalizedPowerNow["path"];
  personRecordId: string;
  companyRecordId: string | null;
  companyStatus: "existing" | "created" | "failed" | "skipped";
  listStatus: PowerNowConsentLog["listStatus"];
  noteStatus: "created" | "already_recorded";
  taskStatus: "created" | "already_recorded" | "skipped";
  flags: string[];
};

export async function handlePowerNowHttp(request: {
  body: unknown;
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  now?: Date;
  ip?: string | null;
  rateLimiter?: PowerNowRateLimiter;
  consentLog?: (entry: PowerNowConsentLog) => Promise<void>;
  confirmation?: PowerNowConfirmationOptions;
}): Promise<{ status: number; body: Record<string, unknown>; extraHeaders?: Record<string, string> }> {
  const limiter = request.rateLimiter ?? sharedRateLimiter;
  const ip = request.ip?.trim() || "unknown";
  if (!limiter.allow(`power-now:${ip}`)) {
    return {
      status: 429,
      extraHeaders: { "Retry-After": "600" },
      body: { ok: false, error: POWER_NOW_RATE_LIMIT_ERROR },
    };
  }

  const validated = validatePowerNowPayload(request.body, request.now ?? new Date());
  if (!validated.ok) {
    return { status: 400, body: { ok: false, error: validated.error, fields: validated.fields } };
  }

  const apiKey = request.apiKey?.trim();
  if (!apiKey) {
    return { status: 500, body: { ok: false, error: "Lead capture is not configured." } };
  }

  try {
    const raw = request.body && typeof request.body === "object"
      ? request.body as Record<string, unknown>
      : null;
    const result = await ingestPowerNow(validated.lead, {
      apiKey,
      fetchImpl: request.fetchImpl,
      consentLog: request.consentLog ?? writePowerNowConsentLog,
      confirmation: {
        ...request.confirmation,
        now: request.confirmation?.now ?? request.now,
        ip: request.confirmation?.ip ?? request.ip ?? undefined,
        startedAt: request.confirmation?.startedAt ?? (typeof raw?.pnStartedAt === "string" ? raw.pnStartedAt : null),
        captchaToken: request.confirmation?.captchaToken ?? (typeof raw?.recaptchaToken === "string" ? raw.recaptchaToken : null),
      },
    });
    return {
      status: 200,
      body: {
        ok: true,
        accepted: true,
        action: result.action,
        path: result.path,
        companyStatus: result.companyStatus,
        listStatus: result.listStatus,
        noteStatus: result.noteStatus,
        taskStatus: result.taskStatus,
      },
    };
  } catch {
    return { status: 502, body: { ok: false, error: POWER_NOW_SEND_ERROR } };
  }
}

export async function ingestPowerNow(
  lead: NormalizedPowerNow,
  options: {
    apiKey: string;
    fetchImpl?: FetchLike;
    consentLog?: (entry: PowerNowConsentLog) => Promise<void>;
    confirmation?: PowerNowConfirmationOptions;
  },
): Promise<PowerNowIngestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey;
  const confirmationEnv = options.confirmation?.env ?? process.env;
  const sendConfirmation = confirmationEmailEnabled(confirmationEnv);
  const company = await findOrCreateCompany(fetchImpl, apiKey, lead);
  const existing = await findPersonByEmail(fetchImpl, apiKey, lead.email);
  const values = personValues(lead, company.id, existing, sendConfirmation);
  const person = await assertPersonByEmail(fetchImpl, apiKey, values);
  const personRecordId = recordId(person);
  if (!personRecordId) throw new PowerNowAttioError(502, "Attio did not return a person id");

  const listStatus = lead.path === "pitch" && company.id
    ? await addCompanyToPitchList(fetchImpl, apiKey, company.id)
    : lead.path === "pitch"
      ? "skipped"
      : "not_applicable";
  const flags = powerNowFlags(lead, {
    companyLinked: Boolean(company.id),
    listStatus,
  });

  const personNoted = await noteExists(fetchImpl, apiKey, "people", personRecordId, lead.clientSubmissionId);
  const companyNoted = company.id
    ? await noteExists(fetchImpl, apiKey, "companies", company.id, lead.clientSubmissionId)
    : true;

  let taskStatus: PowerNowIngestResult["taskStatus"] = "already_recorded";
  let taskId: string | null = null;
  let taskContent: string | null = null;
  let noteStatus: PowerNowIngestResult["noteStatus"] = personNoted ? "already_recorded" : "created";
  if (!personNoted || !companyNoted) {
    const task = await ensureTask(fetchImpl, apiKey, lead, personRecordId, company.id, flags);
    taskStatus = task.status;
    taskId = task.taskId;
    taskContent = task.content;
    const note = buildPowerNowNote(lead, { flags, taskStatus });
    const title = powerNowNoteTitle(lead.path, lead.capturedAtEt);
    if (!personNoted) await createNote(fetchImpl, apiKey, "people", personRecordId, title, note);
    if (company.id && !companyNoted) await createNote(fetchImpl, apiKey, "companies", company.id, title, note);
  }

  const consentLog = options.consentLog ?? writePowerNowConsentLog;
  await consentLog({
    clientSubmissionId: lead.clientSubmissionId,
    path: lead.path,
    source: lead.source,
    capturedAtEt: lead.capturedAtEt,
    submittedAt: lead.submittedAt,
    email: lead.email,
    fullName: lead.fullName,
    phone: lead.phoneOriginal,
    companyName: lead.companyName,
    unnamedBusiness: lead.unnamedBusiness,
    utm: lead.utm,
    referrerPath: lead.referrerPath,
    consent: lead.consent,
    answers: lead.answers,
    flags,
    personRecordId,
    companyRecordId: company.id,
    listStatus,
    descriptionTag: lead.descriptionTag,
  });

  if (sendConfirmation) {
    try {
      await runPowerNowConfirmation({
        lead,
        personRecordId,
        env: confirmationEnv,
        now: options.confirmation?.now ?? new Date(),
        ip: options.confirmation?.ip ?? "unknown",
        startedAt: options.confirmation?.startedAt ?? null,
        captchaToken: options.confirmation?.captchaToken ?? null,
        mailFetch: options.confirmation?.mailFetch,
        store: options.confirmation?.store ?? createFirestoreConfirmationStore(),
        resolveMx: options.confirmation?.resolveMx,
        verifyCaptcha: options.confirmation?.verifyCaptcha,
        readSecret: options.confirmation?.readSecret ?? ((name) => readPowerNowSecret(name, confirmationEnv)),
        onSuccess: async (note) => {
          await createNote(fetchImpl, apiKey, "people", personRecordId, "Power NOW confirmation email", note);
        },
        onSendFailure: async (errorClass) => {
          if (taskId && taskContent) {
            try {
              await attio(fetchImpl, apiKey, "PATCH", `/tasks/${taskId}`, {
                data: {
                  content: prefixConfirmationFailure(taskContent),
                  format: "plaintext",
                },
              });
            } catch {
              console.error("Power NOW confirmation email", { personRecordId, errorClass });
            }
          }
          await createNote(
            fetchImpl,
            apiKey,
            "people",
            personRecordId,
            "Power NOW confirmation email failed",
            confirmationFailureNote(errorClass),
          );
        },
      });
    } catch {
      console.error("Power NOW confirmation email", { personRecordId, errorClass: "SendFailed" });
    }
  }

  return {
    ok: true,
    action: existing ? "updated" : "created",
    path: lead.path,
    personRecordId,
    companyRecordId: company.id,
    companyStatus: company.status,
    listStatus,
    noteStatus,
    taskStatus,
    flags,
  };
}

async function findOrCreateCompany(
  fetchImpl: FetchLike,
  apiKey: string,
  lead: NormalizedPowerNow,
): Promise<{ id: string | null; status: PowerNowIngestResult["companyStatus"] }> {
  if (!lead.createCompany || !lead.companyName) return { id: null, status: "skipped" };
  const name = lead.companyName;
  try {
    const records = await queryRecords(fetchImpl, apiKey, "companies", { name }, 25);
    const match = records.find((record) => companyNameKey(readText(record, "name")) === companyNameKey(name));
    const id = match ? recordId(match) : null;
    if (id) return { id, status: "existing" };
  } catch (error) {
    if (!(error instanceof PowerNowAttioError) || error.status >= 500) throw error;
  }

  try {
    const created = await attio(fetchImpl, apiKey, "POST", "/objects/companies/records", {
      data: { values: { name: [{ value: name }] } },
    });
    const id = recordId(asRecord(created.data));
    return id ? { id, status: "created" } : { id: null, status: "failed" };
  } catch (error) {
    if (error instanceof PowerNowAttioError && error.status < 500) return { id: null, status: "failed" };
    throw error;
  }
}

async function findPersonByEmail(
  fetchImpl: FetchLike,
  apiKey: string,
  email: string,
): Promise<AttioRecord | null> {
  const records = await queryRecords(fetchImpl, apiKey, "people", { email_addresses: email }, 5);
  return records.find((record) =>
    readEmails(record).some((value) => value.toLowerCase() === email.toLowerCase()),
  ) ?? null;
}

function personValues(
  lead: NormalizedPowerNow,
  companyId: string | null,
  existing: AttioRecord | null,
  promoteSubmittedEmail = false,
): Record<string, unknown> {
  const name = splitPersonName(lead.fullName);
  const emails: Array<{ email_address: string }> = [{ email_address: lead.email }];
  if (promoteSubmittedEmail && existing) {
    const seen = new Set([lead.email.toLowerCase()]);
    for (const other of readEmails(existing)) {
      const key = other.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      emails.push({ email_address: other });
    }
  }
  const values: Record<string, unknown> = {
    name: [name],
    email_addresses: emails,
    description: [{
      value: mergeDescription(readText(existing, "description"), lead.descriptionTag, lead.clientSubmissionId),
    }],
  };
  if (lead.phoneOriginal || lead.phoneE164) {
    const phones = mergePhones(existing, lead);
    if (phones.length > 0) values.phone_numbers = phones;
  }
  if (companyId) {
    const companies = mergeCompanies(existing, companyId);
    if (companies.length > 0) values.company = companies;
  }
  return values;
}

async function assertPersonByEmail(
  fetchImpl: FetchLike,
  apiKey: string,
  values: Record<string, unknown>,
): Promise<AttioRecord> {
  const result = await attio(
    fetchImpl,
    apiKey,
    "PUT",
    "/objects/people/records?matching_attribute=email_addresses",
    { data: { values } },
  );
  return asRecord(result.data) ?? {};
}

async function addCompanyToPitchList(
  fetchImpl: FetchLike,
  apiKey: string,
  companyId: string,
): Promise<"added" | "already_listed" | "skipped"> {
  try {
    const listed = await attio(fetchImpl, apiKey, "GET", `/objects/companies/records/${companyId}/entries`);
    const entries = Array.isArray(listed.data) ? listed.data : [];
    const already = entries.some((entry) => {
      const record = entry as { list_api_slug?: string; list_id?: string };
      return record.list_api_slug === PITCH_COMPETITION_LIST.apiSlug || record.list_id === PITCH_COMPETITION_LIST.listId;
    });
    if (already) return "already_listed";
  } catch (error) {
    if (error instanceof PowerNowAttioError && error.status >= 500) throw error;
  }

  try {
    await attio(fetchImpl, apiKey, "POST", `/lists/${PITCH_COMPETITION_LIST.apiSlug}/entries`, {
      data: {
        parent_record_id: companyId,
        parent_object: PITCH_COMPETITION_LIST.parentObject,
        entry_values: {},
      },
    });
    return "added";
  } catch (error) {
    if (!(error instanceof PowerNowAttioError) || error.status >= 500) throw error;
    const message = error.message.toLowerCase();
    if (["already", "duplicate", "unique", "conflict"].some((token) => message.includes(token))) {
      return "already_listed";
    }
    return "skipped";
  }
}

async function noteExists(
  fetchImpl: FetchLike,
  apiKey: string,
  parentObject: "people" | "companies",
  parentId: string,
  submissionId: string,
): Promise<boolean> {
  const query = new URLSearchParams({
    parent_object: parentObject,
    parent_record_id: parentId,
    limit: "50",
  });
  try {
    const existing = await attio(fetchImpl, apiKey, "GET", `/notes?${query.toString()}`);
    const notes = Array.isArray(existing.data) ? existing.data : [];
    return notes.some((note) => {
      const record = note as { title?: string; content?: string };
      return `${record.title ?? ""}\n${record.content ?? ""}`.includes(submissionId);
    });
  } catch (error) {
    if (error instanceof PowerNowAttioError && error.status >= 500) throw error;
    return false;
  }
}

async function createNote(
  fetchImpl: FetchLike,
  apiKey: string,
  parentObject: "people" | "companies",
  parentId: string,
  title: string,
  content: string,
): Promise<void> {
  await attio(fetchImpl, apiKey, "POST", "/notes", {
    data: {
      parent_object: parentObject,
      parent_record_id: parentId,
      title,
      format: "plaintext",
      content,
    },
  });
}

async function ensureTask(
  fetchImpl: FetchLike,
  apiKey: string,
  lead: NormalizedPowerNow,
  personRecordId: string,
  companyRecordId: string | null,
  flags: string[],
): Promise<{ status: PowerNowIngestResult["taskStatus"]; taskId: string | null; content: string | null }> {
  if (await taskExists(fetchImpl, apiKey, personRecordId, lead.clientSubmissionId)) {
    return { status: "already_recorded", taskId: null, content: null };
  }
  const content = buildPowerNowTaskContent({
    path: lead.path,
    fullName: lead.fullName,
    companyName: lead.companyName,
    personRecordId,
    companyRecordId,
    flags,
    clientSubmissionId: lead.clientSubmissionId,
  });
  const linked = [
    { target_object: "people", target_record_id: personRecordId },
    ...(companyRecordId ? [{ target_object: "companies", target_record_id: companyRecordId }] : []),
  ];
  let taskId: string | null = null;
  try {
    const created = await attio(fetchImpl, apiKey, "POST", "/tasks", {
      data: {
        content,
        format: "plaintext",
        is_completed: false,
        linked_records: linked,
      },
    });
    taskId = taskIdFrom(created.data);
  } catch (error) {
    if (error instanceof PowerNowAttioError && error.status < 500) {
      return { status: "skipped", taskId: null, content: null };
    }
    throw error;
  }

  if (!taskId) {
    console.error("Power NOW task was created without an id, so it was left unassigned.");
    return { status: "created", taskId: null, content };
  }

  try {
    await attio(fetchImpl, apiKey, "PATCH", `/tasks/${taskId}`, {
      data: {
        assignees: [
          {
            referenced_actor_type: "workspace-member",
            referenced_actor_id: powerNowTaskAssigneeId(),
          },
        ],
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`Power NOW task ${taskId} was left unassigned: ${detail}`);
  }
  return { status: "created", taskId, content };
}

function taskIdFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: { task_id?: unknown } | string }).id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (id && typeof id === "object" && typeof id.task_id === "string" && id.task_id.trim()) {
    return id.task_id.trim();
  }
  return null;
}

async function taskExists(
  fetchImpl: FetchLike,
  apiKey: string,
  personRecordId: string,
  submissionId: string,
): Promise<boolean> {
  const query = new URLSearchParams({
    linked_object: "people",
    linked_record_id: personRecordId,
    limit: "50",
  });
  try {
    const existing = await attio(fetchImpl, apiKey, "GET", `/tasks?${query.toString()}`);
    const tasks = Array.isArray(existing.data) ? existing.data : [];
    return tasks.some((task) => {
      const record = task as { content?: string };
      return (record.content ?? "").includes(submissionId);
    });
  } catch (error) {
    if (error instanceof PowerNowAttioError && error.status >= 500) throw error;
    return false;
  }
}

function mergePhones(existing: AttioRecord | null, lead: NormalizedPowerNow): Array<Record<string, string>> {
  const phones: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  for (const value of activeValues(existing, "phone_numbers")) {
    const record = value as { original_phone_number?: string; phone_number?: string; country_code?: string };
    const original = record.original_phone_number || record.phone_number;
    if (!original) continue;
    const digits = normalizePhone(String(original)).digits;
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    const next: Record<string, string> = { original_phone_number: String(original) };
    if (record.country_code) next.country_code = record.country_code;
    phones.push(next);
  }
  if (lead.phoneE164 || lead.phoneOriginal) {
    const digits = lead.phoneDigits ?? "";
    if (digits && !seen.has(digits)) {
      const next: Record<string, string> = {
        original_phone_number: lead.phoneE164 ?? lead.phoneOriginal ?? "",
      };
      if (lead.phoneCountryCode) next.country_code = lead.phoneCountryCode;
      phones.push(next);
    }
  }
  return phones;
}

function mergeCompanies(existing: AttioRecord | null, companyId: string | null): Array<Record<string, string>> {
  const companies: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  for (const value of activeValues(existing, "company")) {
    const record = value as { target_record_id?: string };
    if (!record.target_record_id || seen.has(record.target_record_id)) continue;
    seen.add(record.target_record_id);
    companies.push({ target_object: "companies", target_record_id: record.target_record_id });
  }
  if (companyId && !seen.has(companyId)) {
    companies.push({ target_object: "companies", target_record_id: companyId });
  }
  return companies;
}

async function queryRecords(
  fetchImpl: FetchLike,
  apiKey: string,
  object: "people" | "companies",
  filter: Record<string, unknown>,
  limit: number,
): Promise<AttioRecord[]> {
  const result = await attio(fetchImpl, apiKey, "POST", `/objects/${object}/records/query`, { filter, limit });
  return Array.isArray(result.data) ? result.data.filter(isAttioRecord) : [];
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
  let json: { data?: unknown; message?: string } | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as { data?: unknown; message?: string };
    } catch {
      json = { message: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    throw new PowerNowAttioError(response.status, json?.message || response.statusText || "Attio request failed");
  }
  return json ?? {};
}

function asRecord(value: unknown): AttioRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AttioRecord;
}

function isAttioRecord(value: unknown): value is AttioRecord {
  return Boolean(value) && typeof value === "object";
}

function recordId(record: AttioRecord | null | undefined): string | null {
  if (!record) return null;
  if (typeof record.id === "string") return record.id;
  return record.id?.record_id ?? null;
}

function activeValues(record: AttioRecord | null, slug: string): unknown[] {
  const values = record?.values?.[slug];
  if (!Array.isArray(values)) return [];
  return values;
}

function readText(record: AttioRecord | null, slug: string): string {
  const first = activeValues(record, slug)[0];
  if (!first) return "";
  if (typeof first === "string") return first;
  if (typeof first === "object" && first && typeof (first as { value?: unknown }).value === "string") {
    return (first as { value: string }).value;
  }
  return "";
}

function readEmails(record: AttioRecord): string[] {
  return activeValues(record, "email_addresses")
    .map((value) => {
      if (!value || typeof value !== "object") return "";
      const email = (value as { email_address?: unknown }).email_address;
      return typeof email === "string" ? email : "";
    })
    .filter(Boolean);
}
