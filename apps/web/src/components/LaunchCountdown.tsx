"use client";

import { useEffect, useState } from "react";
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

function FlipDigit({ value }: { value: string }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (value === displayValue) return;

    setPreviousValue(displayValue);
    setDisplayValue(value);
    setFlipping(true);

    const timer = window.setTimeout(() => setFlipping(false), 760);
    return () => window.clearTimeout(timer);
  }, [displayValue, value]);

  return (
    <div className={styles.flipCard}>
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
  );
}

function FlipValue({ value }: { value: string }) {
  return (
    <div className={styles.digits}>
      {value.split("").map((digit, index) => (
        <FlipDigit key={index} value={digit} />
      ))}
    </div>
  );
}

export function LaunchCountdown({ onComplete }: { onComplete?: () => void }) {
  const [countdown, setCountdown] = useState<CountdownValue>(() => getCountdownValue(Date.now()));

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

        <div className={styles.clock} aria-hidden="true">
          <div className={styles.unit}>
            <FlipValue value={countdown.days} />
            <span className={styles.label}>Days</span>
          </div>
          <div className={styles.unit}>
            <FlipValue value={countdown.hours} />
            <span className={styles.label}>Hours</span>
          </div>
          <div className={styles.unit}>
            <FlipValue value={countdown.minutes} />
            <span className={styles.label}>Minutes</span>
          </div>
          <div className={styles.unit}>
            <FlipValue value={countdown.seconds} />
            <span className={styles.label}>Seconds</span>
          </div>
        </div>
      </div>
    </section>
  );
}
