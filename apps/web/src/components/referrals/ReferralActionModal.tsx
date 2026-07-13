"use client";

import { useState } from "react";
import { Loader2, X, Check } from "lucide-react";
import type { ReferralDoc } from "@hi/shared";
import { convertReferralFn } from "@/lib/functions";

interface ReferralActionModalProps {
  referral: ReferralDoc;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function ReferralActionModal({ referral, isOpen, onClose, onUpdate }: ReferralActionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [note, setNote] = useState("");

  if (!isOpen) return null;

  // Initial mode based on status
  const isReadyToPay = referral.status === "converted";
  
  const handleConvert = async () => {
    setLoading(true);
    setError(null);
    try {
      await convertReferralFn({ referralId: referral.id, note });
      onUpdate();
      onClose();
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error)?.message || "Failed to convert referral.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-slate-900">
            {isReadyToPay ? "Referral Converted" : "Update Referral"}
          </h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 text-slate-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">
            {error}
          </div>
        )}

        {/* Content based on state */}
        {!isReadyToPay ? (
          // CONVERSION FLOW
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Confirm that this legacy business introduction converted. Compensation is optional and is handled separately.
            </p>
            
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Note (Optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                placeholder="Details about the deal..."
                rows={3}
              />
            </div>

            <div className="pt-2">
              <button
                onClick={handleConvert}
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Mark as Converted
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No payout is assumed. If this legacy record has compensation terms, settlement must be verified by authorized staff outside this member workflow.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
