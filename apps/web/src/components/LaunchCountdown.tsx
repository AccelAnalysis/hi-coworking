"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LaunchCountdown.module.css";

export const PUBLIC_LAUNCH_AT = new Date("2026-10-01T00:00:00-04:00").getTime();

type CountdownValue = {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

function getCountdownValue(now: number): CountdownValue {
  const remaining = Math.max(0, PUBLIC_LAUNCH_AT - now);
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);

  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

function PerspectiveUnit({ value, label, index }: { value: string; label: string; index: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    if (value === displayValue) return;

    setPreviousValue(displayValue);
    setDisplayValue(value);
    setScrolling(true);

    const timer = window.setTimeout(() => setScrolling(false), 500);
    return () => window.clearTimeout(timer);
  }, [displayValue, value]);

  return (
    <div className={styles.unit} data-perspective-unit data-index={index}>
      <div className={styles.plate}>
        <div className={styles.valueStack}>
          {scrolling ? (
            <>
              <span className={`${styles.value} ${styles.leaving}`}>{previousValue}</span>
              <span className={`${styles.value} ${styles.entering}`}>{displayValue}</span>
            </>
          ) : (
            <span className={styles.value}>{displayValue}</span>
          )}
        </div>
        <span className={styles.label}>{label}</span>
      </div>
    </div>
  );
}

export function LaunchCountdown({ onComplete }: { onComplete?: () => void }) {
  const [countdown, setCountdown] = useState<CountdownValue>(() => getCountdownValue(Date.now()));
  const perspectiveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setCountdown(getCountdownValue(now));

      if (now >= PUBLIC_LAUNCH_AT) {
        onComplete?.();
      }
    };

    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [onComplete]);

  useEffect(() => {
    const stage = perspectiveRef.current;
    if (!stage) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let frame = 0;

    const updatePerspective = () => {
      frame = 0;
      const rect = stage.getBoundingClientRect();
      const viewportHeight = Math.max(window.innerHeight, 1);
      const stageCenter = rect.top + rect.height / 2;
      const viewportCenter = viewportHeight / 2;
      const normalized = Math.max(-1, Math.min(1, (stageCenter - viewportCenter) / viewportHeight));

      stage.style.setProperty("--tilt", `${(-normalized * 9).toFixed(2)}deg`);
      stage.style.setProperty("--shift", `${(-normalized * 7).toFixed(2)}px`);

      stage.querySelectorAll<HTMLElement>("[data-perspective-unit]").forEach((unit, index) => {
        const side = index % 2 === 0 ? 1 : -1;
        const spread = index < 2 ? -1 : 1;
        unit.style.setProperty("--yaw", `${(normalized * side * 4.5).toFixed(2)}deg`);
        unit.style.setProperty("--unit-depth", `${(Math.abs(normalized) * spread * 8).toFixed(2)}px`);
        unit.style.setProperty("--plate-depth", `${(16 + Math.abs(normalized) * 8).toFixed(2)}px`);
        unit.style.setProperty("--card-tilt", `${(-normalized * 3.5).toFixed(2)}deg`);
      });
    };

    const requestPerspectiveUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updatePerspective);
    };

    updatePerspective();
    window.addEventListener("scroll", requestPerspectiveUpdate, { passive: true });
    window.addEventListener("resize", requestPerspectiveUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", requestPerspectiveUpdate);
      window.removeEventListener("resize", requestPerspectiveUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const accessibleTime = `${Number(countdown.days)} days, ${Number(countdown.hours)} hours, ${Number(countdown.minutes)} minutes, and ${Number(countdown.seconds)} seconds`;

  return (
    <section className={styles.countdown} aria-labelledby="launch-countdown-title">
      <div className={styles.inner}>
        <p className={styles.eyebrow}>Hi Coworking</p>
        <h1 id="launch-countdown-title" className={styles.title}>
          Something good is getting ready.
        </h1>
        <p className={styles.subhead}>Our doors open soon.</p>

        <p className={styles.srOnly} aria-live="off">
          {accessibleTime} until opening.
        </p>

        <div ref={perspectiveRef} className={styles.perspective}>
          <div className={styles.clock} aria-hidden="true">
            <PerspectiveUnit value={countdown.days} label="Days" index={0} />
            <PerspectiveUnit value={countdown.hours} label="Hours" index={1} />
            <PerspectiveUnit value={countdown.minutes} label="Minutes" index={2} />
            <PerspectiveUnit value={countdown.seconds} label="Seconds" index={3} />
          </div>
        </div>
      </div>
    </section>
  );
}
