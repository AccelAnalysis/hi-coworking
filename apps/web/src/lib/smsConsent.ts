import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export {
  HI_SMS_CONSENT_TEXT,
  HI_SMS_CONSENT_VERSION,
  SMS_OPT_OUT_FOOTER,
  SMS_SUPPORT_EMAIL,
  SMS_TERMS_PATH,
  normalizeUsMobile,
} from "../../../functions/src/providers/smsCompliance";

export type MemberSmsConsentInput = {
  optIn: boolean;
  phone?: string;
  source: "member-signup" | "preferences";
  textVersion: string;
};

export type MemberSmsConsentResult = { optIn: boolean; phone: string | null; updatedAt: number };

export const setMemberSmsConsent = httpsCallable<MemberSmsConsentInput, MemberSmsConsentResult>(
  functions,
  "members_setSmsConsent",
);
