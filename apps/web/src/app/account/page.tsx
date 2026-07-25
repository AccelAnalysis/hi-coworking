"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { auth, functions } from "@/lib/firebase";

const deleteAccount = httpsCallable<
  { operation: "delete_account"; confirmation: "DELETE"; reason?: string },
  { success: true; firestoreRecordsDeleted: number; storageObjectsDeleted: number }
>(functions, "account_initialize");

function friendlyDeletionError(value: unknown): string {
  const error = value as { code?: string; message?: string; details?: { diagnosticCode?: string; organizations?: Array<{ name?: string }> } };
  const diagnostic = error.details?.diagnosticCode;
  if (diagnostic === "SOLE_ORGANIZATION_OWNER") {
    const names = error.details?.organizations?.map((organization) => organization.name).filter(Boolean).join(", ");
    return names
      ? `Transfer ownership of ${names} before deleting this account.`
      : "Transfer ownership of each organization before deleting this account.";
  }
  if (diagnostic === "PROTECTED_ADMIN_ACCOUNT") return "Administrator accounts must be removed by another authorized administrator.";
  if (diagnostic === "RECENT_AUTH_REQUIRED") return "Your session is no longer recent. Sign out, sign in again, and retry account deletion.";
  if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") return "The password is incorrect.";
  if (error.code === "auth/too-many-requests") return "Too many attempts were made. Try again later.";
  return error.message?.replace(/^FirebaseError:\s*/i, "") || "The account could not be deleted. Nothing was changed.";
}

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountContent />
    </RequireAuth>
  );
}

function AccountContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const canDelete = Boolean(user?.email && password && confirmation === "DELETE" && !deleting);

  const handleDelete = async () => {
    if (!user?.email || confirmation !== "DELETE") return;
    setDeleting(true);
    setError("");
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      await user.getIdToken(true);
      await deleteAccount({
        operation: "delete_account",
        confirmation: "DELETE",
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      await signOut(auth).catch(() => undefined);
      router.replace("/?accountDeleted=1");
      router.refresh();
    } catch (value) {
      setError(friendlyDeletionError(value));
      setDeleting(false);
    }
  };

  return (
    <AppShell>
      <main className="min-h-dvh bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-3xl space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-950">Account and privacy</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">Manage the personal account signed in as <strong>{user?.email}</strong>.</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-700">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-black text-slate-950">Delete account</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">This permanently deletes your sign-in, private profile, public profile, organization memberships, saved items, recent searches and views, notifications, onboarding state, verification files, and other personal account records.</p>

                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-bold">Shared and regulated records are handled differently.</p>
                      <p className="mt-1">Organizations are not deleted with a personal account. Transfer organization ownership first. Completed payments, referrals, bookings, access events, dispute evidence, and required audit records may be retained in restricted form for other parties, fraud prevention, accounting, tax, security, or legal obligations.</p>
                    </div>
                  </div>
                </div>

                {error && <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}

                <div className="mt-6 space-y-4">
                  <label className="block text-sm font-bold text-slate-800">
                    Current password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                    />
                  </label>

                  <label className="block text-sm font-bold text-slate-800">
                    Optional reason
                    <textarea
                      value={reason}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      placeholder="Tell us what did not work"
                    />
                  </label>

                  <label className="block text-sm font-bold text-slate-800">
                    Type DELETE to confirm
                    <input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal text-slate-950 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      spellCheck={false}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={!canDelete}
                    onClick={() => void handleDelete()}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-red-700 px-6 py-3 font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {deleting ? "Deleting account…" : "Permanently delete account"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
