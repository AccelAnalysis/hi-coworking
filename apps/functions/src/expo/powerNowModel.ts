/**
 * Power NOW interest page contract.
 *
 * Three short forms share the Accel intake function. Path is allow-listed.
 * Until Jonathan approves new Attio attributes and lists, submissions are
 * stored as description tags plus one note. Consent wording lives here so
 * the page and the Attio record show the same sentence.
 */

import {
  formatIsoEastern,
  normalizePhone,
  splitPersonName,
} from "./nasaLeadModel";

export const POWER_NOW_FORM = "power-now";
export const POWER_NOW_SOURCE = "power-now-interest-page";
export const POWER_NOW_PATHS = ["pitch", "watch", "contribute"] as const;
export type PowerNowPath = (typeof POWER_NOW_PATHS)[number];

export const POWER_NOW_CONSENT_VERSION = {
  pitch: "PN-CONSENT-PITCH-v0.2",
  watch: "PN-CONSENT-WATCH-v0.2",
  contribute: "PN-CONSENT-CONTRIB-v0.2",
} as const;

/** Existing Companies list. System attributes only. Do not add list fields. */
export const PITCH_COMPETITION_LIST = {
  apiSlug: "pitch_competition",
  listId: "29b532c7-69fb-44bc-819f-055ab1eda935",
  parentObject: "companies",
} as const;

export const BUSINESS_STAGES = ["Idea", "Prototype or testing", "Early revenue", "Other"] as const;
export const HEARD_ABOUT_OPTIONS = [
  "LinkedIn",
  "Email",
  "Friend or colleague",
  "Event or expo",
  "Accel Analysis website",
  "Other",
] as const;
export const OFFER_TYPES = ["Product", "Service", "Experience", "Other"] as const;

export const POWER_NOW_CHANNELS = {
  pitch: ["email", "sms", "phone"],
  watch: ["email", "sms"],
  contribute: ["email", "sms", "phone"],
} as const;

export type PowerNowChannel = "email" | "sms" | "phone";

export const POWER_NOW_SEND_ERROR =
  "We couldn’t send your form. Please try again, or email hello@accelanalysis.com.";
export const POWER_NOW_RATE_LIMIT_ERROR =
  "Please wait a few minutes and try again, or email hello@accelanalysis.com.";
export const POWER_NOW_WATCH_CONSENT_ERROR =
  "Please choose email, text, or both so we can send you updates.";
export const POWER_NOW_PHONE_ERROR = "Please add a phone number, or uncheck text and phone.";
export const POWER_NOW_WATCH_PHONE_ERROR = "Please add a phone number, or uncheck text.";

const PITCH_SMS =
  "Text me about my Power NOW pitch interest, including scheduling my conversation and, if I pitch, my pitch night. By checking this box, I agree that Accel Analysis may send text messages to the mobile number above for these purposes. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent isn’t required to join.";
const WATCH_SMS =
  "Text me about upcoming Power NOW pitch nights. By checking this box, I agree that Accel Analysis may send text messages to the mobile number above about upcoming Power NOW pitch nights. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent isn’t required to join.";
const CONTRIB_SMS =
  "Text me about my Power NOW prize offer. By checking this box, I agree that Accel Analysis may send text messages to the mobile number above about my offer. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent isn’t required to submit.";

export const POWER_NOW_CONSENT_CATALOG = {
  pitch: {
    version: POWER_NOW_CONSENT_VERSION.pitch,
    leadIn:
      "We’ll email you about your interest in pitching, including setting up your conversation. Choose any other ways Accel Analysis may contact you. These are optional.",
    channels: {
      email: {
        label: "Email updates",
        wording: "Email me about future Power NOW pitch nights. I can unsubscribe at any time.",
      },
      sms: { label: "Text messages (SMS)", wording: PITCH_SMS },
      phone: {
        label: "Phone calls",
        wording:
          "Accel Analysis may call me at the number above about my pitch interest. Calls come from a person at (757) 236-0651.",
      },
    },
  },
  watch: {
    version: POWER_NOW_CONSENT_VERSION.watch,
    leadIn: "How would you like to hear about upcoming Power NOW pitch nights? Choose at least one.",
    channels: {
      email: {
        label: "Email",
        wording:
          "Email me about upcoming Power NOW pitch nights, including how to join online. I can unsubscribe at any time.",
      },
      sms: { label: "Text messages (SMS)", wording: WATCH_SMS },
    },
  },
  contribute: {
    version: POWER_NOW_CONSENT_VERSION.contribute,
    leadIn:
      "We’ll email you about your offer. Choose any other ways Accel Analysis may contact you. These are optional.",
    channels: {
      email: {
        label: "Email updates",
        wording: "Email me about future Power NOW pitch nights. I can unsubscribe at any time.",
      },
      sms: { label: "Text messages (SMS)", wording: CONTRIB_SMS },
      phone: {
        label: "Phone calls",
        wording:
          "Accel Analysis may call me at the number above about my offer. Calls come from a person at (757) 236-0651.",
      },
    },
  },
} as const;

