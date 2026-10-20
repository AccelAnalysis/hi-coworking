import { normalizePhone, type ExpoConsentKey, type ExpoOrgType } from "@/lib/expoNasaLead";

export const INTAKE_FIELDS = [
  "fullName",
  "email",
  "phone",
  "organization",
  "roleTitle",
  "orgType",
  "need",
  "timing",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];
export type IntakeFieldErrors = Partial<Record<IntakeField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function line(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

/** Every missing or invalid booth field, in the same words the form already uses. */
export function collectIntakeFieldErrors(input: {
  fullName: string;
  email: string;
  phone: string;
  organization: string;
  roleTitle: string;
  orgType: ExpoOrgType | "";
  need: string;
  timing: string;
  nasaFields: boolean;
  consent: Record<ExpoConsentKey, boolean>;
}): IntakeFieldErrors {
  const fields: IntakeFieldErrors = {};
  const fullName = line(input.fullName);
  const organization = line(input.organization);
  const roleTitle = line(input.roleTitle);
  const email = line(input.email).toLowerCase();
  const phoneRaw = line(input.phone);
  const need = input.need.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n/g, "\n").trim();
  const timing = line(input.timing);

  if (!fullName || fullName.length > 120) fields.fullName = "Enter your full name.";
  if (!organization || organization.length > 160) fields.organization = "Enter your organization.";
  if (!roleTitle || roleTitle.length > 120) fields.roleTitle = "Enter your role or title.";
  if (input.nasaFields && !input.orgType) fields.orgType = "Choose your organization type.";
  if (!need || need.length > 500) fields.need = "Tell us what you need, in your words.";
  if (timing.length > 120) fields.timing = "Please keep timing to a short note.";

  if (email && (email.length > 200 || !EMAIL_PATTERN.test(email))) {
    fields.email = "That email doesn't look right.";
  }
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phone && (phone.digits.length < 7 || phone.digits.length > 15 || phoneRaw.length > 40)) {
    fields.phone = "That phone number doesn't look right.";
  }
  if (!email && !phoneRaw) {
    fields.email = "Enter your email or phone number.";
    fields.phone = "Enter your email or phone number.";
  }
  if (!fields.phone && input.consent.sms && !phoneRaw) {
    fields.phone = "Add your phone number to agree to texts.";
  }
  if (!fields.phone && input.consent.phone && !phoneRaw) {
    fields.phone = "Add your phone number to agree to calls.";
  }
  if (!fields.email && input.consent.email && !email) {
    fields.email = "Add your email to agree to email.";
  }
  return fields;
}

export function firstIntakeField(fields: IntakeFieldErrors): IntakeField | undefined {
  return INTAKE_FIELDS.find((key) => Boolean(fields[key]));
}

const MESSAGE_FIELD: Record<string, IntakeField> = {
  "Enter your full name.": "fullName",
  "Enter your organization.": "organization",
  "Enter your role or title.": "roleTitle",
  "Choose your organization type.": "orgType",
  "Tell us what you need, in your words.": "need",
  "Please keep timing to a short note.": "timing",
  "That email doesn't look right.": "email",
  "That phone number doesn't look right.": "phone",
  "Enter your email or phone number.": "email",
  "Add your phone number to agree to texts.": "phone",
  "Add your phone number to agree to calls.": "phone",
  "Add your email to agree to email.": "email",
  "Add your email so we follow up with the right person.": "email",
};

export function intakeFieldForMessage(message: string): IntakeField | undefined {
  return MESSAGE_FIELD[message];
}
