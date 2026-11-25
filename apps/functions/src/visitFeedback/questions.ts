/**
 * Canonical post-attendance survey questions and validation.
 * Keys are stable names, never "1"-"10", so they cannot be confused with
 * the Coming Soon Shape the Space survey.
 */

export const VISIT_FEEDBACK_SOURCE = "post-attendance-v1";
export const VISIT_FEEDBACK_COLLECTION = "visitFeedback";
export const VISIT_FEEDBACK_TEMPLATE = "visit-feedback-invite-v1";

export const SURVEY_INTRO =
  "Thank you for spending time at Hi Coworking. This short survey takes about two minutes and helps us improve the space.";

export const SURVEY_THANKS =
  "Thank you for your feedback. We're glad you came by, and we'll use what you shared to make Hi Coworking better.";

export const PURPOSE_OPTIONS = [
  { value: "desk", label: "I booked a desk" },
  { value: "conference", label: "I booked the conference or meeting room" },
  { value: "event", label: "I attended an event" },
  { value: "tour", label: "I came for a tour" },
  { value: "other", label: "Other" },
] as const;

export const FOUND_US_OPTIONS = [
  { value: "search", label: "Google or another search" },
  { value: "social", label: "Social media" },
  { value: "friend", label: "A friend or colleague" },
  { value: "in_person", label: "I saw the space in person" },
  { value: "event", label: "An event or local group" },
  { value: "member", label: "I'm already a member" },
  { value: "other", label: "Other" },
] as const;

export const RATING_ROWS = [
  { value: "overall", label: "The space overall" },
  { value: "quiet", label: "Quiet and focus" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "desk", label: "Comfort of the desk or chair" },
  { value: "cleanliness", label: "Cleanliness" },
  { value: "access", label: "Booking or getting in" },
] as const;

export const RATING_SCALE = [
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "okay", label: "Okay" },
  { value: "poor", label: "Poor" },
  { value: "did_not_use", label: "Did not use" },
] as const;

export const WORKED_OPTIONS = [
  { value: "quiet", label: "Quiet" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "desk", label: "Desk or chair" },
  { value: "meeting_room", label: "Meeting room" },
  { value: "cleanliness", label: "Cleanliness" },
  { value: "booking", label: "Booking and check-in" },
  { value: "parking", label: "Parking or getting here" },
  { value: "other", label: "Something else" },
] as const;

export const IMPROVE_NOTHING = "nothing";

export const IMPROVE_OPTIONS = [
  { value: "nothing", label: "Nothing — it went well" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "noise", label: "Noise or distractions" },
  { value: "temperature", label: "Temperature" },
  { value: "desk", label: "Desk or chair comfort" },
  { value: "meeting_room", label: "Meeting room or technology" },
  { value: "cleanliness", label: "Cleanliness" },
  { value: "access", label: "Booking, door access, or check-in" },
  { value: "hours", label: "Hours" },
  { value: "parking", label: "Parking or getting here" },
  { value: "other", label: "Something else" },
] as const;

export const RETURN_OPTIONS = [
  { value: "definitely", label: "Definitely" },
  { value: "probably", label: "Probably" },
  { value: "not_sure", label: "Not sure" },
  { value: "probably_not", label: "Probably not" },
  { value: "definitely_not", label: "Definitely not" },
] as const;

export const QUESTION_LABELS = {
  purpose: "What was the main purpose of your visit?",
  foundUs: "How did you first hear about Hi Coworking?",
  ratings: "How would you rate these parts of your visit?",
  worked: "What worked well?",
  improve: "What could we improve?",
  returnLikelihood: "How likely are you to come back?",
  nps: "How likely are you to recommend Hi Coworking to a friend or colleague?",
  comments: "Anything else you'd like us to know?",
  followupConsent: "It's okay for Hi Coworking to follow up with me about this visit.",
} as const;

export const NPS_MIN_LABEL = "Not at all likely";
export const NPS_MAX_LABEL = "Extremely likely";

const PURPOSE = new Set(PURPOSE_OPTIONS.map((o) => o.value));
const FOUND = new Set(FOUND_US_OPTIONS.map((o) => o.value));
const RATING_KEYS = new Set(RATING_ROWS.map((o) => o.value));
const RATING_VALUES = new Set(RATING_SCALE.map((o) => o.value));
const WORKED = new Set(WORKED_OPTIONS.map((o) => o.value));
const IMPROVE = new Set(IMPROVE_OPTIONS.map((o) => o.value));
const RETURN = new Set(RETURN_OPTIONS.map((o) => o.value));

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_TEXT = 2_000;

