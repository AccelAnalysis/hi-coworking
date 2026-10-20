import {
  appendDescriptionToken,
  logAttioSendFailure,
  readActiveCompanyId,
  singleCompanyValue,
} from "./attioPersonCompany";
import {
  companyNameKey,
  mergeDescription,
  normalizePhone,
  splitPersonName,
  validateExpoLeadPayload,
  type NormalizedExpoLead,
} from "./nasaLeadModel";
import {
  attioIntakeEnabled,
  buildExpoIntakeLead,
  defaultIntakeLeadStore,
  saveIntakeLead,
  type IntakeLeadStore,
} from "./intakeLeadStore";
import { canonicalizePowerNowPath, POWER_NOW_FORM } from "./powerNowModel";
import type { PowerNowConfirmationOptions } from "./powerNowConfirmation";
import { handlePowerNowHttp, type PowerNowConsentLog, type PowerNowRateLimiter } from "./powerNowIngest";

const ATTIO_BASE = "https://api.attio.com/v2";

export class AttioRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "AttioRequestError";
    this.status = status;
    this.code = code;
  }
}

export class ExpoLeadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExpoLeadError";
    this.status = status;
  }
}

export type ExpoIngestResult = {
  ok: true;
  action: "created" | "updated";
  personRecordId: string;
  companyRecordId: string | null;
  companyStatus: "existing" | "created" | "failed";
  listStatus: "added" | "already_listed" | "skipped";
  noteStatus: "created" | "already_recorded";
};

type AttioRecord = {
  id?: { record_id?: string } | string;
  values?: Record<string, unknown>;
};

type FetchLike = typeof fetch;

export async function ingestNasaExpoLead(
  lead: NormalizedExpoLead,
  options: { apiKey: string; fetchImpl?: FetchLike },
): Promise<ExpoIngestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey;
  const existing = lead.email
    ? await findPersonByEmail(fetchImpl, apiKey, lead.email)
    : await findPersonByPhone(fetchImpl, apiKey, lead);
  const keptCompanyId = readActiveCompanyId(existing);
  // Assert a company only when it will be the person's one company record.
  const company = keptCompanyId
    ? { id: keptCompanyId, status: "existing" as const }
    : await findOrCreateCompany(fetchImpl, apiKey, lead);
  const submittedOrganization = keptCompanyId ? lead.organization : null;
  const values = personValues(lead, company.id, existing, submittedOrganization);
  const person = lead.email
    ? await assertPersonByEmail(fetchImpl, apiKey, values)
    : existing
      ? await updatePerson(fetchImpl, apiKey, recordId(existing), values)
      : await createPerson(fetchImpl, apiKey, values);

  const personRecordId = recordId(person);
  if (!personRecordId) {
    throw new AttioRequestError(502, "Attio did not return a person id");
  }

  const listStatus = lead.attioList
    ? await addPersonToExpoList(fetchImpl, apiKey, personRecordId, lead.attioList)
    : "skipped";
  const notedLead = submittedOrganization
    ? { ...lead, note: appendSubmittedOrganization(lead.note, submittedOrganization) }
    : lead;
  const noteStatus = await writeExpoNote(fetchImpl, apiKey, personRecordId, notedLead);

  return {
    ok: true,
    action: existing ? "updated" : "created",
    personRecordId,
    companyRecordId: company.id,
    companyStatus: company.status,
    listStatus,
    noteStatus,
  };
}

export type ExpoHttpResult = {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};

const ALLOWED_ORIGINS = new Set([
  "https://hi-coworking.com",
  "https://www.hi-coworking.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5003",
  "http://127.0.0.1:5003",
]);

/** Public Power NOW host. Pitch, watch, and contribute only — not the booth intake form. */
const POWER_NOW_FORMS_ORIGIN = "https://forms.accelanalysis.com";

