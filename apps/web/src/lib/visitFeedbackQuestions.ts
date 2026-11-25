/**
 * Customer-facing copy for the post-attendance visit feedback survey.
 * Keep these labels in lockstep with apps/functions/src/visitFeedback/questions.ts
 * (enforced by tests/functions/visit-feedback.test.ts).
 */
export const VISIT_FEEDBACK_COLLECTION = "visitFeedback";
export const VISIT_FEEDBACK_SOURCE = "post-attendance-v1";

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

export function optionLabel<T extends { value: string; label: string }>(options: readonly T[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
