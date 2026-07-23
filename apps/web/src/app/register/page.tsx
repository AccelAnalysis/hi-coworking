"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { accountInitializeFn } from "@/lib/functions";
import { serializeCallableError } from "@/lib/callableDiagnostics";
import { Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const [preferredPhone, setPreferredPhone] = useState("");
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [smsUpdates, setSmsUpdates] = useState(false);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializationPending, setInitializationPending] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const finishAccountInitialization = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("Authenticated account is unavailable");
    idempotencyKey.current ??= `register-${crypto.randomUUID()}`;
    const result = await accountInitializeFn({
      displayName: name.trim(),
      professionalTitle: professionalTitle.trim(),
      preferredPrivateEmail: email.trim().toLowerCase(),
      preferredPrivatePhone: preferredPhone.trim(),
      communicationPreferences: {
        inApp: true,
        email: emailUpdates,
        sms: smsUpdates,
      },
      businessRepresentativeAttestation: attested,
      idempotencyKey: idempotencyKey.current,
      registrationVersion: 2,
    });
    if (!result.data.accountInitialized) {
      throw new Error("Account initialization was not confirmed");
    }
    await currentUser.getIdToken(true);
    setInitializationPending(false);
    router.push("/exchange/onboarding");
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (initializationPending && auth.currentUser) {
        await finishAccountInitialization();
        return;
      }
      const normalizedName = name.trim().replace(/\s+/g, " ");
      const normalizedEmail = email.trim().toLowerCase();
      const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      await updateProfile(userCredential.user, { displayName: normalizedName });
      await finishAccountInitialization();
    } catch (err: unknown) {
      const firebaseError = err as { code?: string };
      if (firebaseError.code === "auth/email-already-in-use") {
        setError("This email is already registered.");
      } else if (firebaseError.code === "auth/weak-password") {
        setError("Password should be at least 6 characters.");
      } else if (auth.currentUser) {
        setInitializationPending(true);
        const diagnostic = serializeCallableError(err, {
          functionName: "account_initialize",
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          region: "us-central1",
        });
        console.warn("Account initialization needs retry", diagnostic);
        setError("Your sign-in was created, but account setup was not confirmed. Complete setup to continue.");
      } else {
        setError("Failed to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-slate-50 p-4">
      <Link href="/" className="flex items-center gap-2 mb-8">
        <div className="w-10 h-10 bg-slate-900 rounded-2xl rounded-bl-none flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-slate-900/20">Hi</div>
        <span className="font-bold text-2xl tracking-tight text-slate-900">Coworking</span>
      </Link>

      <div className="w-full max-w-xl bg-white rounded-xl shadow-xl shadow-slate-200/50 ring-1 ring-slate-200 overflow-hidden">
        <div className="p-8">
          <h1 className="text-2xl font-bold text-slate-900 text-center mb-2">Create your representative account</h1>
          <p className="text-center text-slate-500 text-sm mb-8">
            This individual account identifies the person authorized to act for a business or organization. Every registered Exchange user must connect to an organization before activation.
          </p>

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
              <label className="text-sm font-semibold text-slate-700" htmlFor="professional-title">
                Professional title
              </label>
              <input
                id="professional-title"
                type="text"
                required
                value={professionalTitle}
                onChange={(e) => setProfessionalTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 placeholder:text-slate-400 transition-all"
                placeholder="Owner, Operations Director, Procurement Lead"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="email">
                Login and preferred private email
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
              <p className="text-xs leading-5 text-slate-500">This remains person-level data. It is not automatically published or used as an organization contact route.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="preferred-phone">
                Preferred private telephone
              </label>
              <input
                id="preferred-phone"
                type="tel"
                required
                minLength={7}
                value={preferredPhone}
                onChange={(e) => setPreferredPhone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 placeholder:text-slate-400 transition-all"
                placeholder="+1 757 555 0142"
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

            <fieldset className="rounded-xl border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-700">Essential communication preferences</legend>
              <label className="mt-1 flex items-center gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={emailUpdates} onChange={(event) => setEmailUpdates(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Email account and organization-administration updates
              </label>
              <label className="mt-3 flex items-center gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={smsUpdates} onChange={(event) => setSmsUpdates(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                SMS account and organization-administration updates
              </label>
            </fieldset>

            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
              <input
                type="checkbox"
                required
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-amber-400"
              />
              <span>I am registering as an authorized representative of a business or organization.</span>
            </label>
            <p className="text-xs leading-5 text-slate-500">
              Creating an account does not verify the organization. Authority is established separately through organization creation, active membership, or an approved governed claim.
            </p>

            <button
              type="submit"
              disabled={loading || !attested}
              className="w-full h-10 flex items-center justify-center rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed transition-colors shadow-lg shadow-slate-900/20"
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : initializationPending ? "Complete account setup" : "Create account"}
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
