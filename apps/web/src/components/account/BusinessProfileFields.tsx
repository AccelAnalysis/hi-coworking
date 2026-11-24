"use client";

import { HIG_FIELD, HIG_LABEL, HigSegmented, HigSelect, HigSwitch, NearLimitCount } from "../forms/HigControls";
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

const DESCRIPTION_WARN_AT = BUSINESS_LIMITS.businessDescription - 30;

type Props = {
  idPrefix: string;
  value: BusinessProfileDraft;
  onChange: (next: BusinessProfileDraft) => void;
  disabled?: boolean;
  /** Field name the server or client rejected, so it can be marked invalid. */
  invalidField?: string | null;
};

const ROLE_OPTIONS = BUSINESS_ROLES.map((role) => ({ value: role, label: BUSINESS_ROLE_LABELS[role] }));

export function BusinessProfileFields({ idPrefix, value, onChange, disabled, invalidField }: Props) {
  const set = (patch: Partial<BusinessProfileDraft>) => onChange({ ...value, ...patch });
  const id = (name: string) => `${idPrefix}-${name}`;
  const invalid = (name: string) => (invalidField === name ? true : undefined);

  return (
    <fieldset className="grid gap-5" disabled={disabled} data-testid="business-profile-fields">
      <legend className="sr-only">Your business</legend>

      <div>
        <div className="mb-1.5 flex h-6 items-center justify-between gap-3">
          <label className={HIG_LABEL} htmlFor={id("company")}>Business name</label>
          <HigSwitch
            id={id("independent")}
            label="Independent"
            checked={value.isIndependent}
            disabled={disabled}
            onChange={(isIndependent) => set({ isIndependent })}
          />
        </div>
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
          className={HIG_FIELD}
        />
      </div>

      <div>
        <p id={id("role-label")} className={`${HIG_LABEL} mb-1.5`}>Your role</p>
        <HigSegmented
          name={id("role")}
          labelledBy={id("role-label")}
          options={ROLE_OPTIONS}
          value={value.role}
          invalid={invalid("role")}
          onChange={(role) => set({ role })}
        />
      </div>

      <div>
        <label className={`${HIG_LABEL} mb-1.5`} htmlFor={id("type")}>Business type</label>
        <HigSelect
          id={id("type")}
          required
          aria-invalid={invalid("businessType")}
          value={value.businessType}
          onChange={(event) => set({ businessType: event.target.value })}
          className={value.businessType ? "" : "text-slate-500"}
        >
          <option value="" disabled>Choose one</option>
          {BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>{BUSINESS_TYPE_LABELS[type]}</option>
          ))}
        </HigSelect>
      </div>

      <div>
        <label className={`${HIG_LABEL} mb-1.5`} htmlFor={id("description")}>What you do</label>
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
          className={HIG_FIELD}
        />
        <NearLimitCount
          id={id("description-count")}
          length={value.businessDescription.length}
          max={BUSINESS_LIMITS.businessDescription}
          warnAt={DESCRIPTION_WARN_AT}
        />
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-3 text-sm font-medium text-slate-600">Optional</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={`${HIG_LABEL} mb-1.5`} htmlFor={id("website")}>Website</label>
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
              className={HIG_FIELD}
            />
          </div>
          <div>
            <label className={`${HIG_LABEL} mb-1.5`} htmlFor={id("scc")}>Virginia SCC ID</label>
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
              className={HIG_FIELD}
            />
            <p id={id("scc-hint")} className="mt-1 text-xs text-slate-600">State business registration, if you have one.</p>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
