/**
 * Accel Analysis lead intake contract.
 *
 * The public form is not event-branded. Event, event id, and list come from
 * the request (URL query on the client) and are stored with the lead. The
 * booth form imports this module so the words on screen are the same words
 * stored in Attio. Consent boxes start unchecked. Unchecked is a recorded no.
 */

export const EXPO_SOURCE = "EXPO-NASA-2026-10-20";
export const EXPO_CAPTURED_BY = "NASA Expo booth";
export const EXPO_TIME_ZONE = "America/New_York";
export const EXPO_DESCRIPTION_MARKER = `WS:${EXPO_SOURCE}`;
export const NASA_EXPO_EVENT = "nasa-expo-2026-10-20";
export const ACCEL_INTAKE_SOURCE = "ACCEL-INTAKE";
export const ACCEL_INTAKE_CAPTURED_BY = "Accel Analysis intake";
export const ACCEL_DISPLAY_NAME = "Accel Analysis";
export const ACCEL_PHONE_DISPLAY = "(757) 236-0651";
export const ACCEL_EMAIL = "JHolman@AccelAnalysis.com";
export const ACCEL_TAGLINE = "Put AI to work without overwhelming your team.";
export const ACCEL_ONE_LINER = "We redesign work so people and AI can work together productively.";

export const INTAKE_PRIVACY_NOTICE =
  "Accel Analysis keeps what you type here so we can follow up on what you asked. The three boxes start unchecked. If you check one, we store yes, the exact wording version, the time in Eastern Time, and the source of this form. If you leave it unchecked, we store no. We do not sell this information. Questions: JHolman@AccelAnalysis.com or (757) 236-0651.";

export const EXPO_LIST = {
  apiSlug: "nasa_expo_2026_10_20_leads",
  listId: "e799de65-f5ad-4def-b9b6-abb0c680d84a",
  parentObject: "people",
} as const;

export const EXPO_ORG_TYPES = [
  { id: "nasa_federal", label: "NASA/federal" },
  { id: "prime", label: "Prime" },
  { id: "sub_small_business", label: "Sub/small business" },
  { id: "other", label: "Other" },
] as const;

export type ExpoOrgType = (typeof EXPO_ORG_TYPES)[number]["id"];

export const EXPO_CONSENT_KEYS = ["email", "sms", "phone"] as const;
export type ExpoConsentKey = (typeof EXPO_CONSENT_KEYS)[number];

/**
 * Version ids cite the exact sentence on the form. Wording is copied into the
 * Attio note only when that box is checked. A new version is required because
 * the set is email, text, and phone — the prior four-box expo wording is retired.
 */
export const EXPO_CONSENT_CATALOG = {
  email: {
    version: "intake-consent-v1-email",
    label: "Email",
    wording:
      "I agree to receive email from Accel Analysis at the email address I provided about my inquiry and the information I requested. I can unsubscribe at any time.",
  },
  sms: {
    version: "intake-consent-v1-sms",
    label: "Text (SMS)",
    wording:
      "I agree to receive text messages from Accel Analysis at the mobile number I provided about my inquiry and related follow-up. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of any purchase.",
  },
  phone: {
    version: "intake-consent-v1-phone",
    label: "Phone",
    wording:
      "I agree that Accel Analysis may call me at the phone number I provided about my inquiry and related follow-up. I can ask them to stop calling at any time.",
  },
} as const satisfies Record<
  ExpoConsentKey,
  { version: string; label: string; wording: string }
>;

export type ExpoLeadPayload = {
  fullName: string;
  organization: string;
  roleTitle: string;
  email: string;
  phone: string;
  orgType: ExpoOrgType | "";
  need: string;
  timing: string;
  interests: {
    powerNow: boolean;
    hiCoworkingEarlyAccess: boolean;
  };
  consent: Record<ExpoConsentKey, boolean>;
  submittedAt: string;
  clientSubmissionId: string;
  /** Present when the form sent URL context. Absent on older booth payloads. */
  event?: string;
  eventId?: string;
  list?: string;
  expo_hp?: string;
};

