"use client";

import { useEffect, useRef, type RefObject } from "react";

export const VISITOR_CONFIRM_HEADING = "Thanks, you're all set.";
export const VISITOR_CONFIRM_BODY =
  "We've saved your info, and someone from Accel Analysis will follow up.";
export const VISITOR_CONFIRM_ACTION = "Start a new entry";
/** Shared booth iPad: return to an empty form when nobody is using the screen. */
export const VISITOR_CONFIRM_IDLE_MS = 30_000;

/** Move focus to the confirmation heading, then clear it after 30s without a tap or key. */
export function useVisitorConfirmBehavior(onIdle: () => void): RefObject<HTMLHeadingElement | null> {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let timer = window.setTimeout(() => onIdleRef.current(), VISITOR_CONFIRM_IDLE_MS);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onIdleRef.current(), VISITOR_CONFIRM_IDLE_MS);
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  return headingRef;
}

export function VisitorConfirmation({
  onStartNew,
  detail,
  variant,
}: {
  onStartNew: () => void;
  detail?: string;
  variant: "intake" | "power-now";
}) {
  const headingRef = useVisitorConfirmBehavior(onStartNew);

  if (variant === "power-now") {
    return (
      <div className="pn-thanks" role="status">
        <h2 ref={headingRef} tabIndex={-1} id="pn-confirm-heading">
          {VISITOR_CONFIRM_HEADING}
        </h2>
        <p>{VISITOR_CONFIRM_BODY}</p>
        {detail ? <p>{detail}</p> : null}
        <button type="button" className="pn-btn pn-btn-outline" onClick={onStartNew}>
          {VISITOR_CONFIRM_ACTION}
        </button>
      </div>
    );
  }

  return (
    <section role="status" className="rounded-3xl bg-white px-6 py-10 text-center shadow-sm">
      <h2
        ref={headingRef}
        tabIndex={-1}
        id="intake-confirm-heading"
        className="text-4xl font-bold tracking-tight text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#03C9FF] sm:text-5xl"
      >
        {VISITOR_CONFIRM_HEADING}
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-2xl leading-snug text-[#1B1B1B]">{VISITOR_CONFIRM_BODY}</p>
      {detail ? <p className="mx-auto mt-3 max-w-xl text-xl leading-snug">{detail}</p> : null}
      <button
        type="button"
        onClick={onStartNew}
        className="mt-8 min-h-16 w-full rounded-2xl bg-[#0163FD] px-6 text-2xl font-semibold text-white focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
      >
        {VISITOR_CONFIRM_ACTION}
      </button>
    </section>
  );
}
