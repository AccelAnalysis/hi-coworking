"use client";

import Link from "next/link";
import { useId } from "react";
import { HI_SMS_CONSENT_TEXT, SMS_TERMS_PATH } from "@/lib/smsConsent";

const CONSENT_LEAD = HI_SMS_CONSENT_TEXT.replace(/ See SMS Terms and Privacy Policy\.$/, "");

/**
 * Optional SMS opt-in. Unchecked by default and never required. The wording
 * matches the registered A2P campaign, with SMS Terms and Privacy Policy
 * links right next to it.
 */
export function SmsConsentCheckbox({
  checked,
  onChange,
  disabled,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-start gap-3 text-sm leading-6 text-slate-600 ${className}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0"
      />
      <label htmlFor={id}>
        <span className="font-medium text-slate-800">Text messages (optional). </span>
        {CONSENT_LEAD} See{" "}
        <Link href={SMS_TERMS_PATH} target="_blank" className="font-semibold text-sky-800 underline underline-offset-2">
          SMS Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" target="_blank" className="font-semibold text-sky-800 underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </label>
    </div>
  );
}
