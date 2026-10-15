"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isSignInWithEmailLink, signInWithEmailLink, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";

const EMAIL_KEY = "powerNowSignInEmail";

export function PowerNowFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <a className="pn-skip" href="#power-now-main">Skip to the form</a>
      <header className="pn-header">
        <div className="pn-wrap">
          <div className="pn-lockup-wrap">
            <img
              className="pn-lockup"
              src="/power-now/power-now-logo-lockup.jpg"
              width={1209}
              height={430}
              alt="POWER NOW logo"
            />
          </div>
          <p className="pn-presented">Power NOW Pitch Competition presented by Accel Analysis</p>
        </div>
      </header>
      <main id="power-now-main">
        <div className="pn-section">
          <div className="pn-wrap">
            <div className="pn-panel pn-panel-open">
              <h1>{title}</h1>
              <p className="pn-lede">{lede}</p>
              {children}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export function AdminLinks() {
  return (
    <ul className="pn-nav">
      <li><Link href="/power-now/fit">Fit conversation</Link></li>
      <li><Link href="/power-now/judges">Judges and pitchers</Link></li>
      <li><Link href="/power-now/results">Live results</Link></li>
    </ul>
  );
}

export function PlaceholderBanner({ notice }: { notice?: string }) {
  return (
    <p className="pn-banner" role="status">
      <strong>Placeholder. </strong>
      {notice || "Jonathan approves the real wording later."}
    </p>
  );
}

export function callableMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    const message = (error as { message: string }).message.replace(/^Firebase:\s*/i, "").trim();
    if (message) return message;
  }
  return fallback;
}

export function useAdminGate() {
  const { user, loading, role } = useAuth();
  const isAdmin = role === "admin" || role === "master";
  return { user, loading, isAdmin };
}

export function AdminRequired({ loading, signedIn }: { loading: boolean; signedIn: boolean }) {
  if (loading) return <p className="pn-note">Loading.</p>;
  return (
    <>
      <p className="pn-alert" role="alert">Admin access is required.</p>
      {signedIn ? (
        <p className="pn-note">This account is not an admin for Accel Analysis.</p>
      ) : (
        <p><Link className="pn-btn pn-btn-primary" href="/login">Admin sign-in</Link></p>
      )}
    </>
  );
}

export function EmailLinkSignIn({
  path,
  intro,
}: {
  path: "/power-now/score" | "/power-now/rubric";
  intro: string;
}) {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || user || typeof window === "undefined") return;
    const href = window.location.href;
    if (!isSignInWithEmailLink(auth, href)) return;
    let stored = "";
    try {
      stored = window.localStorage.getItem(EMAIL_KEY) || "";
    } catch {
      stored = "";
    }
    if (!stored) {
      setNeedsConfirm(true);
      return;
    }
    setBusy(true);
    signInWithEmailLink(auth, stored, href)
      .then(() => {
        try {
          window.localStorage.removeItem(EMAIL_KEY);
        } catch {
          /* the session is already stored */
        }
        window.history.replaceState({}, "", path);
      })
      .catch((caught) => {
        setError(callableMessage(caught, "That sign-in link could not be used. Request a new one."));
      })
      .finally(() => setBusy(false));
  }, [loading, path, user]);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const send = httpsCallable(functions, "powerNow_sendSignInLink");
      await send({ email: email.trim(), origin: window.location.origin, path });
      try {
        window.localStorage.setItem(EMAIL_KEY, email.trim());
      } catch {
        setError("This browser blocked local storage, so the link cannot be finished on this device.");
        return;
      }
      setStatus("If this email is on the list, a sign-in link is on its way. Open it on this device.");
    } catch (caught) {
      setError(callableMessage(caught, "The sign-in email could not be sent. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailLink(auth, confirmEmail.trim(), window.location.href);
      window.history.replaceState({}, "", path);
    } catch (caught) {
      setError(callableMessage(caught, "That sign-in link could not be used. Request a new one."));
    } finally {
      setBusy(false);
    }
  }

  if (loading || busy) return <p className="pn-note">Loading.</p>;
  if (user) return null;

  return (
    <form onSubmit={needsConfirm ? finish : sendLink} noValidate>
      <p className="pn-note">{intro}</p>
      <div className="pn-field">
        <label htmlFor="power-now-email">{needsConfirm ? "Confirm your email" : "Email"}</label>
        <input
          id="power-now-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={needsConfirm ? confirmEmail : email}
          onChange={(event) => (needsConfirm ? setConfirmEmail(event.target.value) : setEmail(event.target.value))}
        />
      </div>
      {error ? <p className="pn-alert" role="alert">{error}</p> : null}
      {status ? <p className="pn-status" role="status">{status}</p> : null}
      <div className="pn-actions">
        <button className="pn-btn pn-btn-primary" type="submit" disabled={busy}>
          {needsConfirm ? "Finish signing in" : "Email me a sign-in link"}
        </button>
      </div>
    </form>
  );
}

export function SignOutButton() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="pn-actions">
      <button className="pn-btn pn-btn-outline" type="button" onClick={() => void signOut(auth)}>
        Sign out
      </button>
    </div>
  );
}
