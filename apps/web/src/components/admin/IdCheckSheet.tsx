"use client";

import { useState } from "react";
import { ConfirmSheet } from "@/components/admin/ConfirmSheet";
import { cleanInitials } from "@/lib/idCheck";

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
        {checked ? (
          <p className="text-sm text-slate-700">
            Confirm you looked at a photo ID in person and the name matches. Don&apos;t write down or photograph the ID.
          </p>
        ) : (
          <p className="text-sm text-slate-700">The member will need an ID check again on their next visit.</p>
        )}
        <label className="block space-y-1 text-sm font-medium text-slate-800">
          <span className="block">Your initials</span>
          <input
            className="min-h-11 w-32 rounded-xl border border-slate-300 px-3 text-base uppercase tracking-widest text-slate-900"
            value={initials}
            onChange={(event) => setInitials(cleanInitials(event.target.value))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={4}
            inputMode="text"
            required
          />
        </label>
        {problem ? <p className="text-sm text-rose-700" role="alert">{problem}</p> : null}
      </div>
    </ConfirmSheet>
  );
}
