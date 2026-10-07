"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { JessicaAvatar } from "@/booth/JessicaAvatar";
import { AccelWordmark } from "@/components/AccelWordmark";
import { ambientAvatarStatus, jessicaDisplayFromSearch } from "@/booth/jessicaDisplay";
import { IPAD_FORM_PATH } from "@/booth/jessicaSession";
import { useJessicaVoice, type KioskStatus } from "@/booth/useJessicaVoice";

function statusLabel(status: KioskStatus, vadFallback: boolean): string {
  switch (status) {
    case "needs-start":
      return "Tap to wake Jessica";
    case "connecting":
      return "Connecting";
    case "ready":
      return vadFallback ? "Auto-listen is on" : "Hold to talk";
    case "listening":
      return vadFallback ? "Listening" : "Listening. Release when you finish.";
    case "thinking":
      return "One moment";
    case "speaking":
      return "Jessica is speaking";
    case "stopped":
      return "A greeter can take it from here";
    case "handoff":
      return "The iPad is the next step";
    case "error":
      return "Voice is unavailable";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function requestFullscreen() {
  if (document.fullscreenElement) return;
  void document.documentElement.requestFullscreen().catch(() => {
    // A booth launch with --kiosk is already fullscreen. A normal tab needs a gesture.
  });
}

export function JessicaKiosk() {
  const voice = useJessicaVoice();
  const { start, pttDown, pttUp } = voice;
  const [ambient, setAmbient] = useState<boolean | null>(null);
  const ambientStarted = useRef(false);
  const [hideCursor, setHideCursor] = useState(true);
  const [cursorHint, setCursorHint] = useState(true);
  const talkLocked = voice.status === "needs-start"
    || voice.status === "connecting"
    || voice.status === "error"
    || voice.status === "stopped"
    || voice.status === "handoff"
    || voice.vadFallback;
  const showWake = voice.status === "needs-start" || voice.status === "connecting" || voice.status === "error";

  const readDisplay = useCallback(() => {
    setAmbient(jessicaDisplayFromSearch(window.location.search) === "ambient");
  }, []);

  useEffect(() => {
    readDisplay();
    window.addEventListener("popstate", readDisplay);
    return () => window.removeEventListener("popstate", readDisplay);
  }, [readDisplay]);

  useEffect(() => {
    document.documentElement.classList.toggle("jessica-kiosk-cursor-hidden", hideCursor);
    return () => document.documentElement.classList.remove("jessica-kiosk-cursor-hidden");
  }, [hideCursor]);

  useEffect(() => {
    if (ambient) return;
    const hint = window.setTimeout(() => setCursorHint(false), 6000);
    return () => window.clearTimeout(hint);
  }, [ambient]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock?.request("screen");
        if (cancelled) {
          await next?.release();
          return;
        }
        lock = next ?? null;
      } catch {
        // Display sleep can also be turned off in System Settings.
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  useEffect(() => {
    if (ambient !== true) {
      ambientStarted.current = false;
      return;
    }
    if (ambientStarted.current) return;
    ambientStarted.current = true;
    start();
  }, [ambient, start]);

  useEffect(() => {
    if (ambient !== true) return;
    requestFullscreen();
    const onGesture = () => requestFullscreen();
    window.addEventListener("pointerdown", onGesture, { once: true });
    return () => window.removeEventListener("pointerdown", onGesture);
  }, [ambient]);

  const enterAmbient = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "ambient");
    url.searchParams.delete("display");
    window.history.pushState({}, "", url);
    setAmbient(true);
    requestFullscreen();
  }, []);

  const leaveAmbient = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("mode");
    url.searchParams.delete("display");
    window.history.pushState({}, "", url);
    setAmbient(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "KeyB" && ambient && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
        leaveAmbient();
        return;
      }
      if (event.code === "KeyC" && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setHideCursor((value) => !value);
        setCursorHint(true);
        return;
      }
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      start();
      pttDown();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      pttUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [ambient, leaveAmbient, start, pttDown, pttUp]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else requestFullscreen();
  };

  const holdDown = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    if ("setPointerCapture" in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    start();
    pttDown();
  };

  if (ambient === null) {
    return <main className="h-dvh min-h-dvh w-full bg-[#00072E]" />;
  }

  if (ambient) {
    const poseStatus = ambientAvatarStatus(voice.status);
    const poseCaption = voice.status === "error" || voice.status === "needs-start" || voice.status === "connecting"
      ? ""
      : voice.caption;
    return (
      <main
        className="relative h-dvh min-h-dvh w-full select-none overflow-hidden bg-[#00072E] text-white"
        data-display="ambient"
        aria-label="Jessica"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={holdDown}
        onPointerUp={() => pttUp()}
        onPointerCancel={() => pttUp()}
        style={{ touchAction: "none" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: [
              "radial-gradient(circle at 50% 46%, rgba(242,246,255,0.20), transparent 36%)",
              "radial-gradient(circle at 50% 52%, rgba(3,201,255,0.14), transparent 46%)",
              "radial-gradient(circle at 72% 78%, rgba(1,99,253,0.18), transparent 40%)",
              "linear-gradient(180deg, #07133f 0%, #00072E 48%, #0b1738 100%)",
            ].join(", "),
          }}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16] mix-blend-soft-light" aria-hidden="true">
          <filter id="jessica-ambient-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#jessica-ambient-grain)" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="aspect-square h-[min(78vh,78vw)] w-[min(78vh,78vw)]">
            <JessicaAvatar
              status={poseStatus}
              caption={poseCaption}
              mouth={voice.mouth}
              pressed={voice.status === "listening" && !voice.vadFallback}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="relative flex h-dvh min-h-dvh w-full select-none flex-col overflow-x-hidden overflow-y-auto bg-[#00072E] text-white [font-family:var(--font-aa-body),Arial,sans-serif]"
      data-display="booth"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(3,201,255,0.16),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(1,99,253,0.2),transparent_36%)]" />

      <header className="relative z-10 flex items-center justify-between gap-6 border-b border-white/15 px-8 py-5 sm:px-12">
        <div className="min-w-0">
          <span className="inline-flex rounded-xl bg-white px-3 py-1.5">
            <AccelWordmark height={36} />
          </span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white [font-family:var(--font-aa-display),Georgia,serif] sm:text-4xl">Jessica</h1>
          <p className="mt-1 text-base text-white/80">Put AI to work without overwhelming your team.</p>
        </div>
        <p className="text-right text-sm text-white/80 sm:text-base">Booth assistant</p>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center gap-8 px-8 pb-8 lg:flex-row lg:px-14">
        <section className="flex w-full max-w-xl flex-col items-center lg:w-[46%]">
          <div className="aspect-square w-full max-w-[28rem]">
            <JessicaAvatar
              status={voice.status}
              caption={voice.errorMessage || voice.caption}
              mouth={voice.mouth}
              pressed={voice.status === "listening" && !voice.vadFallback}
            />
          </div>
          <p className="mt-2 text-center text-lg text-white/80">Accel Analysis assistant</p>
          <p className="mt-4 min-h-8 text-center text-2xl font-semibold" aria-live="polite">
            {statusLabel(voice.status, voice.vadFallback)}
          </p>
          <p className="mt-3 max-w-lg text-center text-xl leading-snug text-white" aria-live="polite">
            {voice.errorMessage || voice.caption}
          </p>
        </section>

        <section className="flex w-full flex-1 flex-col items-center justify-center gap-6">
          {showWake ? (
            <button
              type="button"
              className="flex h-64 w-64 items-center justify-center rounded-full bg-[#0163FD] text-center text-3xl font-semibold text-white shadow-2xl transition active:scale-[0.98] disabled:opacity-60 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#03C9FF] sm:h-72 sm:w-72"
              onClick={voice.start}
              disabled={voice.status === "connecting"}
            >
              {voice.status === "connecting" ? "Starting…" : voice.status === "error" ? "Try again" : "Tap to start"}
            </button>
          ) : (
            <button
              type="button"
              className={`flex h-64 w-64 items-center justify-center rounded-full text-3xl font-semibold shadow-2xl transition active:scale-[0.98] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#03C9FF] sm:h-72 sm:w-72 ${
                voice.status === "listening"
                  ? "bg-white text-[#00072E] ring-8 ring-[#03C9FF]"
                  : "bg-[#0163FD] text-white"
              } ${talkLocked ? "opacity-50" : ""}`}
              style={{ touchAction: "none" }}
              aria-pressed={voice.status === "listening"}
              disabled={talkLocked}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                voice.pttDown();
              }}
              onPointerUp={() => voice.pttUp()}
              onPointerCancel={() => voice.pttUp()}
            >
              {voice.vadFallback ? "Listening" : voice.status === "listening" ? "Release" : "Hold to talk"}
            </button>
          )}
          <p className="max-w-md text-center text-base text-white/80">
            Press and hold, speak, then release. The space bar does the same thing.
          </p>

          <div className="w-full max-w-xl rounded-3xl border-2 border-white/20 bg-white px-8 py-6 text-center text-[#1B1B1B]">
            <p className="text-sm font-semibold tracking-[0.18em] text-[#0163FD] uppercase">iPad form</p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-[#00072E] sm:text-4xl">{IPAD_FORM_PATH}</p>
            <p className="mt-3 text-lg text-[#1B1B1B]">
              Enter details on the iPad. This screen does not collect them.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="min-h-14 rounded-full bg-white px-6 text-lg font-semibold text-[#00072E]"
              onClick={voice.reset}
            >
              Next visitor
            </button>
            <button
              type="button"
              className="min-h-14 rounded-full border-2 border-white/40 px-6 text-lg text-white"
              onClick={fullscreen}
            >
              Fullscreen this display
            </button>
            <button
              type="button"
              className="min-h-14 rounded-full border-2 border-[#03C9FF] px-6 text-lg text-white"
              onClick={enterAmbient}
            >
              Presentation
            </button>
            <button
              type="button"
              className={`min-h-14 rounded-full border-2 px-6 text-lg ${voice.vadFallback ? "border-[#03C9FF] text-white" : "border-white/40 text-white/80"}`}
              aria-pressed={voice.vadFallback}
              onClick={() => voice.setVadFallback(!voice.vadFallback)}
            >
              {voice.vadFallback ? "Auto-listen on" : "Auto-listen off"}
            </button>
          </div>
        </section>
      </div>

      {cursorHint && (
        <p className="absolute bottom-4 left-8 z-10 text-sm text-white/80">
          {hideCursor ? "Pointer hidden. Press C to show it." : "Pointer visible. Press C to hide it."}
        </p>
      )}
    </main>
  );
}
