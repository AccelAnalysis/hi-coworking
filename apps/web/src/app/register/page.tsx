"use client";

import { PublicSiteGate } from "@/components/PublicSiteGate";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2 } from "lucide-react";
import { SmsConsentCheckbox } from "@/components/sms/SmsConsentCheckbox";
import { HI_SMS_CONSENT_VERSION, normalizeUsMobile, setMemberSmsConsent } from "@/lib/smsConsent";
import { HI_TERMS_VERSION, PRIVACY_PATH, TERMS_PATH, recordTermsAcceptance } from "@/lib/termsAcceptance";
import { HiLogo } from "@/components/HiLogo";
import { SAYHI_FLOW } from "@/lib/sayhiFlags";
import { readPlanChoice, saveAccountDetails, startMembershipCheckout } from "@/lib/sayhiAccount";
import { callableErrorMessage } from "@/lib/callableError";
import {
  BusinessProfileFields,
  EMPTY_BUSINESS_PROFILE,
  type BusinessProfileDraft,
} from "@/components/account/BusinessProfileFields";
import { validateBusinessProfile } from "../../../../functions/src/providers/businessProfile";
import { HIG_CANVAS, HIG_CARD, HIG_FIELD, HIG_LABEL, HIG_LINK, HIG_PRIMARY, HIG_PRIMARY_MUTED, InsetCard } from "@/components/forms/HigControls";

export default function RegisterPage() {
  return (
    <PublicSiteGate>
      <RegisterPageContent />
    </PublicSiteGate>
  );
}

