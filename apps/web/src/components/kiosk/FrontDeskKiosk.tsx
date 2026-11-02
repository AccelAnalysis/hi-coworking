"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/authContext";
import {
  KIOSK_STAFF_MESSAGE,
  MEMBER_SCREEN_RESET_SECONDS,
  RESULT_SCREEN_RESET_SECONDS,
  formatClock,
  formatMinutes,
  formatWindow,
  isOfflineError,
  kioskCheckIn,
  kioskCheckOut,
  kioskLookupMember,
  kioskSession,
  newRequestId,
  type CheckInResult,
  type CheckOutResult,
  type KioskLookup,
  type KioskSettings,
} from "@/lib/frontDeskKiosk";
import { useKioskScreen } from "@/lib/kioskScreen";
import { HiLogo } from "./HiLogo";
import styles from "./FrontDeskKiosk.module.css";

/*
 * Front-desk iPad kiosk: check-in and check-out only.
 *
 * Brand: Hi Navy #101D4B and white, supporting #EEF0F6 / #C5CADB / #4A5585 /
 * #3A4675. Every text pair used here is WCAG AA or better (see
 * docs/front-desk-kiosk-setup.md). Fraunces SemiBold headlines, DM Sans UI.
 * Touch targets are at least 88px tall.
 */

type Mode = "check_in" | "check_out";
type Screen =
  | { name: "start" }
  | { name: "lookup"; mode: Mode }
  | { name: "confirm"; mode: Mode; lookup: KioskLookup; requestId: string }
  | { name: "checked_in"; result: Extract<CheckInResult, { status: "checked_in" }> }
  | { name: "already_in"; firstName: string; checkInAt: number }
  | { name: "checked_out"; result: Extract<CheckOutResult, { status: "checked_out" }> }
  | { name: "not_in"; firstName: string };

type Session =
  | { state: "loading" }
  | { state: "ready"; deviceLabel: string; settings: KioskSettings }
  | { state: "refused"; message: string }
  | { state: "offline" };

const DEFAULT_SETTINGS: KioskSettings = { idleLogoMinutes: 15, logoSeconds: 6 };
const SESSION_REFRESH_MS = 30 * 60 * 1000;

const NAVY = "#101D4B";

const primaryButton =
  "flex min-h-[88px] w-full items-center justify-center rounded-[28px] bg-[#101D4B] px-8 text-[26px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(16,29,75,0.55)] transition-colors hover:bg-[#3A4675] active:bg-[#3A4675] disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#101D4B]";
const secondaryButton =
  "flex min-h-[88px] w-full items-center justify-center rounded-[28px] border-2 border-[#4A5585] bg-white px-8 text-[24px] font-semibold text-[#101D4B] transition-colors hover:bg-[#EEF0F6] active:bg-[#EEF0F6] disabled:opacity-60 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#101D4B]";
const headline = "font-display text-[44px] font-semibold leading-[1.1] tracking-[-0.01em] text-[#101D4B] sm:text-[52px]";
const resultHeadline = "font-display text-[40px] font-semibold leading-[1.1] tracking-[-0.01em] text-[#101D4B] sm:text-[44px]";
const body = "text-[22px] leading-[1.45] text-[#3A4675]";

function serverMessage(caught: unknown): string {
  const code = String((caught as { code?: unknown } | null)?.code || "");
  const message = String((caught as { message?: unknown } | null)?.message || "").trim();
  if (["functions/not-found", "functions/resource-exhausted", "functions/invalid-argument", "functions/failed-precondition"].includes(code) && message) {
    return message;
  }
  return `Something went wrong. ${KIOSK_STAFF_MESSAGE}`;
}


