"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";

/**
 * Apple HIG-style form primitives shared by sign-up, the profile page and
 * guest checkout, so every control has the same height (44px), radius,
 * border, focus ring (Hi Navy) and label type.
 */
export const HIG_LABEL = "flex h-6 items-center text-sm font-medium text-slate-700";
export const HIG_FIELD =
  "block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 placeholder:text-slate-500 transition-colors focus:border-[#101D4B] focus:outline-none focus:ring-2 focus:ring-[#101D4B]/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-rose-600";
export const HIG_CARD = "rounded-2xl border border-slate-200/80 bg-white";
export const HIG_CANVAS = "bg-[#F5F6F8]";
const HIG_BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#101D4B] focus-visible:ring-offset-2 disabled:cursor-not-allowed";
/** Solid Hi Navy primary; turns muted slate when disabled. */
export const HIG_PRIMARY = `${HIG_BUTTON_BASE} bg-[#101D4B] text-white hover:bg-[#1B2A63] disabled:bg-slate-200 disabled:text-slate-600`;
/** Same shape, muted: the form isn't complete yet. */
export const HIG_PRIMARY_MUTED = `${HIG_BUTTON_BASE} bg-slate-200 text-slate-600`;
export const HIG_TINTED =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#101D4B]/[0.08] px-4 text-sm font-semibold text-[#101D4B] transition-colors hover:bg-[#101D4B]/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#101D4B] focus-visible:ring-offset-2";
export const HIG_LINK = "font-medium text-[#101D4B] underline decoration-[#101D4B]/30 underline-offset-2 hover:decoration-[#101D4B]";

/** A titled white card on the neutral canvas. */
export function InsetCard({
  title,
  titleId,
  description,
  accessory,
  children,
  className = "",
}: {
  title?: string;
  titleId?: string;
  description?: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={title ? titleId : undefined} className={`${HIG_CARD} p-5 sm:p-6 ${className}`}>
      {title ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold text-[#101D4B]">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          {accessory}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Select styled exactly like the text inputs, with a custom chevron. */
export function HigSelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${HIG_FIELD} appearance-none pr-10 ${className}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
    </div>
  );
}

/**
 * iOS-style switch. Visually compact so it fits a label row, with an
 * invisible 44px hit area.
 */
export function HigSwitch({
  id,
  checked,
  onChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="cursor-pointer text-sm text-slate-600">{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#101D4B] focus-visible:ring-offset-2 disabled:opacity-50 ${
          checked ? "bg-[#101D4B]" : "bg-slate-300"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
        />
      </button>
    </span>
  );
}

/** Apple-style segmented control (one track, the selected segment lifts). */
export function HigSegmented<T extends string>({
  name,
  labelledBy,
  options,
  value,
  onChange,
  invalid,
}: {
  name: string;
  labelledBy: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: string;
  onChange: (value: T) => void;
  invalid?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-required="true"
      aria-invalid={invalid ? true : undefined}
      className={`grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 ${invalid ? "ring-1 ring-rose-600" : ""}`}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex min-h-9 cursor-pointer items-center justify-center rounded-md px-1 text-[13px] transition sm:text-sm focus-within:ring-2 focus-within:ring-[#101D4B] ${
              selected ? "bg-white font-medium text-[#101D4B] shadow-sm" : "text-slate-700 hover:text-slate-900"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

/** Character count that stays quiet until the user is near the limit. */
export function NearLimitCount({ id, length, max, warnAt }: { id: string; length: number; max: number; warnAt: number }) {
  return (
    <span id={id} aria-live="polite" className="block min-h-5 pt-1 text-right text-xs tabular-nums text-slate-600">
      {length >= warnAt ? `${length}/${max}` : ""}
    </span>
  );
}