export async function handleExpoLeadHttp(request: {
  method: string;
  origin?: string | null;
  contentLength?: number | null;
  body: unknown;
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  now?: Date;
  ip?: string | null;
  rateLimiter?: PowerNowRateLimiter;
  consentLog?: (entry: PowerNowConsentLog) => Promise<void>;
  confirmation?: PowerNowConfirmationOptions;
  attioEnabled?: boolean;
  leadStore?: IntakeLeadStore;
}): Promise<ExpoHttpResult> {
  const headers = corsHeaders(request.origin, request.method, request.body);
  if (request.origin && !isAllowedOrigin(request.origin, request.method, request.body)) {
    return {
      status: 403,
      headers,
      body: { ok: false, error: "This booth form cannot be submitted from that site." },
    };
  }
  if (request.method === "OPTIONS") {
    return { status: 204, headers, body: null };
  }
  if (request.method !== "POST") {
    return { status: 405, headers, body: { ok: false, error: "Method not allowed" } };
  }
  if (request.contentLength && request.contentLength > 20_000) {
    return { status: 413, headers, body: { ok: false, error: "That lead is too large." } };
  }

  const record = request.body && typeof request.body === "object"
    ? (request.body as Record<string, unknown>)
    : null;
  const honeypot = [record?.expo_hp, record?.pn_hp].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (honeypot) {
    return { status: 200, headers, body: { ok: true, accepted: true } };
  }

  if (record?.form === POWER_NOW_FORM) {
    const powerNow = await handlePowerNowHttp({
      body: request.body,
      apiKey: request.apiKey,
      fetchImpl: request.fetchImpl,
      now: request.now,
      ip: request.ip,
      rateLimiter: request.rateLimiter,
      consentLog: request.consentLog,
      confirmation: request.confirmation,
      attioEnabled: request.attioEnabled,
      leadStore: request.leadStore,
    });
    return {
      status: powerNow.status,
      headers: { ...headers, ...powerNow.extraHeaders },
      body: powerNow.body,
    };
  }

  const validated = validateExpoLeadPayload(request.body, request.now ?? new Date());
  if (!validated.ok) {
    return { status: 400, headers, body: { ok: false, error: validated.error } };
  }

  const storedAt = (request.now ?? new Date()).toISOString();
  const saved = await saveIntakeLead(
    request.leadStore ?? defaultIntakeLeadStore(),
    buildExpoIntakeLead(validated.lead, storedAt),
  );
  if (!saved.ok) {
    return { status: 502, headers, body: { ok: false, error: "Could not save this lead." } };
  }
  if (!saved.created) {
    return {
      status: 200,
      headers,
      body: { ok: true, accepted: true, stored: true, duplicate: true, action: "duplicate" },
    };
  }

  const attioOn = request.attioEnabled ?? attioIntakeEnabled();
  const apiKey = request.apiKey?.trim();
  if (attioOn && apiKey) {
    try {
      const result = await ingestNasaExpoLead(validated.lead, {
        apiKey,
        fetchImpl: request.fetchImpl,
      });
      return {
        status: 200,
        headers,
        body: {
          ok: true,
          accepted: true,
          stored: true,
          duplicate: false,
          attioStatus: "saved",
          action: result.action,
          personRecordId: result.personRecordId,
          companyStatus: result.companyStatus,
          listStatus: result.listStatus,
          noteStatus: result.noteStatus,
        },
      };
    } catch (error) {
      logAttioSendFailure("Expo lead", error);
      return {
        status: 200,
        headers,
        body: {
          ok: true,
          accepted: true,
          stored: true,
          duplicate: false,
          attioStatus: "failed",
          action: "stored",
        },
      };
    }
  }

  return {
    status: 200,
    headers,
    body: {
      ok: true,
      accepted: true,
      stored: true,
      duplicate: false,
      attioStatus: attioOn ? "skipped" : "disabled",
      action: "stored",
    },
  };
}

async function findOrCreateCompany(
  fetchImpl: FetchLike,
  apiKey: string,
  lead: NormalizedExpoLead,
): Promise<{ id: string | null; status: "existing" | "created" | "failed" }> {
  const name = lead.organization;
  try {
    const records = await queryRecords(fetchImpl, apiKey, "companies", { name }, 25);
    const match = records.find((record) => companyNameKey(readText(record, "name")) === companyNameKey(name));
    const id = match ? recordId(match) : null;
    if (id) return { id, status: "existing" };
  } catch (error) {
    if (!(error instanceof AttioRequestError) || error.status >= 500) throw error;
  }

  try {
    const created = await attio(fetchImpl, apiKey, "POST", "/objects/companies/records", {
      data: { values: { name: [{ value: name }] } },
    });
    const id = recordId(asRecord(created.data));
    return id ? { id, status: "created" } : { id: null, status: "failed" };
  } catch (error) {
    if (error instanceof AttioRequestError && error.status < 500) {
      return { id: null, status: "failed" };
    }
    throw error;
  }
}