export type PurposeValue = (typeof PURPOSE_OPTIONS)[number]["value"];
export type FoundUsValue = (typeof FOUND_US_OPTIONS)[number]["value"];
export type RatingKey = (typeof RATING_ROWS)[number]["value"];
export type RatingValue = (typeof RATING_SCALE)[number]["value"];
export type WorkedValue = (typeof WORKED_OPTIONS)[number]["value"];
export type ImproveValue = (typeof IMPROVE_OPTIONS)[number]["value"];
export type ReturnValue = (typeof RETURN_OPTIONS)[number]["value"];

export type VisitFeedbackAnswers = {
  purpose: PurposeValue;
  purposeOther: string;
  foundUs: FoundUsValue;
  foundUsOther: string;
  ratings: Record<RatingKey, RatingValue>;
  worked: WorkedValue[];
  workedOther: string;
  improve: ImproveValue[];
  improveOther: string;
  returnLikelihood: ReturnValue;
  nps: number;
  comments: string;
  followupConsent: boolean;
  followupEmail: string;
};

export type VisitFeedbackValidation =
  | { ok: true; answers: VisitFeedbackAnswers }
  | { ok: false; error: string };

function text(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function oneOf<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

function uniqueAllowed<T extends string>(value: unknown, allowed: Set<T>): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item as T) || seen.has(item)) return null;
    seen.add(item);
    out.push(item as T);
  }
  return out;
}

export function validateVisitFeedbackAnswers(body: unknown, hasBookingEmail: boolean): VisitFeedbackValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Please complete the survey." };
  const raw = body as Record<string, unknown>;

  const purpose = oneOf(raw.purpose, PURPOSE);
  if (!purpose) return { ok: false, error: "Please tell us the main purpose of your visit." };
  const purposeOther = text(raw.purposeOther, 200);
  if (purpose === "other" && !purposeOther) return { ok: false, error: "Please say a little more about the purpose of your visit." };

  const foundUs = oneOf(raw.foundUs, FOUND);
  if (!foundUs) return { ok: false, error: "Please tell us how you first heard about Hi Coworking." };
  const foundUsOther = text(raw.foundUsOther, 200);
  if (foundUs === "other" && !foundUsOther) return { ok: false, error: "Please say a little more about how you heard about us." };

  const ratingsRaw = raw.ratings && typeof raw.ratings === "object" ? raw.ratings as Record<string, unknown> : null;
  if (!ratingsRaw) return { ok: false, error: "Please rate each part of your visit." };
  const ratings = {} as Record<RatingKey, RatingValue>;
  for (const key of RATING_KEYS) {
    const value = oneOf(ratingsRaw[key], RATING_VALUES);
    if (!value) return { ok: false, error: "Please rate each part of your visit." };
    ratings[key] = value;
  }

  const worked = uniqueAllowed(raw.worked ?? [], WORKED);
  if (!worked) return { ok: false, error: "Please check your answers and try again." };
  const workedOther = text(raw.workedOther, 200);
  if (worked.includes("other") && !workedOther) return { ok: false, error: "Please tell us what else worked well." };

  const improve = uniqueAllowed(raw.improve, IMPROVE);
  if (!improve || improve.length === 0) return { ok: false, error: "Please tell us what we could improve, or choose “Nothing — it went well.”" };
  if (improve.includes(IMPROVE_NOTHING) && improve.length > 1) {
    return { ok: false, error: "“Nothing — it went well” can’t be combined with other improvements." };
  }
  const improveOther = text(raw.improveOther, 200);
  if (improve.includes("other") && !improveOther) return { ok: false, error: "Please tell us what else we could improve." };

  const returnLikelihood = oneOf(raw.returnLikelihood, RETURN);
  if (!returnLikelihood) return { ok: false, error: "Please tell us how likely you are to come back." };

  const nps = typeof raw.nps === "number" && Number.isInteger(raw.nps) ? raw.nps : Number(raw.nps);
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) {
    return { ok: false, error: "Please rate how likely you are to recommend Hi Coworking, from 0 to 10." };
  }

  const comments = text(raw.comments);
  const followupConsent = raw.followupConsent === true;
  const followupEmail = text(raw.followupEmail, 254).toLowerCase();
  if (followupConsent && !hasBookingEmail) {
    if (!EMAIL_RE.test(followupEmail)) {
      return { ok: false, error: "Please add an email so we can follow up, or uncheck the follow-up box." };
    }
  }

  return {
    ok: true,
    answers: {
      purpose,
      purposeOther: purpose === "other" ? purposeOther : "",
      foundUs,
      foundUsOther: foundUs === "other" ? foundUsOther : "",
      ratings,
      worked,
      workedOther: worked.includes("other") ? workedOther : "",
      improve,
      improveOther: improve.includes("other") ? improveOther : "",
      returnLikelihood,
      nps,
      comments,
      followupConsent,
      followupEmail: followupConsent && !hasBookingEmail ? followupEmail : "",
    },
  };
}

export function optionLabel<T extends { value: string; label: string }>(options: readonly T[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
