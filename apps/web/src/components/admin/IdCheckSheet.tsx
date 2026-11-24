"use client";

import { useId, useState } from "react";
import { ConfirmSheet } from "@/components/admin/ConfirmSheet";
import { cleanInitials } from "@/lib/idCheck";
import { HIG_FIELD, HIG_LABEL } from "@/components/forms/HigControls";

/**
 * Staff confirm sheet for the first-visit in-person ID check. Records yes/no,
 * the time and the staff member's initials only. There is deliberately no
 * field for an ID number, ID type, photo or note.
 */
export function IdCheckSheet({
  open,
  memberLabel,
  checked,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  memberLabel: string;
  checked: boolean;
  busy?: boolean;
  onSubmit: (staffInitials: string) => Promise<void>;
  onClose: () => void;
}) {
  const [initials, setInitials] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const initialsId = useId();

  return (
    <ConfirmSheet
      open={open}
      title={checked ? `ID checked for ${memberLabel}` : `Clear ID check for ${memberLabel}`}
      confirmLabel={checked ? "Record ID check" : "Clear ID check"}
      cancelLabel="Cancel"
      destructive={!checked}
      busy={busy}
      confirmDisabled={initials.length < 2}
      onClose={() => {
        setInitials("");
        setProblem(null);
        onClose();
      }}
      onConfirm={async () => {
        if (initials.length < 2) return setProblem("Enter your initials (2 to 4 letters).");
        await onSubmit(initials);
        setInitials("");
      }}
    >
      <div className="space-y-4 text-left">
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200">
          {checked
            ? "Look at a photo ID in person and confirm the name matches. Don’t write down or photograph the ID."
            : "The member will need an ID check again on their next visit."}
        </p>
        <div className="w-28">
          <label htmlFor={initialsId} className={`${HIG_LABEL} mb-1.5`}>Your initials</label>
          <input
            id={initialsId}
            className={`${HIG_FIELD} text-center font-semibold uppercase tracking-[0.2em]`}
            value={initials}
            onChange={(event) => setInitials(cleanInitials(event.target.value))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={4}
            inputMode="text"
            placeholder="JD"
            required
          />
        </div>
        {problem ? <p className="text-sm text-rose-700" role="alert">{problem}</p> : null}
      </div>
    </ConfirmSheet>
  );
}
