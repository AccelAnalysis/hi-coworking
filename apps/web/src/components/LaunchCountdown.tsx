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

function PerspectiveUnit({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.unit}>
      <div className={styles.face}>
        <strong>{value}</strong>
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

export function LaunchCountdown({ onComplete }: { onComplete?: () => void }) {
  const [countdown, setCountdown] = useState<CountdownValue>(() => getCountdownValue(Date.now()));
  const shellRef = useRef<HTMLDivElement>(null);
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
    const shell = shellRef.current;
    const clock = clockRef.current;
    if (!shell || !clock) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;

    const updatePerspective = () => {
      frame = 0;
      const rect = shell.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const center = rect.top + rect.height / 2;
      const progress = Math.max(-1, Math.min(1, (viewportHeight / 2 - center) / (viewportHeight * 0.56)));
      const tilt = progress * 26;
      const yaw = -tilt * 0.12;

      clock.style.setProperty("--scroll-tilt", `${tilt.toFixed(2)}deg`);
      clock.style.setProperty("--scroll-yaw", `${yaw.toFixed(2)}deg`);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updatePerspective);
    };

    updatePerspective();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
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

      <div ref={shellRef} className={styles.shell}>
        <div ref={clockRef} className={styles.clock} aria-hidden="true">
          <PerspectiveUnit value={countdown.days} label="Days" />
          <PerspectiveUnit value={countdown.hours} label="Hours" />
          <PerspectiveUnit value={countdown.minutes} label="Minutes" />
          <PerspectiveUnit value={countdown.seconds} label="Seconds" />
        </div>
      </div>
    </section>
  );
}