function RegisterPageContent() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState<BusinessProfileDraft>(EMPTY_BUSINESS_PROFILE);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [smsConsent, setSmsConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!termsAccepted) {
      setError("Please agree to the Terms of Service and Privacy Policy to create an account.");
      return;
    }
    if (SAYHI_FLOW && !normalizeUsMobile(phone)) {
      setError("Enter a 10-digit phone number.");
      return;
    }
    // Renter screening: every new account describes its business use.
    const profile = SAYHI_FLOW ? validateBusinessProfile(business) : null;
    if (profile && !profile.ok) {
      setInvalidField(profile.field);
      setError(profile.message);
      return;
    }
    setInvalidField(null);
    const smsPhone = smsConsent ? normalizeUsMobile(phone) : null;
    if (smsConsent && !smsPhone) {
      setError("To get texts, enter a 10-digit US mobile number, or leave the text box unchecked.");
      return;
    }
    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
      // Record the clickwrap acceptance on the server (version + server time).
      await recordTermsAcceptance(HI_TERMS_VERSION);
      if (SAYHI_FLOW) {
        try {
          await saveAccountDetails({ ...business, phone });
        } catch (detailsError) {
          // The account exists; /preferences asks for the business profile
          // again until it is saved, so sign-up still finishes.
          console.error(detailsError);
        }
      }
      if (smsPhone) {
        try {
          await setMemberSmsConsent({
            optIn: true,
            phone: smsPhone,
            source: "member-signup",
            textVersion: HI_SMS_CONSENT_VERSION,
          });
        } catch (smsError) {
          // The account exists. Text messages are optional and can be turned on later.
          console.error(smsError);
          router.push("/preferences?sms=retry");
          return;
        }
      }
      const plan = SAYHI_FLOW ? readPlanChoice(window.location.search) : null;
      if (plan) {
        // Plans and pricing -> Create your account -> Checkout (steps 2-6).
        const url = await startMembershipCheckout(plan);
        if (url) {
          window.location.href = url;
          return;
        }
      }
      router.push("/my-hi");
    } catch (err: unknown) {
      console.error(err);
      const firebaseError = err as { code?: string };
      if (firebaseError.code === "auth/email-already-in-use") {
        setError("This email is already registered.");
      } else if (firebaseError.code === "auth/weak-password") {
        setError("Password should be at least 6 characters.");
      } else if (typeof firebaseError.code === "string" && firebaseError.code.startsWith("functions/")) {
        setError(callableErrorMessage(err, "Your account was created, but checkout could not be started."));
      } else {
        setError("Failed to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const formReady =
    termsAccepted &&
    name.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    password.length >= 6 &&
    (!SAYHI_FLOW || (Boolean(normalizeUsMobile(phone)) && validateBusinessProfile(business).ok));

  const accountFields = (
    <div className="grid gap-5">
      <div>
        <label className={`${HIG_LABEL} mb-1.5`} htmlFor="name">Full name</label>
        <input id="name" type="text" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={HIG_FIELD} placeholder="Jane Doe" />
      </div>
      <div>
        <label className={`${HIG_LABEL} mb-1.5`} htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={HIG_FIELD} placeholder="you@company.com" />
      </div>
      <div>
        <label className={`${HIG_LABEL} mb-1.5`} htmlFor="password">Password</label>
        <input id="password" type="password" required autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={HIG_FIELD} placeholder="At least 6 characters" />
      </div>
      <div>
        <label className={`${HIG_LABEL} mb-1.5`} htmlFor="phone">
          {SAYHI_FLOW ? "Phone number" : "Mobile number (optional)"}
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required={SAYHI_FLOW}
          aria-describedby={SAYHI_FLOW ? undefined : "phone-hint"}
          className={HIG_FIELD}
          placeholder="(555) 555-5555"
        />
        {SAYHI_FLOW ? null : (
          <p id="phone-hint" className="mt-1 text-xs text-slate-600">Only needed if you want event texts.</p>
        )}
      </div>
    </div>
  );

  const consentRows = (
    <div className={`${HIG_CARD} divide-y divide-slate-100`}>
      {SAYHI_FLOW ? (
        <p className="px-5 py-4 text-sm leading-6 text-slate-600" data-testid="email-notice">
          By creating an account you agree to receive emails from Hi Coworking. You can unsubscribe anytime.
        </p>
      ) : null}
      <div className="px-5 py-4">
        <SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} />
      </div>
      <div className="flex items-start gap-3 px-5 py-4 text-sm leading-6 text-slate-700">
        <input
          id="terms-acceptance"
          type="checkbox"
          required
          checked={termsAccepted}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-[#101D4B]"
        />
        <label htmlFor="terms-acceptance">
          I agree to the{" "}
          <Link href={TERMS_PATH} target="_blank" className={HIG_LINK}>
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href={PRIVACY_PATH} target="_blank" className={HIG_LINK}>
            Privacy Policy
          </Link>
          .
        </label>
      </div>
    </div>
  );

  const submit = (
    <button
      type="submit"
      disabled={loading || !termsAccepted}
      aria-describedby={formReady ? undefined : "create-account-hint"}
      className={`${formReady ? HIG_PRIMARY : HIG_PRIMARY_MUTED} w-full`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Creating account" /> : "Create account"}
    </button>
  );

  const signIn = (
    <p className="text-sm text-slate-600">
      Already have an account?{" "}
      <Link href="/login" className={HIG_LINK}>Sign in</Link>
    </p>
  );

  const errorBox = error ? (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
      {error}
    </div>
  ) : null;

  return (
    <div className={`min-h-dvh ${HIG_CANVAS} px-4 py-10 sm:py-14`}>
      <div className={`mx-auto w-full ${SAYHI_FLOW ? "max-w-5xl" : "max-w-md"}`}>
        <div className="flex flex-col items-center text-center">
          {SAYHI_FLOW ? (
            <Link href="/" className="mb-6 flex min-h-11 items-center" aria-label="Hi Coworking home">
              <HiLogo size={40} />
            </Link>
          ) : (
            <Link href="/" className="font-logo mb-6 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl rounded-bl-none bg-slate-900 text-sm font-bold text-white">Hi</div>
              <span className="text-2xl font-bold tracking-tight text-slate-900">Coworking</span>
            </Link>
          )}
          <h1 className="font-display text-3xl font-semibold text-[#101D4B]">
            {SAYHI_FLOW ? "Create your account" : "Create an account"}
          </h1>
          <p className="mt-2 text-[15px] text-slate-600">
            {SAYHI_FLOW ? "Your email is your username." : "Join Hi Coworking to start booking spaces instantly."}
          </p>
        </div>

        <form onSubmit={handleRegister} className="mt-8 space-y-6">
          {errorBox}

          {SAYHI_FLOW ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <InsetCard title="Account" titleId="account-heading" className="lg:col-start-1 lg:row-start-1">
                {accountFields}
              </InsetCard>
              <InsetCard
                title="Business"
                titleId="business-heading"
                description="Hi Coworking is a workspace for business use. Tell us a little about yours."
                className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
              >
                <BusinessProfileFields
                  idPrefix="register-business"
                  value={business}
                  onChange={setBusiness}
                  disabled={loading}
                  invalidField={invalidField}
                />
              </InsetCard>
              <div className="lg:col-start-1 lg:row-start-2 lg:self-end">{consentRows}</div>
            </div>
          ) : (
            <>
              <InsetCard>{accountFields}</InsetCard>
              {consentRows}
            </>
          )}

          {SAYHI_FLOW ? (
            <div className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:justify-between">
              {signIn}
              <div className="w-full sm:w-72">
                {submit}
                {formReady ? null : (
                  <p id="create-account-hint" className="mt-2 text-center text-xs text-slate-600">
                    Complete the required fields to continue.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              {submit}
              {formReady ? null : <p id="create-account-hint" className="sr-only">Complete the required fields to continue.</p>}
              {signIn}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
