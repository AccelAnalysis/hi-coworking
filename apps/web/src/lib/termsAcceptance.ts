import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export {
  HI_TERMS_TEXT,
  HI_TERMS_VERSION,
  PRIVACY_PATH,
  TERMS_PATH,
} from "../../../functions/src/providers/termsCompliance";

export type AcceptTermsInput = {
  accepted: true;
  version: string;
  source: "member-signup";
};

export type AcceptTermsResult = { version: string; acceptedAt: number };

export const acceptTerms = httpsCallable<AcceptTermsInput, AcceptTermsResult>(functions, "members_acceptTerms");

/** Retries briefly so a cold start or a flaky network does not lose the record. */
export async function recordTermsAcceptance(
  version: string,
  call: (input: AcceptTermsInput) => Promise<unknown> = acceptTerms,
  attempts = 3,
  delayMs = 800,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await call({ accepted: true, version, source: "member-signup" });
      return true;
    } catch (error) {
      if (attempt === attempts) {
        console.error(error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  return false;
}