async function findPersonByEmail(
  fetchImpl: FetchLike,
  apiKey: string,
  email: string,
): Promise<AttioRecord | null> {
  const records = await queryRecords(fetchImpl, apiKey, "people", { email_addresses: email }, 5);
  const match = records.find((record) =>
    readEmails(record).some((value) => value.toLowerCase() === email.toLowerCase()),
  );
  return match ?? null;
}

async function findPersonByPhone(
  fetchImpl: FetchLike,
  apiKey: string,
  lead: NormalizedExpoLead,
): Promise<AttioRecord | null> {
  const needles = [lead.phoneE164, lead.phoneOriginal].filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  const matches: AttioRecord[] = [];

  for (const needle of needles) {
    let records: AttioRecord[] = [];
    try {
      records = await queryRecords(fetchImpl, apiKey, "people", { phone_numbers: needle }, 10);
    } catch (error) {
      if (error instanceof AttioRequestError && error.status === 400) continue;
      throw error;
    }
    for (const record of records) {
      const id = recordId(record);
      if (!id || seen.has(id) || !phoneRecordMatches(record, lead.phoneDigits)) continue;
      seen.add(id);
      matches.push(record);
    }
  }

  if (matches.length > 1) {
    throw new ExpoLeadError(
      409,
      "More than one Attio person matches this phone. Add an email so the booth does not merge the wrong people.",
    );
  }
  return matches[0] ?? null;
}

function personValues(
  lead: NormalizedExpoLead,
  companyId: string | null,
  existing: AttioRecord | null,
  submittedOrganization: string | null = null,
): Record<string, unknown> {
  const name = splitPersonName(lead.fullName);
  const descriptionTag = submittedOrganization
    ? appendDescriptionToken(lead.descriptionTag, "submitted-org", submittedOrganization)
    : lead.descriptionTag;
  const values: Record<string, unknown> = {
    name: [name],
    job_title: [{ value: lead.roleTitle }],
    description: [{
      value: mergeDescription(readText(existing, "description"), descriptionTag, lead.clientSubmissionId),
    }],
  };

  if (lead.email) {
    values.email_addresses = [{ email_address: lead.email }];
  }

  const phones = mergePhones(existing, lead);
  if (phones.length > 0) values.phone_numbers = phones;

  if (companyId) values.company = singleCompanyValue(companyId);

  return values;
}

