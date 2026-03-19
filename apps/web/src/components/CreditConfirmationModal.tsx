"use client";

import { Coins } from "lucide-react";

interface CreditConfirmationModalProps {
  isOpen: boolean;
  cost: number;
  balance: number;
  actionDescription?: string; // e.g. "Publishing this RFx"
  onConfirm: () => void;
  onCancel: () => void;
}

export function CreditConfirmationModal({
  isOpen,
  cost,
  balance,
  actionDescription = "This action",
  onConfirm,
  onCancel,
}: CreditConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-4 text-amber-600">
          <div className="p-2 bg-amber-100 rounded-full">
            <Coins className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Confirm Credit Usage</h3>
        </div>

        <p className="text-slate-600 mb-6">
          You have reached your included limit. {actionDescription} will use{" "}
          <strong>{cost} credits</strong> from your balance.
        </p>

        <div className="bg-slate-50 rounded-xl p-4 mb-6 flex items-center justify-between">
          <span className="text-sm text-slate-500">Your Balance</span>
          <span className="text-sm font-bold text-slate-900">{balance} Credits</span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 shadow-sm shadow-amber-200"
          >
            Confirm & Pay
          </button>
        </div>
      </div>
    </div>
  );
}
