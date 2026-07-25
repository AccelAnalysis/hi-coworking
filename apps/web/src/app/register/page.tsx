"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  updateProfile,
  type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { Building2, Loader2 } from "lucide-react";
import { auth, functions } from "@/lib/firebase";
import { serializeCallableError } from "@/lib/callableDiagnostics";

const initializeAccount = httpsCallable<
  {
    displayName: string;
    preferredPrivateEmail: string;
    communicationPreferences: { inApp: boolean; email: boolean; sms: boolean };
    businessRepresentativeAttestation: true;
    termsAccepted: true;
    privacyAccepted: true;
    idempotencyKey: string;
    registrationVersion: 2;
  },
  { accountInitialized: boolean }
>(functions, "account_initialize");

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    router.prefetch("/exchange/onboarding");
  }, [router]);

  const displayName = `${firstName.trim()} ${lastName.trim()}`.trim().replace(/\s+/g, " ");

  const finishAccountInitialization = async (currentUser: User) => {
    idempotencyKey.current ??= `register-${crypto.randomUUID()}`;
    if (currentUser.displayName !== displayName) {
      await updateProfile(currentUser, { displayName });
    }

    const payload = {
      displayName,
      preferredPrivateEmail: (currentUser.email || email).trim().toLowerCase(),
      communicationPreferences: { inApp: true, email: true, sms: false },
      businessRepresentativeAttestation: true as const,
      termsAccepted: true as const,
      privacyAccepted: true as const,
      idempotencyKey: idempotencyKey.current,
      registrationVersion: 2 as const,
    };

    let result;
    try {
      result = await initializeAccount(payload);
    } catch (firstError) {
      await currentUser.getIdToken(true);
      try {
        result = await initializeAccount(payload);
      } catch (retryError) {
        console.warn("Account initialization failed after retry", serializeCallableError(retryError, {
          functionName: "account_initialize",
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          region: "us-central1",
        }));
        throw retryError ?? firstError;
      }
    }

    if (!result.data.accountInitialized) {
      throw new Error("Account initialization was not confirmed");
    }
    await currentUser.getIdToken(true);
    router.replace("/exchange/onboarding");
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    let createdUser: User | null = null;

    try {
      if (!accepted) {
        setError("Review and accept the Terms of Use and Privacy Policy to create your account.");
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      createdUser = credential.user;
      await finishAccountInitialization(credential.user);
    } catch (value: unknown) {
      const firebaseError = value as { code?: string };
      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (rollbackError) {
          console.warn("Could not roll back incomplete registration", rollbackError);
        }
      }

      if (firebaseError.code === "auth/email-already-in-use") {
        setError("This email is already registered. Sign in to continue.");
      } else if (firebaseError.code === "auth/weak-password") {
        setError("Choose a password with at least six characters.");
      } else if (firebaseError.code === "auth/invalid-email") {
        setError("Enter a valid email address.");
      } else {
        console.warn("Registration did not complete", serializeCallableError(value, {
          functionName: "account_initialize",
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          region: "us-central1",
        }));
        setError("Registration could not be completed. No partial account was kept. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F7F3EA] px-4 py-10">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl shadow-black/10">
        <div className="border-b border-black/10 bg-[#0B0B0D] px-7 py-6 text-white sm:px-9">
          <Link href="/" className="inline-flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#D6A23A] font-black text-black">RF</span><span className="text-xl font-black tracking-tight">The RFxchange</span></Link>
        </div>
        <div className="px-7 py-8 sm:px-9">
          <div className="mb-7">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-amber-800"><Building2 className="h-3.5 w-3.5" /> Business registration</span>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Create your account.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Registration is for businesses and organizations. After sign-in, we will place your business on the Exchange map.</p>
          </div>
          <form onSubmit={handleRegister} className="space-y-5">
            {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">{error}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">First name<input required autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-[#D6A23A] focus:ring-2 focus:ring-amber-100" /></label>
              <label className="text-sm font-semibold text-slate-700">Last name<input required autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-[#D6A23A] focus:ring-2 focus:ring-amber-100" /></label>
            </div>
            <label className="block text-sm font-semibold text-slate-700">Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-[#D6A23A] focus:ring-2 focus:ring-amber-100" placeholder="you@business.com" /></label>
            <label className="block text-sm font-semibold text-slate-700">Password<input required minLength={6} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-[#D6A23A] focus:ring-2 focus:ring-amber-100" /></label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"><input required type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#D6A23A]" /><span>I am registering a business or organization and acknowledge the <Link href="/terms" className="font-semibold underline">Terms of Use</Link> and <Link href="/privacy" className="font-semibold underline">Privacy Policy</Link>.</span></label>
            <button type="submit" disabled={loading || !accepted || !displayName} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0B0B0D] px-5 py-3.5 font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{loading ? "Creating account…" : "Create account"}</button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-600">Already registered? <Link href="/login" className="font-bold text-slate-950 underline">Sign in</Link></p>
        </div>
      </div>
    </main>
  );
}