export type PowerNowConsentRecord = {
  key: PowerNowChannel;
  optIn: boolean;
  version: string;
  wording: string;
  capturedAtEt: string;
  source: typeof POWER_NOW_SOURCE;
  phone: string | null;
};

export type PowerNowUtm = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
};

export type PowerNowAnswer = {
  label: string;
  value: string;
};

export type NormalizedPowerNow = {
  path: PowerNowPath;
  fullName: string;
  firstName: string;
  email: string;
  phoneOriginal: string | null;
  phoneE164: string | null;
  phoneDigits: string | null;
  phoneCountryCode: string | null;
  companyName: string | null;
  unnamedBusiness: boolean;
  createCompany: boolean;
  answers: PowerNowAnswer[];
  consent: PowerNowConsentRecord[];
  utm: PowerNowUtm;
  referrerPath: string | null;
  submittedAt: string;
  capturedAtEt: string;
  source: typeof POWER_NOW_SOURCE;
  clientSubmissionId: string;
  descriptionTag: string;
};

export type PowerNowFieldErrors = Record<string, string>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAPTURED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;
const CAPTURED_AT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function isPowerNowPath(value: string): value is PowerNowPath {
  return (POWER_NOW_PATHS as readonly string[]).includes(value);
}

export function canonicalizePowerNowPath(value: unknown): PowerNowPath | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return isPowerNowPath(key) ? key : null;
}

export function isUnnamedBusiness(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").replace(/\.+$/, "").toLocaleLowerCase("en-US");
  return normalized === "not named yet";
}

export function consentSentence(path: PowerNowPath, channel: PowerNowChannel): string | null {
  const channels = POWER_NOW_CONSENT_CATALOG[path].channels as Partial<
    Record<PowerNowChannel, { label: string; wording: string }>
  >;
  const item = channels[channel];
  if (!item) return null;
  return `${item.label}: ${item.wording}`;
}

export function watchUpdatePhrase(email: boolean, sms: boolean): "email" | "text" | "email and text" {
  if (email && sms) return "email and text";
  if (sms) return "text";
  return "email";
}

export function buildPowerNowDescriptionTag(
  lead: Omit<NormalizedPowerNow, "descriptionTag">,
): string {
  const marker = lead.path === "pitch" ? "interest" : lead.path === "contribute" ? "prize-offer" : null;
  const utmParts = [
    lead.utm.source ? `source=${lead.utm.source}` : null,
    lead.utm.medium ? `medium=${lead.utm.medium}` : null,
    lead.utm.campaign ? `campaign=${lead.utm.campaign}` : null,
    lead.utm.content ? `content=${lead.utm.content}` : null,
  ].filter((part): part is string => Boolean(part));
  const parts = [
    "PN",
    `path:${lead.path}`,
    marker,
    `src:${POWER_NOW_SOURCE}`,
    utmParts.length > 0 ? `utm:${utmParts.join(",")}` : "utm:none",
    lead.referrerPath ? `ref:${lead.referrerPath}` : null,
    lead.capturedAtEt,
    `sub:${lead.clientSubmissionId}`,
  ].filter((part): part is string => Boolean(part));
  return `[${parts.join(" | ")}]`;
}

export function powerNowNoteTitle(path: PowerNowPath, capturedAtEt: string): string {
  return `Power NOW ${path} interest ${capturedAtEt}`.slice(0, 200);
}