function appendSubmittedOrganization(note: string, organization: string): string {
  const line = `Submitted organization: ${organization.trim()}`;
  if (!organization.trim() || note.includes(line)) return note;
  return `${note}\n${line}`;
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

async function updatePerson(
  fetchImpl: FetchLike,
  apiKey: string,
  personId: string | null,
  values: Record<string, unknown>,
): Promise<AttioRecord> {
  if (!personId) throw new AttioRequestError(502, "Missing person id");
  const result = await attio(fetchImpl, apiKey, "PATCH", `/objects/people/records/${personId}`, {
    data: { values },
  });
  return asRecord(result.data) ?? {};
}

async function createPerson(
  fetchImpl: FetchLike,
  apiKey: string,
  values: Record<string, unknown>,
): Promise<AttioRecord> {
  const result = await attio(fetchImpl, apiKey, "POST", "/objects/people/records", {
    data: { values },
  });
  return asRecord(result.data) ?? {};
}

async function addPersonToExpoList(
  fetchImpl: FetchLike,
  apiKey: string,
  personId: string,
  list: NormalizedExpoLead["attioList"] & object,
): Promise<ExpoIngestResult["listStatus"]> {
  try {
    const listed = await attio(
      fetchImpl,
      apiKey,
      "GET",
      `/objects/people/records/${personId}/entries`,
    );
    const entries = Array.isArray(listed.data) ? listed.data : [];
    const already = entries.some((entry) => {
      const record = entry as { list_api_slug?: string; list_id?: string };
      return record.list_api_slug === list.apiSlug || record.list_id === list.listId;
    });
    if (already) return "already_listed";
  } catch (error) {
    if (error instanceof AttioRequestError && error.status >= 500) throw error;
  }

  try {
    await attio(fetchImpl, apiKey, "POST", `/lists/${list.apiSlug}/entries`, {
      data: {
        parent_record_id: personId,
        parent_object: list.parentObject,
        entry_values: {},
      },
    });
    return "added";
  } catch (error) {
    if (!(error instanceof AttioRequestError) || error.status >= 500) throw error;
    const message = error.message.toLowerCase();
    if (
      message.includes("already") ||
      message.includes("duplicate") ||
      message.includes("unique") ||
      message.includes("conflict")
    ) {
      return "already_listed";
    }
    return "skipped";
  }
}

async function writeExpoNote(
  fetchImpl: FetchLike,
  apiKey: string,
  personId: string,
  lead: NormalizedExpoLead,
): Promise<ExpoIngestResult["noteStatus"]> {
  const query = new URLSearchParams({
    parent_object: "people",
    parent_record_id: personId,
    limit: "50",
  });
  try {
    const existing = await attio(fetchImpl, apiKey, "GET", `/notes?${query.toString()}`);
    const notes = Array.isArray(existing.data) ? existing.data : [];
    const recorded = notes.some((note) => {
      const record = note as { title?: string; content?: string };
      return `${record.title ?? ""}\n${record.content ?? ""}`.includes(lead.clientSubmissionId);
    });
    if (recorded) return "already_recorded";
  } catch (error) {
    if (error instanceof AttioRequestError && error.status >= 500) throw error;
  }

  await attio(fetchImpl, apiKey, "POST", "/notes", {
    data: {
      parent_object: "people",
      parent_record_id: personId,
      title: `Accel Analysis ${lead.source} ${lead.clientSubmissionId}`.slice(0, 200),
      format: "plaintext",
      content: lead.note,
    },
  });
  return "created";
}

function mergePhones(existing: AttioRecord | null, lead: NormalizedExpoLead): Array<Record<string, string>> {
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

async function queryRecords(
  fetchImpl: FetchLike,
  apiKey: string,
  object: "people" | "companies",
  filter: Record<string, unknown>,
  limit: number,
): Promise<AttioRecord[]> {
  const result = await attio(fetchImpl, apiKey, "POST", `/objects/${object}/records/query`, {
    filter,
    limit,
  });
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
  let json: { data?: AttioRecord; message?: string; code?: unknown } | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as { data?: AttioRecord; message?: string; code?: unknown };
    } catch {
      json = { message: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const code = typeof json?.code === "string" && json.code.trim() ? json.code.trim() : null;
    throw new AttioRequestError(
      response.status,
      json?.message || response.statusText || "Attio request failed",
      code,
    );
  }
  return (json ?? {}) as { data?: unknown };
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
  const active = values.filter((value) => {
    if (!value || typeof value !== "object") return true;
    return (value as { active_until?: unknown }).active_until == null;
  });
  return active.length > 0 ? active : values;
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

function phoneRecordMatches(record: AttioRecord, digits: string | null): boolean {
  if (!digits) return false;
  return activeValues(record, "phone_numbers").some((value) => {
    if (!value || typeof value !== "object") return false;
    const recordValue = value as { original_phone_number?: string; phone_number?: string };
    const candidates = [recordValue.original_phone_number, recordValue.phone_number].filter(
      (item): item is string => Boolean(item),
    );
    return candidates.some((candidate) => normalizePhone(candidate).digits === digits);
  });
}

function corsHeaders(origin: string | null | undefined, method: string, body: unknown): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
  };
  if (origin && isAllowedOrigin(origin, method, body)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function isAllowedOrigin(origin: string, method: string, body: unknown): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https:\/\/(?:[a-z0-9-]+--)?hi-coworking-plat\.(?:web\.app|firebaseapp\.com)$/.test(origin)) {
    return true;
  }
  if (origin !== POWER_NOW_FORMS_ORIGIN) return false;
  if (method === "OPTIONS") return true;
  return isPowerNowFormsSubmission(body);
}

function isPowerNowFormsSubmission(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  return record.form === POWER_NOW_FORM && canonicalizePowerNowPath(record.path) !== null;
}
