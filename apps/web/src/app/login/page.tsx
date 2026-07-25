"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { Loader2 } from "lucide-react";

const getActivationState = httpsCallable<Record<string, never>, {
  currentStep: string;
  safeResumeRoute: string;
  guidedActivationRequired: boolean;
}>(
  functions,
  "exchange_getBusinessActivationState",
);
const repairAccount = httpsCallable<
  { idempotencyKey: string; registrationVersion: 1 },
  { accountInitialized: boolean }
>(functions, "account_initialize");

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const repairKey = useRef<string | null>(null);

  useEffect(() => {
    router.prefetch("/exchange");
    router.prefetch("/exchange/onboarding");
  }, [router]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      try {
        let state = await getActivationState({});
        if (state.data.currentStep === "account") {
          repairKey.current ??= `signin-repair-${crypto.randomUUID()}`;
          await repairAccount({ idempotencyKey: repairKey.current, registrationVersion: 1 });
          await auth.currentUser?.getIdToken(true);
          state = await getActivationState({});
        }
        if (!state.data.guidedActivationRequired) {
          router.replace("/exchange");
          return;
        }
        router.replace(state.data.safeResumeRoute || (state.data.currentStep === "completed" ? "/exchange" : "/exchange/onboarding"));
      } catch (routingError) {
        console.warn("Post-sign-in routing check failed", routingError);
        // New v2 accounts can resume safely from authoritative onboarding. Legacy
        // accounts are still accepted by the Exchange activation gate if needed.
        router.replace("/exchange/onboarding");
      }
    } catch (value: unknown) {
      console.error(value);
      const firebaseError = value as { code?: string };
      setError(firebaseError.code === "auth/invalid-credential"
        ? "The email or password is incorrect."
        : "Sign-in could not be completed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 p-4">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl rounded-bl-none bg-slate-900 text-sm font-bold text-white shadow-lg shadow-slate-900/20">Hi</div>
        <span className="text-2xl font-bold tracking-tight text-slate-900">Coworking</span>
      </Link>

      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl shadow-slate-200/50 ring-1 ring-slate-200">
        <div className="p-8">
          <h1 className="mb-2 text-center text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mb-8 text-center text-sm text-slate-500">Sign in to enter The RFxchange.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            {error && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div>}

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700" htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-900" placeholder="you@company.com" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700" htmlFor="password">Password</label>
                <button
                  type="button"
                  disabled={resetSending}
                  onClick={async () => {
                    if (!email.trim()) {
                      setError("Enter your email first, then click Forgot password.");
                      return;
                    }
                    setResetSending(true);
                    setError("");
                    try {
                      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
                      setResetSent(true);
                    } catch {
                      setError("Failed to send reset email. Please check the address.");
                    } finally {
                      setResetSending(false);
                    }
                  }}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                >
                  {resetSending ? "Sending..." : resetSent ? "Reset email sent!" : "Forgot password?"}
                </button>
              </div>
              <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-900" />
            </div>

            <button type="submit" disabled={loading} className="flex h-10 w-full items-center justify-center rounded-full bg-slate-900 font-semibold text-white shadow-lg shadow-slate-900/20 transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </button>
          </form>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 p-4 text-center text-sm text-slate-600">
          Don&apos;t have an account? <Link href="/register" className="font-semibold text-indigo-600 hover:text-indigo-700">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