export function powerNowFlags(
  lead: NormalizedPowerNow,
  status: {
    companyLinked: boolean;
    listStatus: "added" | "already_listed" | "skipped" | "not_applicable";
  },
): string[] {
  const flags: string[] = [];
  if (lead.unnamedBusiness) flags.push("unnamed-business");
  if (lead.createCompany && !status.companyLinked) flags.push("company-not-linked");
  if (
    lead.path === "pitch" &&
    status.listStatus !== "added" &&
    status.listStatus !== "already_listed"
  ) {
    flags.push("pitch-list-not-added");
  }
  if (lead.consent.some((item) => item.key === "sms" && item.optIn)) flags.push("sms-opt-in");
  if (lead.consent.some((item) => item.key === "phone" && item.optIn)) flags.push("phone-opt-in");
  return flags;
}

export function buildPowerNowNote(
  lead: NormalizedPowerNow,
  context: { flags: string[]; taskStatus: string },
): string {
  const lines = [
    `Power NOW ${lead.path} interest`,
    `Source: ${lead.source}`,
    `UTM source: ${lead.utm.source || "none"}`,
    `UTM medium: ${lead.utm.medium || "none"}`,
    `UTM campaign: ${lead.utm.campaign || "none"}`,
    `UTM content: ${lead.utm.content || "none"}`,
    `Referrer path: ${lead.referrerPath ?? "none"}`,
    `Submission: ${lead.clientSubmissionId}`,
    `Captured at (ET): ${lead.capturedAtEt}`,
    `Task: ${context.taskStatus}`,
    "",
    "Person",
    `Name: ${lead.fullName}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phoneOriginal ?? "none"}`,
    "",
    "Answers",
    ...lead.answers.map((answer) => `${answer.label}: ${answer.value}`),
    "",
    "Flags",
    context.flags.length > 0 ? context.flags.join(", ") : "none",
    "",
    "Consent",
    ...lead.consent.map(formatConsentBlock),
  ];
  return lines.join("\n");
}

export function buildPowerNowTaskContent(input: {
  path: PowerNowPath;
  fullName: string;
  companyName: string | null;
  personRecordId: string;
  companyRecordId: string | null;
  flags: string[];
  clientSubmissionId: string;
}): string {
  return [
    `Power NOW ${input.path} interest for Jessica.`,
    `Name: ${input.fullName}`,
    `Company: ${input.companyName ?? "none"}`,
    `Attio person: https://app.attio.com/accel-analysis/person/${input.personRecordId}/overview`,
    input.companyRecordId
      ? `Attio company: https://app.attio.com/accel-analysis/company/${input.companyRecordId}/overview`
      : "Attio company: none",
    `Flags: ${input.flags.length > 0 ? input.flags.join(", ") : "none"}`,
    `Submission: ${input.clientSubmissionId}`,
  ]
    .join("\n")
    .slice(0, 2000);
}