/** How long the kiosk waits for its session before treating the network as down. */
const SESSION_TIMEOUT_MS = 15_000;
/** When to offer "Try again" on the start-up screen. */
const SLOW_START_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(Object.assign(new Error("internal"), { code: "functions/unavailable" })), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function FrontDeskKiosk() {
  const { user, loading, signIn, signOut } = useAuth();
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [screen, setScreenState] = useState<Screen>({ name: "start" });
  const [idleLogo, setIdleLogo] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [slowStart, setSlowStart] = useState(false);

  const lastActivity = useRef(0);
  const logoShownAt = useRef(0);
  const screenRef = useRef<Screen>(screen);
  const idleRef = useRef(false);
  const settingsRef = useRef<KioskSettings>(DEFAULT_SETTINGS);
  /** Bumped on every reset so late responses from an abandoned flow are ignored. */
  const flowRef = useRef(0);

  useKioskScreen(Boolean(user));

  const setScreen = useCallback((next: Screen) => {
    screenRef.current = next;
    lastActivity.current = Date.now();
    setError(null);
    setScreenState(next);
  }, []);

  const goStart = useCallback(() => {
    flowRef.current += 1;
    setQuery("");
    setBusy(false);
    setScreen({ name: "start" });
  }, [setScreen]);

  // ------------------------------------------------------------- session
  const loadSession = useCallback(async () => {
    try {
      const result = await withTimeout(kioskSession({}), SESSION_TIMEOUT_MS);
      settingsRef.current = result.data.settings;
      setOffline(false);
      setSession({ state: "ready", deviceLabel: result.data.deviceLabel, settings: result.data.settings });
    } catch (caught) {
      if (isOfflineError(caught)) {
        setSession((current) => (current.state === "ready" ? current : { state: "offline" }));
        setOffline(true);
        return;
      }
      const message = String((caught as { message?: unknown } | null)?.message || "").trim();
      setSession({ state: "refused", message: message && message !== "internal" ? message : "This account can't run the front desk." });
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    void loadSession();
    const timer = window.setInterval(() => void loadSession(), SESSION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loading, user, loadSession]);

  // A start-up that takes this long is stuck; offer a reload instead of a frozen screen.
  useEffect(() => {
    if (!(loading || (user && session.state === "loading"))) {
      setSlowStart(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowStart(true), SLOW_START_MS);
    return () => window.clearTimeout(timer);
  }, [loading, user, session.state]);

  // ------------------------------------------------------------- offline
  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      goStart();
      void loadSession();
    };
    if (navigator.onLine === false) setOffline(true);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [goStart, loadSession]);

  // ---------------------------------------------------------------- idle
  useEffect(() => {
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointerdown", touch, true);
    window.addEventListener("keydown", touch, true);
    const tick = window.setInterval(() => {
      const now = Date.now();
      const current = screenRef.current;
      const idleFor = now - lastActivity.current;
      if (current.name !== "start") {
        const limit = current.name === "lookup" || current.name === "confirm" ? MEMBER_SCREEN_RESET_SECONDS : RESULT_SCREEN_RESET_SECONDS;
        if (idleFor >= limit * 1000) goStart();
        return;
      }
      const { idleLogoMinutes, logoSeconds } = settingsRef.current;
      if (!idleRef.current && idleFor >= idleLogoMinutes * 60 * 1000) {
        idleRef.current = true;
        logoShownAt.current = now;
        setIdleLogo(true);
      } else if (idleRef.current && now - logoShownAt.current >= logoSeconds * 1000) {
        idleRef.current = false;
        lastActivity.current = now;
        setIdleLogo(false);
      }
    }, 1000);
    return () => {
      window.removeEventListener("pointerdown", touch, true);
      window.removeEventListener("keydown", touch, true);
      window.clearInterval(tick);
    };
  }, [goStart]);

  const dismissIdle = useCallback(() => {
    idleRef.current = false;
    setIdleLogo(false);
    goStart();
  }, [goStart]);

  // ------------------------------------------------------------- actions
  const handleFailure = useCallback((caught: unknown) => {
    if (isOfflineError(caught)) {
      setOffline(true);
      return;
    }
    setError(serverMessage(caught));
  }, []);

  const submitLookup = useCallback(
    async (mode: Mode) => {
      const value = query.trim();
      if (!value) {
        setError("Enter your email or today's access code.");
        return;
      }
      const flow = flowRef.current;
      setBusy(true);
      setError(null);
      try {
        const result = await kioskLookupMember({ query: value });
        if (flowRef.current !== flow) return;
        setQuery("");
        setScreen({ name: "confirm", mode, lookup: result.data, requestId: newRequestId() });
      } catch (caught) {
        if (flowRef.current === flow) handleFailure(caught);
      } finally {
        if (flowRef.current === flow) setBusy(false);
      }
    },
    [query, setScreen, handleFailure],
  );

  const confirm = useCallback(
    async (mode: Mode, lookup: KioskLookup, requestId: string) => {
      const flow = flowRef.current;
      setBusy(true);
      setError(null);
      try {
        if (mode === "check_in") {
          const { data } = await kioskCheckIn({ lookupId: lookup.lookupId, requestId });
          if (flowRef.current !== flow) return;
          if (data.status === "checked_in") setScreen({ name: "checked_in", result: data });
          else setScreen({ name: "already_in", firstName: data.firstName, checkInAt: data.checkInAt });
        } else {
          const { data } = await kioskCheckOut({ lookupId: lookup.lookupId, requestId });
          if (flowRef.current !== flow) return;
          if (data.status === "checked_out") setScreen({ name: "checked_out", result: data });
          else setScreen({ name: "not_in", firstName: data.firstName });
        }
      } catch (caught) {
        if (flowRef.current === flow) handleFailure(caught);
      } finally {
        if (flowRef.current === flow) setBusy(false);
      }
    },
    [setScreen, handleFailure],
  );

  // --------------------------------------------------------------- views
  if (loading || (user && session.state === "loading")) {
    return (
      <Frame>
        <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-8 text-center">
          <p className={body} role="status">Getting the front desk ready…</p>
          {slowStart && (
            <button type="button" className={secondaryButton} onClick={() => window.location.reload()}>
              Try again
            </button>
          )}
        </div>
      </Frame>
    );
  }

  if (!user) return <KioskSignIn signIn={signIn} />;

  if (offline || session.state === "offline") {
    return (
      <Frame>
        <StaffScreen
          title={KIOSK_STAFF_MESSAGE}
          detail="The front desk can't reach the internet right now. Nothing was saved from this screen."
          onRetry={() => {
            setOffline(false);
            goStart();
            void loadSession();
          }}
        />
      </Frame>
    );
  }

  if (session.state === "refused") {
    return (
      <Frame>
        <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-8 text-center">
          <h1 className={headline}>This iPad isn&apos;t set up as the front desk</h1>
          <p className={body}>{session.message}</p>
          <button type="button" className={secondaryButton} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <>
      <Frame footer={<span>{session.state === "ready" ? session.deviceLabel : "Front desk"}</span>}>
        <div key={screenKey(screen)} className={`${styles.screen} mx-auto flex w-full max-w-[720px] flex-col items-center text-center`}>
          {screen.name === "start" && (
            <div className="flex w-full flex-col items-center gap-10">
              <HiLogo variant="navy" width={168} />
              <div className="space-y-4">
                <h1 className={headline}>Welcome to Hi Coworking</h1>
                <p className={body}>Check in when you arrive and check out when you leave.</p>
              </div>
              <div className="grid w-full gap-5 sm:grid-cols-2">
                <button type="button" className={primaryButton} onClick={() => setScreen({ name: "lookup", mode: "check_in" })}>
                  Check in
                </button>
                <button type="button" className={secondaryButton} onClick={() => setScreen({ name: "lookup", mode: "check_out" })}>
                  Check out
                </button>
              </div>
            </div>
          )}

          {screen.name === "lookup" && (
            <form
              className="flex w-full flex-col gap-8 text-left"
              onSubmit={(event) => {
                event.preventDefault();
                void submitLookup(screen.mode);
              }}
              noValidate
            >
              <h1 className={`${headline} text-center`}>{screen.mode === "check_in" ? "Check in" : "Check out"}</h1>
              <div className="space-y-3">
                <label htmlFor="kiosk-lookup" className="block text-[24px] font-semibold text-[#101D4B]">
                  Email or access code
                </label>
                <input
                  id="kiosk-lookup"
                  name="kiosk-lookup"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="text"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  aria-describedby="kiosk-lookup-hint kiosk-error"
                  aria-invalid={error ? true : undefined}
                  autoFocus
                  className="min-h-[88px] w-full rounded-[24px] border-2 border-[#4A5585] bg-white px-6 text-[28px] text-[#101D4B] placeholder:text-[#4A5585] focus:border-[#101D4B] focus:outline focus:outline-4 focus:outline-offset-2 focus:outline-[#101D4B]"
                  placeholder="Email or access code"
                />
                <p id="kiosk-lookup-hint" className="text-[20px] text-[#3A4675]">
                  Use the same access code as the door. It&apos;s on your SayHi page.
                </p>
              </div>
              <ErrorText error={error} />
              <div className="grid gap-5 sm:grid-cols-[1fr_2fr]">
                <button type="button" className={secondaryButton} onClick={goStart} disabled={busy}>
                  Back
                </button>
                <button type="submit" className={primaryButton} disabled={busy}>
                  {busy ? "One moment…" : "Continue"}
                </button>
              </div>
            </form>
          )}

          {screen.name === "confirm" && (
            <ConfirmView
              screen={screen}
              busy={busy}
              error={error}
              onConfirm={(mode) => void confirm(mode, screen.lookup, screen.requestId)}
              onSwitch={(mode) => setScreen({ ...screen, mode, requestId: newRequestId() })}
              onCancel={goStart}
            />
          )}

          {screen.name === "checked_in" && (
            <ResultView title={`Welcome, ${screen.result.firstName}.`} onDone={goStart}>
              <p className={body}>You&apos;re checked in at {formatClock(screen.result.checkInAt)}.</p>
              <dl className="grid w-full gap-4 text-left sm:grid-cols-2">
                {screen.result.bookedWindow && <Fact label="Booked today" value={formatWindow(screen.result.bookedWindow) || ""} />}
                {screen.result.remainingMonthlyMinutes != null && screen.result.remainingMonthlyMinutes > 0 && (
                  <Fact label="Included hours left this month" value={formatMinutes(screen.result.remainingMonthlyMinutes)} />
                )}
              </dl>
              <p className={body}>Remember to check out when you leave.</p>
            </ResultView>
          )}

          {screen.name === "already_in" && (
            <ResultView title={`You're already checked in, ${screen.firstName}.`} onDone={goStart}>
              <p className={body}>You checked in at {formatClock(screen.checkInAt)}. Nothing else to do.</p>
            </ResultView>
          )}

          {screen.name === "checked_out" && (
            <ResultView title={`Thanks, ${screen.result.firstName}. See you soon.`} onDone={goStart}>
              <dl className="grid w-full gap-4 text-left sm:grid-cols-2">
                <Fact label="Checked in" value={formatClock(screen.result.checkInAt)} />
                <Fact label="Checked out" value={formatClock(screen.result.checkOutAt)} />
                <Fact label="Time today" value={formatMinutes(screen.result.actualMinutes)} />
                {screen.result.overageMinutes > 0 ? (
                  <Fact label="Extra time recorded" value={formatMinutes(screen.result.overageMinutes)} />
                ) : (
                  <Fact label="Extra time" value="None" />
                )}
              </dl>
              {screen.result.overageMinutes > 0 && (
                <p className={body}>Extra time is past your booking or included hours. The front desk will follow up.</p>
              )}
            </ResultView>
          )}

          {screen.name === "not_in" && (
            <ResultView title={`You're not checked in, ${screen.firstName}.`} onDone={goStart}>
              <p className={body}>There&apos;s no open visit to close. {KIOSK_STAFF_MESSAGE}</p>
            </ResultView>
          )}
        </div>
      </Frame>
      <IdleLogo visible={idleLogo} onTouch={dismissIdle} />
    </>
  );
}

function screenKey(screen: Screen): string {
  return screen.name === "confirm" ? `confirm-${screen.mode}` : screen.name;
}

// ------------------------------------------------------------ pieces ----

function Frame({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main
      className="relative flex min-h-dvh select-none flex-col bg-[#EEF0F6] font-sans text-[#101D4B]"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", WebkitTapHighlightColor: "transparent" }}
    >
      <div className="flex flex-1 items-center justify-center px-8 py-8">
        <div className="w-full max-w-[880px] rounded-[40px] bg-white px-8 py-10 shadow-[0_30px_80px_-40px_rgba(16,29,75,0.45)] sm:px-16">{children}</div>
      </div>
      {footer && <footer className="pb-6 text-center text-[18px] text-[#3A4675]">{footer}</footer>}
    </main>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return (
    <p id="kiosk-error" role="alert" className={error ? "rounded-[20px] border-2 border-[#101D4B] bg-[#EEF0F6] px-6 py-4 text-center text-[22px] font-semibold text-[#101D4B]" : "sr-only"}>
      {error || ""}
    </p>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] bg-[#EEF0F6] px-6 py-5">
      <dt className="text-[18px] font-semibold uppercase tracking-[0.06em] text-[#3A4675]">{label}</dt>
      <dd className="mt-1 text-[30px] font-semibold text-[#101D4B]">{value}</dd>
    </div>
  );
}

function ResultView({ title, children, onDone }: { title: string; children: React.ReactNode; onDone: () => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-6" role="status" aria-live="polite">
      <HiLogo variant="navy" width={80} decorative />
      <h1 className={resultHeadline}>{title}</h1>
      {children}
      <button type="button" className={primaryButton} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function ConfirmView({
  screen,
  busy,
  error,
  onConfirm,
  onSwitch,
  onCancel,
}: {
  screen: Extract<Screen, { name: "confirm" }>;
  busy: boolean;
  error: string | null;
  onConfirm: (mode: Mode) => void;
  onSwitch: (mode: Mode) => void;
  onCancel: () => void;
}) {
  const { lookup, mode } = screen;
  const mismatch = mode === "check_in" ? lookup.checkedIn : !lookup.checkedIn;
  const otherMode: Mode = mode === "check_in" ? "check_out" : "check_in";
  return (
    <div className="flex w-full flex-col items-center gap-8">
      <p className="text-[22px] font-semibold uppercase tracking-[0.08em] text-[#3A4675]">Is this you?</p>
      <h1 className="font-display text-[64px] font-semibold leading-none text-[#101D4B]">{lookup.memberLabel}</h1>
      {mismatch && (
        <p className={body}>
          {mode === "check_in"
            ? `You're already checked in${lookup.checkedInAt ? ` since ${formatClock(lookup.checkedInAt)}` : ""}.`
            : "You're not checked in right now."}
        </p>
      )}
      <ErrorText error={error} />
      <div className="grid w-full gap-5 sm:grid-cols-[1fr_2fr]">
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>
          Not me
        </button>
        {mismatch ? (
          <button type="button" className={primaryButton} onClick={() => onSwitch(otherMode)} disabled={busy}>
            {otherMode === "check_out" ? "Check out instead" : "Check in instead"}
          </button>
        ) : (
          <button type="button" className={primaryButton} onClick={() => onConfirm(mode)} disabled={busy} aria-busy={busy}>
            {busy ? "One moment…" : mode === "check_in" ? "Yes, check me in" : "Yes, check me out"}
          </button>
        )}
      </div>
    </div>
  );
}

function StaffScreen({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-8 text-center" role="alert">
      <HiLogo variant="navy" width={140} decorative />
      <h1 className={headline}>{title}</h1>
      <p className={body}>{detail}</p>
      <button type="button" className={secondaryButton} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function IdleLogo({ visible, onTouch }: { visible: boolean; onTouch: () => void }) {
  return (
    <button
      type="button"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={onTouch}
      className={`${styles.idle} ${visible ? styles.idleVisible : ""} ${styles.glow} fixed inset-0 z-50 flex w-full flex-col items-center justify-center gap-12 px-10 text-center text-white focus-visible:outline-none`}
      style={{ backgroundColor: NAVY }}
    >
      <span className={`${styles.idleMark} block`}>
        <HiLogo variant="inverse" width={240} decorative />
      </span>
      <span className="font-display text-[48px] font-semibold leading-tight sm:text-[60px]">Welcome. Make yourself at home.</span>
      <span className="mt-4 inline-flex min-h-[88px] items-center rounded-full border-2 border-white/80 px-12 text-[28px] font-semibold text-white">
        Touch to check in or check out
      </span>
    </button>
  );
}

// ----------------------------------------------------------- sign-in ----

function KioskSignIn({ signIn }: { signIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputClass =
    "min-h-[72px] w-full rounded-[20px] border-2 border-[#4A5585] bg-white px-5 text-[22px] text-[#101D4B] focus:border-[#101D4B] focus:outline focus:outline-4 focus:outline-offset-2 focus:outline-[#101D4B]";
  return (
    <Frame>
      <form
        className="mx-auto flex w-full max-w-[560px] flex-col gap-6"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signIn(email.trim(), password);
          } catch {
            setError("That sign-in didn't work. Check the kiosk account details.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex flex-col items-center gap-6 text-center">
          <HiLogo variant="navy" width={120} />
          <h1 className={headline}>Set up the front desk</h1>
          <p className={body}>Staff only: sign in with the front-desk kiosk account. Staff and admin accounts can&apos;t run the kiosk.</p>
        </div>
        <label className="block space-y-2 text-[20px] font-semibold text-[#101D4B]">
          <span>Kiosk account email</span>
          <input className={inputClass} type="email" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block space-y-2 text-[20px] font-semibold text-[#101D4B]">
          <span>Password</span>
          <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <ErrorText error={error} />
        <button type="submit" className={primaryButton} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Frame>
  );
}