export type StoredConsent = {
  key: ExpoConsentKey;
  optIn: boolean;
  version: string;
  wording: string | null;
  capturedAtEt: string;
  source: string;
};

export type IntakeFieldSet = "nasa-expo" | "general";

export type IntakeProfile = {
  fieldSet: IntakeFieldSet;
  source: string;
  capturedBy: string;
  event: string | null;
  eventId: string | null;
  requestedList: string | null;
  attioList: typeof EXPO_LIST | null;
  explicit: boolean;
};

export type NormalizedExpoLead = {
  fullName: string;
  organization: string;
  roleTitle: string;
  email: string | null;
  phoneOriginal: string | null;
  phoneE164: string | null;
  phoneDigits: string | null;
  phoneCountryCode: string | null;
  orgType: ExpoOrgType | null;
  orgTypeLabel: string;
  need: string;
  timing: string | null;
  interests: {
    powerNow: boolean;
    hiCoworkingEarlyAccess: boolean;
  };
  consent: StoredConsent[];
  submittedAt: string;
  capturedAtEt: string;
  capturedBy: string;
  source: string;
  event: string | null;
  eventId: string | null;
  requestedList: string | null;
  fieldSet: IntakeFieldSet;
  attioList: typeof EXPO_LIST | null;
  clientSubmissionId: string;
  descriptionTag: string;
  note: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAPTURED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;
const CAPTURED_AT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function formatIsoEastern(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EXPO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;

  return `${read("year")}-${read("month")}-${read("day")}T${String(hour).padStart(2, "0")}:${read("minute")}:${read("second")}${formatOffset(read("timeZoneName"))}`;
}

function formatOffset(timeZoneName: string): string {
  const match = timeZoneName.match(/([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return "Z";
  return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
}

export function normalizeCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function companyNameKey(name: string): string {
  return normalizeCompanyName(name).toLocaleLowerCase("en-US");
}

export function splitPersonName(fullName: string): {
  first_name: string;
  last_name: string;
  full_name: string;
} {
  const full = normalizeCompanyName(fullName);
  const parts = full.split(" ");
  if (parts.length <= 1) {
    return { first_name: full, last_name: "", full_name: full };
  }
  return {
    first_name: parts[0] ?? full,
    last_name: parts.slice(1).join(" "),
    full_name: full,
  };
}

export function normalizePhone(input: string): {
  original: string;
  e164: string | null;
  digits: string;
  countryCode: string | null;
} {
  const original = input.trim();
  const rawDigits = original.replace(/\D/g, "");
  let national = rawDigits;
  if (national.length === 11 && national.startsWith("1")) {
    national = national.slice(1);
  }
  if (national.length === 10) {
    return {
      original,
      e164: `+1${national}`,
      digits: national,
      countryCode: "US",
    };
  }
  if (original.startsWith("+") && rawDigits.length >= 7 && rawDigits.length <= 15) {
    return {
      original,
      e164: `+${rawDigits}`,
      digits: rawDigits,
      countryCode: null,
    };
  }
  return { original, e164: null, digits: rawDigits, countryCode: null };
}

export function orgTypeLabel(orgType: ExpoOrgType): string {
  return EXPO_ORG_TYPES.find((item) => item.id === orgType)?.label ?? orgType;
}

const NASA_EVENT_KEYS = new Set([
  "nasa-expo-2026-10-20",
  "expo-nasa-2026-10-20",
  NASA_EXPO_EVENT,
]);

export function normalizeEventKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function isNasaExpoEvent(event: string, eventId: string, list: string): boolean {
  const keys = [normalizeEventKey(event), normalizeEventKey(eventId)];
  if (keys.some((key) => key.length > 0 && NASA_EVENT_KEYS.has(key))) return true;
  const listKey = list.trim().toLowerCase();
  return listKey === EXPO_LIST.apiSlug || listKey === EXPO_LIST.listId;
}

export function intakeContextFromBody(body: Record<string, unknown>): {
  event: string;
  eventId: string;
  list: string;
  explicit: boolean;
} {
  const explicit = ["event", "eventId", "event_id", "list"].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
  return {
    event: cleanLine(body.event).slice(0, 80),
    eventId: cleanLine(body.eventId ?? body.event_id).slice(0, 80),
    list: cleanLine(body.list).slice(0, 80),
    explicit,
  };
}

/**
 * Legacy booth posts omit event keys and stay on the NASA expo list.
 * The shared form always sends the keys, including empty ones, so a bare
 * /intake visit is a general Accel Analysis lead and does not join that list.
 */
export function resolveIntakeProfile(input: {
  event?: string;
  eventId?: string;
  list?: string;
  explicit: boolean;
}): IntakeProfile {
  const event = sanitizeToken(input.event ?? "");
  const eventId = sanitizeToken(input.eventId ?? "");
  const list = sanitizeToken(input.list ?? "");
  const nasa = !input.explicit || isNasaExpoEvent(event, eventId, list);
  if (nasa) {
    return {
      fieldSet: "nasa-expo",
      source: EXPO_SOURCE,
      capturedBy: EXPO_CAPTURED_BY,
      event: event || eventId || NASA_EXPO_EVENT,
      eventId: eventId || null,
      requestedList: list || EXPO_LIST.apiSlug,
      attioList: EXPO_LIST,
      explicit: input.explicit,
    };
  }
  return {
    fieldSet: "general",
    source: event || eventId || ACCEL_INTAKE_SOURCE,
    capturedBy: ACCEL_INTAKE_CAPTURED_BY,
    event: event || eventId || null,
    eventId: eventId || null,
    requestedList: list || null,
    attioList: null,
    explicit: true,
  };
}

export function validateExpoLeadPayload(
  input: unknown,
  now = new Date(),
): { ok: true; lead: NormalizedExpoLead } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "This lead could not be read. Enter it again." };
  }

  const body = input as Record<string, unknown>;
  const fullName = cleanLine(body.fullName);
  const organization = normalizeCompanyName(cleanLine(body.organization));
  const roleTitle = cleanLine(body.roleTitle);
  const emailRaw = cleanLine(body.email).toLowerCase();
  const phoneRaw = cleanLine(body.phone);
  const need = cleanMultiline(body.need);
  const timing = cleanLine(body.timing);
  const clientSubmissionId = cleanLine(body.clientSubmissionId).toLowerCase();
  const profile = resolveIntakeProfile(intakeContextFromBody(body));

  if (!fullName || fullName.length > 120) {
    return { ok: false, error: "Enter the visitor's full name." };
  }
  if (!organization || organization.length > 160) {
    return { ok: false, error: "Enter their organization." };
  }
  if (!roleTitle || roleTitle.length > 120) {
    return { ok: false, error: "Enter their role or title." };
  }
  if (profile.fieldSet === "nasa-expo") {
    if (!isOrgType(body.orgType)) {
      return { ok: false, error: "Choose an organization type." };
    }
  } else if (cleanLine(body.orgType) && !isOrgType(body.orgType)) {
    return { ok: false, error: "Choose an organization type." };
  }
  if (!need || need.length > 500) {
    return { ok: false, error: "Enter what they need, in their words." };
  }
  if (timing.length > 120) {
    return { ok: false, error: "Timing should be a short note." };
  }
  if (!UUID_PATTERN.test(clientSubmissionId)) {
    return { ok: false, error: "This lead is missing its booth id. Enter it again." };
  }

  const email = emailRaw.length > 0 ? emailRaw : null;
  if (email && (email.length > 200 || !EMAIL_PATTERN.test(email))) {
    return { ok: false, error: "That email doesn't look right." };
  }

  const phone = phoneRaw.length > 0 ? normalizePhone(phoneRaw) : null;
  if (phone && (phone.digits.length < 7 || phone.digits.length > 15 || phoneRaw.length > 40)) {
    return { ok: false, error: "That phone number doesn't look right." };
  }
  if (!email && !phone) {
    return { ok: false, error: "Enter an email or a phone number." };
  }

  const interests = readInterests(body.interests);
  const consentFlags = readConsentFlags(body.consent);
  if (consentFlags.sms && !phone) {
    return { ok: false, error: "Text consent needs a phone number." };
  }
  if (consentFlags.phone && !phone) {
    return { ok: false, error: "Phone consent needs a phone number." };
  }
  if (consentFlags.email && !email) {
    return { ok: false, error: "Email consent needs an email address." };
  }

  const capturedAt = resolveCapturedAt(body.submittedAt, now);
  const capturedAtEt = formatIsoEastern(capturedAt);
  const consent = EXPO_CONSENT_KEYS.map((key) =>
    toStoredConsent(key, consentFlags[key], capturedAtEt, profile.source),
  );
  const orgType = isOrgType(body.orgType) ? body.orgType : null;

  const leadWithoutCopy: Omit<NormalizedExpoLead, "descriptionTag" | "note"> = {
    fullName,
    organization,
    roleTitle,
    email,
    phoneOriginal: phone?.original ?? null,
    phoneE164: phone?.e164 ?? null,
    phoneDigits: phone?.digits ?? null,
    phoneCountryCode: phone?.countryCode ?? null,
    orgType,
    orgTypeLabel: orgType ? orgTypeLabel(orgType) : "Not asked",
    need,
    timing: timing || null,
    interests,
    consent,
    submittedAt: capturedAt.toISOString(),
    capturedAtEt,
    capturedBy: profile.capturedBy,
    source: profile.source,
    event: profile.event,
    eventId: profile.eventId,
    requestedList: profile.requestedList,
    fieldSet: profile.fieldSet,
    attioList: profile.attioList,
    clientSubmissionId,
  };

  return {
    ok: true,
    lead: {
      ...leadWithoutCopy,
      descriptionTag: buildDescriptionTag(leadWithoutCopy),
      note: buildExpoLeadNote(leadWithoutCopy),
    },
  };
}

export function buildDescriptionTag(
  lead: Omit<NormalizedExpoLead, "descriptionTag" | "note">,
): string {
  const interests = [
    lead.interests.powerNow ? "power_now" : null,
    lead.interests.hiCoworkingEarlyAccess ? "hi_coworking_early_access" : null,
  ].filter((item): item is string => Boolean(item));
  const optedIn = lead.consent.filter((item) => item.optIn).map((item) => item.key);
  const marker = lead.fieldSet === "nasa-expo" ? EXPO_DESCRIPTION_MARKER : `WS:${ACCEL_INTAKE_SOURCE}`;
  const parts = [
    marker,
    `event:${sanitizeTagPart(lead.event ?? "none").slice(0, 80)}`,
    lead.orgType ? `org:${lead.orgType}` : "org:not_asked",
    `need:${sanitizeTagPart(lead.need).slice(0, 80)}`,
    lead.timing ? `timing:${sanitizeTagPart(lead.timing).slice(0, 40)}` : null,
    interests.length > 0 ? `interests:${interests.join(",")}` : "interests:none",
    optedIn.length > 0 ? `consent:${optedIn.join(",")}` : "consent:none",
    `by:${lead.capturedBy}`,
    `at:${lead.capturedAtEt}`,
    `sub:${lead.clientSubmissionId}`,
  ].filter((part): part is string => Boolean(part));
  return `[${parts.join(" | ")}]`;
}

export function mergeDescription(existing: string, tag: string, submissionId: string): string {
  if (existing.includes(`sub:${submissionId}`)) return existing;
  const base = existing.trim();
  const merged = base ? `${base}\n${tag}` : tag;
  if (merged.length <= 10_000) return merged;
  return merged.slice(merged.length - 10_000);
}

export function buildExpoLeadNote(
  lead: Omit<NormalizedExpoLead, "descriptionTag" | "note">,
): string {
  const lines = [
    "Accel Analysis lead",
    `Source: ${lead.source}`,
    `Event: ${lead.event ?? "none"}`,
    `List: ${lead.requestedList ?? "none"}`,
    `Submission: ${lead.clientSubmissionId}`,
    `Captured by: ${lead.capturedBy}`,
    `Captured at (ET): ${lead.capturedAtEt}`,
    "",
    "Person",
    `Name: ${lead.fullName}`,
    `Organization: ${lead.organization}`,
    `Role: ${lead.roleTitle}`,
    `Email: ${lead.email ?? "none"}`,
    `Phone: ${lead.phoneOriginal ?? "none"}`,
    `Org type: ${lead.orgType ? `${lead.orgTypeLabel} (${lead.orgType})` : lead.orgTypeLabel}`,
    `Timing: ${lead.timing ?? "not given"}`,
    "",
    "Need",
    lead.need,
    "",
    "Interests",
    `Power NOW: ${lead.interests.powerNow ? "yes" : "no"}`,
    `Hi Coworking Early Access: ${lead.interests.hiCoworkingEarlyAccess ? "yes" : "no"}`,
    "",
    "Consent",
    ...lead.consent.map(formatConsentBlock),
  ];
  return lines.join("\n");
}

function formatConsentBlock(consent: StoredConsent): string {
  const label = EXPO_CONSENT_CATALOG[consent.key].label;
  const lines = [
    `${label}: ${consent.optIn ? "yes" : "no"}`,
    `Version: ${consent.version}`,
    `At (ET): ${consent.capturedAtEt}`,
    `Source: ${consent.source}`,
  ];
  if (consent.optIn && consent.wording) {
    lines.push(`Wording: "${consent.wording}"`);
  }
  return lines.join("\n");
}

function toStoredConsent(
  key: ExpoConsentKey,
  optIn: boolean,
  capturedAtEt: string,
  source: string,
): StoredConsent {
  const catalog = EXPO_CONSENT_CATALOG[key];
  return {
    key,
    optIn,
    version: catalog.version,
    wording: optIn ? catalog.wording : null,
    capturedAtEt,
    source,
  };
}

function resolveCapturedAt(submittedAt: unknown, now: Date): Date {
  if (typeof submittedAt !== "string" || !submittedAt.trim()) return now;
  const parsed = new Date(submittedAt);
  if (Number.isNaN(parsed.getTime())) return now;
  const skew = parsed.getTime() - now.getTime();
  if (skew > CAPTURED_AT_MAX_FUTURE_MS) return now;
  if (now.getTime() - parsed.getTime() > CAPTURED_AT_MAX_AGE_MS) return now;
  return parsed;
}

function readInterests(value: unknown): NormalizedExpoLead["interests"] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    powerNow: record.powerNow === true,
    hiCoworkingEarlyAccess: record.hiCoworkingEarlyAccess === true,
  };
}

function readConsentFlags(value: unknown): Record<ExpoConsentKey, boolean> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    email: record.email === true,
    sms: record.sms === true,
    phone: record.phone === true,
  };
}

function sanitizeToken(value: string): string {
  return value.replace(/[^\w.:@+-]/g, "").slice(0, 80);
}

function isOrgType(value: unknown): value is ExpoOrgType {
  return EXPO_ORG_TYPES.some((item) => item.id === value);
}

function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeTagPart(value: string): string {
  return value.replace(/[[\]|\n\r]+/g, " ").replace(/\s+/g, " ").trim();
}
