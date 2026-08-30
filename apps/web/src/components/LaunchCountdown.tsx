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

function SplitFlapUnit({ value, label }: { value: string; label: string }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (value === displayValue) return;

    setPreviousValue(displayValue);
    setDisplayValue(value);
    setFlipping(true);

    const timer = window.setTimeout(() => setFlipping(false), 680);
    return () => window.clearTimeout(timer);
  }, [displayValue, value]);

  return (
    <div className={styles.unit}>
      <div className={styles.card}>
        <div className={`${styles.half} ${styles.top}`}>
          <span>{displayValue}</span>
        </div>
        <div className={`${styles.half} ${styles.bottom}`}>
          <span>{displayValue}</span>
        </div>

        {flipping && (
          <>
            <div className={`${styles.flap} ${styles.topFlap}`}>
              <span>{previousValue}</span>
            </div>
            <div className={`${styles.flap} ${styles.bottomFlap}`}>
              <span>{displayValue}</span>
            </div>
          </>
        )}
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

export function LaunchCountdown({ onComplete }: { onComplete?: () => void }) {
  const [countdown, setCountdown] = useState<CountdownValue>(() => getCountdownValue(Date.now()));
  const trackRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);

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
    const track = trackRef.current;
    const sticky = stickyRef.current;
    const clock = clockRef.current;
    if (!track || !sticky || !clock) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let frame = 0;
    let lastScrollY = window.scrollY;

    const updatePerspective = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const stickyTop = Number.parseFloat(window.getComputedStyle(sticky).top) || 0;
      const travel = Math.max(1, track.offsetHeight - sticky.offsetHeight);
      const progress = Math.max(0, Math.min(1, (stickyTop - rect.top) / travel));
      const perspectiveProgress = progress * 2 - 1;
      const delta = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;

      const tilt = -perspectiveProgress * 17;
      const yaw = Math.max(-5, Math.min(5, delta * 0.08));

      clock.style.setProperty("--scroll-tilt", `${tilt.toFixed(2)}deg`);
      clock.style.setProperty("--scroll-yaw", `${yaw.toFixed(2)}deg`);
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
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Hi Coworking</p>
        <h1 id="launch-countdown-title" className={styles.title}>
          Something good is getting ready.
        </h1>
        <p className={styles.subhead}>Our doors open soon.</p>
        <p className={styles.srOnly} aria-live="off">
          {accessibleTime} until opening.
        </p>
      </div>

      <div ref={trackRef} className={styles.track}>
        <div ref={stickyRef} className={styles.sticky}>
          <div className={styles.shell}>
            <div ref={clockRef} className={styles.clock} aria-hidden="true">
              <SplitFlapUnit value={countdown.days} label="Days" />
              <SplitFlapUnit value={countdown.hours} label="Hours" />
              <SplitFlapUnit value={countdown.minutes} label="Minutes" />
              <SplitFlapUnit value={countdown.seconds} label="Seconds" />
            </div>
            <p className={styles.hint}>Scroll to change the viewing angle.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
