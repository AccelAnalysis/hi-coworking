"use client";

import { CreditCard, FileText } from "lucide-react";
import type { PaymentProvider } from "@hi/shared";

interface PaymentMethodSelectorProps {
  /** Currently selected provider */
  value: PaymentProvider | null;
  /** Callback when user selects a provider */
  onChange: (provider: PaymentProvider) => void;
  /** Whether QuickBooks options are available (admin-configured) */
  quickbooksEnabled?: boolean;
  /** Disable interaction (e.g. during checkout) */
  disabled?: boolean;
}

interface ProviderOption {
  id: PaymentProvider;
  label: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: "stripe",
    label: "Pay with Card",
    description: "Credit or debit card via Stripe",
    icon: CreditCard,
    iconColor: "text-indigo-600",
    bgColor: "bg-indigo-50",
  },
  {
    id: "quickbooks_link",
    label: "Pay with QuickBooks",
    description: "QuickBooks payment link or invoice",
    icon: FileText,
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-50",
  },
];

export function PaymentMethodSelector({
  value,
  onChange,
  quickbooksEnabled = true,
  disabled = false,
}: PaymentMethodSelectorProps) {
  const options = quickbooksEnabled
    ? PROVIDER_OPTIONS
    : PROVIDER_OPTIONS.filter((o) => o.id === "stripe");

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">Pay with:</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = value === option.id;
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              disabled={disabled}
              className={`relative flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? "border-slate-900 bg-slate-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div
                className={`p-2 rounded-lg ${
                  isSelected ? option.bgColor : "bg-slate-100"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    isSelected ? option.iconColor : "text-slate-400"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900">
                  {option.label}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {option.description}
                </p>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-slate-900" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
