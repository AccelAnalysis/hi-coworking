"use client";

import { useState } from "react";
import { Loader2, X, Check, DollarSign, Upload, CreditCard } from "lucide-react";
import type { ReferralDoc } from "@hi/shared";
import { convertReferralFn, markReferralPaidFn, createPayoutCheckoutFn } from "@/lib/functions";

interface ReferralActionModalProps {
  referral: ReferralDoc;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function ReferralActionModal({ referral, isOpen, onClose, onUpdate }: ReferralActionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // States
  const [payoutMethod, setPayoutMethod] = useState<"platform" | "manual">("platform");
  
  // Form Data
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");

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

  const handleManualPayout = async () => {
    setLoading(true);
    setError(null);
    try {
      await markReferralPaidFn({ 
        referralId: referral.id, 
        proofUrl, 
        method: "manual" 
      });
      onUpdate();
      onClose();
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error)?.message || "Failed to mark as paid.");
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformPayout = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await createPayoutCheckoutFn({
        referralId: referral.id,
        successUrl: `${window.location.origin}/referrals?success=true`,
        cancelUrl: `${window.location.origin}/referrals?canceled=true`,
      });
      
      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error)?.message || "Failed to initiate payment.");
      setLoading(false);
    }
  };

  const feeAmount = referral.policySnapshot?.amountCents 
    ? `$${(referral.policySnapshot.amountCents / 100).toFixed(2)}`
    : "Calculate Fee"; // Fallback if percentage

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-slate-900">
            {isReadyToPay ? "Process Payout" : "Update Referral"}
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
              Confirm that this referral has successfully converted into a deal. This will trigger the commission due status.
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
          // PAYOUT FLOW
          <div className="space-y-6">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Commission Due</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{feeAmount}</div>
              <div className="text-xs text-slate-400 mt-1">
                {referral.policySnapshot?.template === "percentage_first_invoice" 
                  ? `${referral.policySnapshot.percentage}% of invoice`
                  : "Fixed fee"}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPayoutMethod("platform")}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  payoutMethod === "platform"
                    ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-1 text-slate-900 font-bold text-sm">
                  <CreditCard className="h-4 w-4" />
                  Platform Pay
                </div>
                <div className="text-[10px] text-slate-500">
                  Pay via card/ACH. Auto-verified. +5% fee.
                </div>
              </button>

              <button
                onClick={() => setPayoutMethod("manual")}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  payoutMethod === "manual"
                    ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-1 text-slate-900 font-bold text-sm">
                  <Upload className="h-4 w-4" />
                  Manual
                </div>
                <div className="text-[10px] text-slate-500">
                  Pay outside (Zelle/Check). Requires proof. Cost: 1 Credit.
                </div>
              </button>
            </div>

            {payoutMethod === "manual" && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Proof Reference / URL *</label>
                <input
                  type="text"
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                  placeholder="Transaction ID or Receipt URL..."
                />
                <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  Processing manual verification costs 1 credit.
                </p>
              </div>
            )}

            <button
              onClick={payoutMethod === "platform" ? handlePlatformPayout : handleManualPayout}
              disabled={loading || (payoutMethod === "manual" && !proofUrl)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
              {payoutMethod === "platform" ? "Pay Now" : "Submit Verification"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
