"use client";

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

const FIELD =
  "w-full min-h-11 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#101D4B] focus:border-transparent text-slate-900 placeholder:text-slate-500 transition-all";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
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
          await saveAccountDetails({ company, phone });
        } catch (detailsError) {
          // The account exists; company and phone can be added later.
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
      } else {
        setError("Failed to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-slate-50 p-4">
      {SAYHI_FLOW ? (
        <Link href="/" className="mb-8 flex min-h-11 items-center" aria-label="Hi Coworking home">
          <HiLogo size={40} />
        </Link>
      ) : (
        <Link href="/" className="font-logo flex items-center gap-2 mb-8">
          <div className="w-10 h-10 bg-slate-900 rounded-2xl rounded-bl-none flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-slate-900/20">Hi</div>
          <span className="font-bold text-2xl tracking-tight text-slate-900">Coworking</span>
        </Link>
      )}

      <div className="w-full max-w-md bg-white rounded-xl shadow-xl shadow-slate-200/50 ring-1 ring-slate-200 overflow-hidden">
        <div className="p-8">
          {SAYHI_FLOW ? (
            <>
              <h1 className="font-display text-2xl font-semibold text-[#101D4B] text-center mb-2">Create your account</h1>
              <p className="text-center text-slate-600 text-sm mb-8">
                Your email is your username.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 text-center mb-2">Create an account</h1>
              <p className="text-center text-slate-500 text-sm mb-8">
                Join Hi Coworking to start booking spaces instantly.
              </p>
            </>
          )}

          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="name">
                Full Name
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 placeholder:text-slate-400 transition-all"
                placeholder="Jane Doe"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 placeholder:text-slate-400 transition-all"
                placeholder="you@company.com"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 transition-all"
                placeholder="••••••••"
              />
            </div>

            {SAYHI_FLOW ? (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700" htmlFor="company">
                  Company name (optional)
                </label>
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  maxLength={120}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={FIELD}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="phone">
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
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 placeholder:text-slate-400 transition-all"
                placeholder="(555) 555-5555"
              />
              {SAYHI_FLOW ? null : (
                <p id="phone-hint" className="text-xs text-slate-500">
                  Only needed if you want event texts.
                </p>
              )}
            </div>

            {SAYHI_FLOW ? (
              <p className="text-sm leading-6 text-slate-600" data-testid="email-notice">
                By creating an account you agree to receive emails from Hi Coworking. You can unsubscribe anytime.
              </p>
            ) : null}

            <SmsConsentCheckbox checked={smsConsent} onChange={setSmsConsent} />

            <div className="flex items-start gap-3 text-sm leading-6 text-slate-600">
              <input
                id="terms-acceptance"
                type="checkbox"
                required
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <label htmlFor="terms-acceptance">
                I agree to the{" "}
                <Link href={TERMS_PATH} target="_blank" className="font-semibold text-sky-800 underline underline-offset-2">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href={PRIVACY_PATH} target="_blank" className="font-semibold text-sky-800 underline underline-offset-2">
                  Privacy Policy
                </Link>
                . <span className="text-slate-500">(Required)</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !termsAccepted}
              className={SAYHI_FLOW
                ? "w-full min-h-11 flex items-center justify-center rounded-full bg-[#101D4B] text-white font-semibold hover:bg-[#3A4675] focus:outline-none focus:ring-2 focus:ring-[#101D4B] focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
                : "w-full h-10 flex items-center justify-center rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed transition-colors shadow-lg shadow-slate-900/20"}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
            </button>
          </form>
        </div>
        <div className="bg-slate-50 p-4 border-t border-slate-100 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-600 font-semibold hover:text-indigo-700">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