export function validatePowerNowPayload(
  input: unknown,
  now = new Date(),
): { ok: true; lead: NormalizedPowerNow } | { ok: false; error: string; fields: PowerNowFieldErrors } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "This form could not be read. Please try again.", fields: { form: "This form could not be read. Please try again." } };
  }

  const body = input as Record<string, unknown>;
  const path = canonicalizePowerNowPath(body.path);
  const fields: PowerNowFieldErrors = {};
  if (!path) {
    fields.path = "Choose pitch, watch, or contribute.";
    return { ok: false, error: fields.path, fields };
  }

  const fullName = cleanLine(body.fullName);
  const email = cleanLine(body.email).toLowerCase();
  const phoneRaw = cleanLine(body.phone);
  const businessName = cleanLine(body.businessName);
  const company = cleanLine(body.company);
  const city = cleanLine(body.city);
  const stage = cleanLine(body.businessStage);
  const stageOther = cleanLine(body.businessStageOther);
  const businessDescription = cleanMultiline(body.businessDescription);
  const pitchTopic = cleanMultiline(body.pitchTopic);
  const progress = cleanMultiline(body.progress);
  const heard = cleanLine(body.heardAbout);
  const heardOther = cleanLine(body.heardAboutOther);
  const offerType = cleanLine(body.offerType);
  const offerDescription = cleanMultiline(body.offerDescription);
  const approximateValue = cleanLine(body.approximateValue);
  const website = cleanLine(body.website);
  const clientSubmissionId = cleanLine(body.clientSubmissionId).toLowerCase();
  const consentFlags = readConsentFlags(body.consent);
  const channels = POWER_NOW_CHANNELS[path] as readonly PowerNowChannel[];

  if (!fullName || fullName.length > 120) fields.name = "Please add your name.";
  if (!email || email.length > 200 || !EMAIL_PATTERN.test(email)) fields.email = "Please add your email.";

  const phoneProvided = phoneRaw.length > 0;
  const phone = phoneProvided ? normalizePhone(phoneRaw) : null;
  if (phoneProvided && (phoneRaw.length > 40 || !phone || phone.digits.length < 7 || phone.digits.length > 15)) {
    fields.phone = "Please add your phone.";
  }

  if (path === "pitch") {
    if (!businessName || businessName.length > 160) fields.business = "Please add your business name.";
    if (!city || city.length > 120) fields.city = "Please add your city or county.";
    if (!isChoice(stage, BUSINESS_STAGES)) fields.stage = "Please add your business stage.";
    else if (stage === "Other" && (!stageOther || stageOther.length > 80)) fields.stage = "Please add your business stage.";
    if (!businessDescription || businessDescription.length > 600) {
      fields.does = businessDescription.length > 600
        ? "Please shorten your answer about what your business does to 600 characters."
        : "Please add your answer about what your business does.";
    }
    if (!pitchTopic || pitchTopic.length > 600) {
      fields.pitch = pitchTopic.length > 600
        ? "Please shorten your answer about what you’d pitch to 600 characters."
        : "Please add your answer about what you’d pitch.";
    }
    if (progress.length > 600) fields.progress = "Please shorten your progress note to 600 characters.";
  }

  if (path === "watch" && company.length > 160) fields.company = "Please shorten your company name.";

  if (path === "contribute") {
    if (!businessName || businessName.length > 160) fields.business = "Please add your business name.";
    if (!isChoice(offerType, OFFER_TYPES)) fields.offerType = "Please add your offer type.";
    if (!offerDescription || offerDescription.length > 600) {
      fields.offer = offerDescription.length > 600
        ? "Please shorten your offer description to 600 characters."
        : "Please add your offer description.";
    }
    if (approximateValue.length > 80) fields.value = "Please shorten the approximate value.";
    if (website && !isWebsite(website)) fields.website = "Please add your business website or social link.";
  }

  if (heard && !isChoice(heard, HEARD_ABOUT_OPTIONS)) fields.heard = "Please add how you heard about Power NOW.";
  if (heard === "Other" && heardOther.length > 80) fields.heard = "Please shorten how you heard about Power NOW.";

  const wantsSms = channels.includes("sms") && consentFlags.sms;
  const wantsPhone = channels.includes("phone") && consentFlags.phone;
  if ((wantsSms || wantsPhone) && !phoneProvided && !fields.phone) {
    fields.phone = path === "watch" ? POWER_NOW_WATCH_PHONE_ERROR : POWER_NOW_PHONE_ERROR;
  }
  if (path === "watch" && !consentFlags.email && !consentFlags.sms) {
    fields.consent = POWER_NOW_WATCH_CONSENT_ERROR;
  }

  if (!UUID_PATTERN.test(clientSubmissionId)) {
    fields.form = "This form could not be read. Please try again.";
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: Object.values(fields)[0] ?? POWER_NOW_SEND_ERROR, fields };
  }

  const capturedAt = resolveCapturedAt(body.submittedAt, now);
  const capturedAtEt = formatIsoEastern(capturedAt);
  const phoneOriginal = phone?.original ?? null;
  const phoneForConsent = phone?.e164 ?? phoneOriginal;
  const consent: PowerNowConsentRecord[] = channels.map((key): PowerNowConsentRecord => {
    const wording = consentSentence(path, key) ?? "";
    const optIn = consentFlags[key] === true;
    return {
      key,
      optIn,
      version: POWER_NOW_CONSENT_VERSION[path],
      wording,
      capturedAtEt,
      source: POWER_NOW_SOURCE,
      phone: key === "sms" || key === "phone" ? phoneForConsent : null,
    };
  });

  const unnamedBusiness = path === "pitch" && isUnnamedBusiness(businessName);
  const namedCompany = path === "watch" ? company : businessName;
  const createCompany = path === "watch" ? company.length > 0 : path === "contribute" || !unnamedBusiness;
  const companyName = createCompany ? namedCompany : null;
  const heardValue = formatChoice(heard, heardOther);
  const stageValue = stage === "Other" ? `Other: ${stageOther}` : stage;

  const answers = answersForPath(path, {
    businessName,
    company,
    city,
    stageValue,
    businessDescription,
    pitchTopic,
    progress,
    heardValue,
    offerType,
    offerDescription,
    approximateValue,
    website,
  });

  const name = splitPersonName(fullName);
  const leadWithoutTag: Omit<NormalizedPowerNow, "descriptionTag"> = {
    path,
    fullName: name.full_name,
    firstName: name.first_name,
    email,
    phoneOriginal,
    phoneE164: phone?.e164 ?? null,
    phoneDigits: phone?.digits ?? null,
    phoneCountryCode: phone?.countryCode ?? null,
    companyName,
    unnamedBusiness,
    createCompany,
    answers,
    consent,
    utm: {
      source: sanitizeUtm(body.utmSource),
      medium: sanitizeUtm(body.utmMedium),
      campaign: sanitizeUtm(body.utmCampaign),
      content: sanitizeUtm(body.utmContent),
    },
    referrerPath: sanitizeReferrerPath(body.referrerPath),
    submittedAt: capturedAt.toISOString(),
    capturedAtEt,
    source: POWER_NOW_SOURCE,
    clientSubmissionId,
  };

  return {
    ok: true,
    lead: {
      ...leadWithoutTag,
      descriptionTag: buildPowerNowDescriptionTag(leadWithoutTag),
    },
  };
}

