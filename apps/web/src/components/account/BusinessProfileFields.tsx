"use client";

import { BriefcaseBusiness, Building2, Globe, Landmark, UserRound } from "lucide-react";
import {
  BUSINESS_LIMITS,
  BUSINESS_ROLES,
  BUSINESS_ROLE_LABELS,
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  INDEPENDENT_LABEL,
} from "../../../../functions/src/providers/businessProfile";

/**
 * Business profile fields (renter screening). Shared by /register and the
 * profile section on /preferences. Business use only: nothing here asks about
 * personal traits, and no ID image or ID number is ever collected.
 */
export type BusinessProfileDraft = {
  company: string;
  isIndependent: boolean;
  role: string;
  businessType: string;
  businessDescription: string;
  website: string;
  vaSccNumber: string;
};

export const EMPTY_BUSINESS_PROFILE: BusinessProfileDraft = {
  company: "",
  isIndependent: false,
  role: "",
  businessType: "",
  businessDescription: "",
  website: "",
  vaSccNumber: "",
};

/** Fills the form from a stored accountDetails doc (existing `company` values carry over). */
export function businessDraftFromStored(stored: Record<string, unknown> | null | undefined): BusinessProfileDraft {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    company: text(stored?.company),
    isIndependent: stored?.isIndependent === true,
    role: text(stored?.role),
    businessType: text(stored?.businessType),
    businessDescription: text(stored?.businessDescription),
    website: text(stored?.website),
    vaSccNumber: text(stored?.vaSccNumber),
  };
}

const FIELD =
  "mt-1.5 w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#101D4B]";
const LABEL = "flex items-center gap-2 text-sm font-semibold text-slate-700";

type Props = {
  idPrefix: string;
  value: BusinessProfileDraft;
  onChange: (next: BusinessProfileDraft) => void;
  disabled?: boolean;
  /** Field name the server or client rejected, so it can be marked invalid. */
  invalidField?: string | null;
};

export function BusinessProfileFields({ idPrefix, value, onChange, disabled, invalidField }: Props) {
  const set = (patch: Partial<BusinessProfileDraft>) => onChange({ ...value, ...patch });
  const id = (name: string) => `${idPrefix}-${name}`;
  const invalid = (name: string) => (invalidField === name ? true : undefined);

  return (
    <fieldset className="grid gap-5 sm:grid-cols-2" disabled={disabled} data-testid="business-profile-fields">
      <legend className="sr-only">Your business</legend>

      <div className="sm:col-span-2">
        <label className={LABEL} htmlFor={id("company")}>
          <Building2 className="h-4 w-4 text-[#101D4B]" aria-hidden="true" /> Business name
        </label>
        <input
          id={id("company")}
          type="text"
          autoComplete="organization"
          maxLength={BUSINESS_LIMITS.company}
          required={!value.isIndependent}
          disabled={disabled || value.isIndependent}
          aria-invalid={invalid("company")}
          value={value.isIndependent ? "" : value.company}
          onChange={(event) => set({ company: event.target.value })}
          placeholder={value.isIndependent ? INDEPENDENT_LABEL : "Your company or organization"}
          className={`${FIELD} disabled:bg-slate-100 disabled:text-slate-500`}
        />
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-700" htmlFor={id("independent")}>
          <input
            id={id("independent")}
            type="checkbox"
            checked={value.isIndependent}
            onChange={(event) => set({ isIndependent: event.target.checked })}
            className="h-5 w-5 shrink-0 accent-[#101D4B]"
          />
          {INDEPENDENT_LABEL}
        </label>
      </div>

      <div className="sm:col-span-2" role="radiogroup" aria-labelledby={id("role-label")} aria-required="true" aria-invalid={invalid("role")}>
        <p id={id("role-label")} className={LABEL}>
          <UserRound className="h-4 w-4 text-[#101D4B]" aria-hidden="true" /> Your role
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BUSINESS_ROLES.map((role) => {
            const selected = value.role === role;
            return (
              <label
                key={role}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-[#101D4B] focus-within:ring-offset-2 ${
                  selected ? "border-[#101D4B] bg-[#101D4B] text-white" : "border-slate-300 bg-white text-slate-800 hover:border-[#101D4B]"
                }`}
              >
                <input
                  type="radio"
                  name={id("role")}
                  value={role}
                  checked={selected}
                  onChange={() => set({ role })}
                  className="sr-only"
                />
                {BUSINESS_ROLE_LABELS[role]}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor={id("type")}>
          <BriefcaseBusiness className="h-4 w-4 text-[#101D4B]" aria-hidden="true" /> Business type
        </label>
        <select
          id={id("type")}
          required
          aria-invalid={invalid("businessType")}
          value={value.businessType}
          onChange={(event) => set({ businessType: event.target.value })}
          className={FIELD}
        >
          <option value="" disabled>Choose one</option>
          {BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>{BUSINESS_TYPE_LABELS[type]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL} htmlFor={id("description")}>
          What you do
        </label>
        <input
          id={id("description")}
          type="text"
          required
          maxLength={BUSINESS_LIMITS.businessDescription}
          aria-invalid={invalid("businessDescription")}
          aria-describedby={id("description-count")}
          value={value.businessDescription}
          onChange={(event) => set({ businessDescription: event.target.value })}
          placeholder="e.g. Bookkeeping for local shops"
          className={FIELD}
        />
        <p id={id("description-count")} className="mt-1 text-xs text-slate-600">
          {value.businessDescription.length}/{BUSINESS_LIMITS.businessDescription}
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor={id("website")}>
          <Globe className="h-4 w-4 text-[#101D4B]" aria-hidden="true" /> Website <span className="font-normal text-slate-600">(optional)</span>
        </label>
        <input
          id={id("website")}
          type="text"
          inputMode="url"
          autoComplete="url"
          maxLength={BUSINESS_LIMITS.website}
          aria-invalid={invalid("website")}
          value={value.website}
          onChange={(event) => set({ website: event.target.value })}
          placeholder="example.com"
          className={FIELD}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor={id("scc")}>
          <Landmark className="h-4 w-4 text-[#101D4B]" aria-hidden="true" /> Virginia SCC ID <span className="font-normal text-slate-600">(optional)</span>
        </label>
        <input
          id={id("scc")}
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={BUSINESS_LIMITS.vaSccNumber}
          aria-invalid={invalid("vaSccNumber")}
          aria-describedby={id("scc-hint")}
          value={value.vaSccNumber}
          onChange={(event) => set({ vaSccNumber: event.target.value })}
          placeholder="S1234567"
          className={FIELD}
        />
        <p id={id("scc-hint")} className="mt-1 text-xs text-slate-600">Business registration number, if you have one.</p>
      </div>
    </fieldset>
  );
}