function answersForPath(
  path: PowerNowPath,
  input: {
    businessName: string;
    company: string;
    city: string;
    stageValue: string;
    businessDescription: string;
    pitchTopic: string;
    progress: string;
    heardValue: string | null;
    offerType: string;
    offerDescription: string;
    approximateValue: string;
    website: string;
  },
): PowerNowAnswer[] {
  if (path === "pitch") {
    return [
      { label: "Business name", value: input.businessName },
      { label: "City or county", value: input.city },
      { label: "Business stage", value: input.stageValue },
      { label: "What does your business do, and what problem does it solve?", value: input.businessDescription },
      { label: "What would you pitch?", value: input.pitchTopic },
      { label: "What progress have you made so far?", value: input.progress || "not given" },
      { label: "How did you hear about Power NOW?", value: input.heardValue ?? "not given" },
    ];
  }
  if (path === "watch") {
    return [{ label: "Company", value: input.company || "not given" }];
  }
  return [
    { label: "Business name", value: input.businessName },
    { label: "What would you like to offer?", value: input.offerType },
    { label: "Describe your offer", value: input.offerDescription },
    { label: "Approximate value", value: input.approximateValue || "not stated" },
    { label: "Business website or social link", value: input.website || "not given" },
    { label: "How did you hear about Power NOW?", value: input.heardValue ?? "not given" },
  ];
}

function formatConsentBlock(consent: PowerNowConsentRecord): string {
  const lines = [
    `${consent.key}: ${consent.optIn ? "yes" : "no"}`,
    `Version: ${consent.version}`,
    `At (ET): ${consent.capturedAtEt}`,
    `Source: ${consent.source}`,
    `Wording: "${consent.wording}"`,
  ];
  if (consent.phone) lines.push(`Phone: ${consent.phone}`);
  return lines.join("\n");
}

function formatChoice(choice: string, other: string): string | null {
  if (!choice) return null;
  if (choice === "Other") return other ? `Other: ${other}` : "Other";
  return choice;
}

function readConsentFlags(value: unknown): Record<PowerNowChannel, boolean> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    email: record.email === true,
    sms: record.sms === true,
    phone: record.phone === true,
  };
}

function resolveCapturedAt(submittedAt: unknown, now: Date): Date {
  if (typeof submittedAt !== "string" || !submittedAt.trim()) return now;
  const parsed = new Date(submittedAt);
  if (Number.isNaN(parsed.getTime())) return now;
  if (parsed.getTime() - now.getTime() > CAPTURED_AT_MAX_FUTURE_MS) return now;
  if (now.getTime() - parsed.getTime() > CAPTURED_AT_MAX_AGE_MS) return now;
  return parsed;
}

function isChoice<T extends string>(value: string, choices: readonly T[]): value is T {
  return (choices as readonly string[]).includes(value);
}

function isWebsite(value: string): boolean {
  if (value.length > 300 || /\s/.test(value)) return false;
  if (/^https?:\/\/[^\s]+$/i.test(value)) return true;
  return /^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(value);
}

function sanitizeUtm(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.includes("@")) return "";
  return value.replace(/[^\w.+~:/-]/g, "").slice(0, 80);
}

function sanitizeReferrerPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.includes("@") || /[\s|\[\]]/.test(path)) return null;
  return path.slice(0, 120);
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
