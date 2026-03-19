"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/authContext";
import { getReferralPolicy, saveReferralPolicy } from "@/lib/firestore";
import type { ReferralPolicyDoc, ReferralPolicyTemplate } from "@hi/shared";
import { Loader2, Save, CheckCircle2, AlertCircle } from "lucide-react";

const TEMPLATES: { value: ReferralPolicyTemplate; label: string; description: string }[] = [
  {
    value: "flat_fee",
    label: "Flat Fee",
    description: "Pay a fixed amount for every successful referral.",
  },
  {
    value: "percentage_first_invoice",
    label: "% of First Invoice",
    description: "Pay a percentage of the first paid invoice value.",
  },
  {
    value: "recurring",
    label: "Recurring Commission",
    description: "Pay a percentage for a set period (e.g. 3 months).",
  },
  {
    value: "tiered",
    label: "Tiered / Milestone",
    description: "Pay different amounts at different stages (e.g. meeting vs closed).",
  },
];

export function ReferralPolicyEditor() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<Partial<ReferralPolicyDoc>>({
    acceptingReferrals: false,
    template: "flat_fee",
    terms: "",
    attributionWindowDays: 90,
    payoutTrigger: "Net 10 after payment",
  });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const existing = await getReferralPolicy(user.uid);
        if (existing) {
          setPolicy(existing);
        } else {
          // Defaults
          setPolicy({
            uid: user.uid,
            acceptingReferrals: false,
            template: "flat_fee",
            terms: "Referral fee of $100 for any closed deal.",
            attributionWindowDays: 90,
            payoutTrigger: "Net 10 days after receipt of payment",
          });
        }
      } catch (err) {
        console.error("Failed to load policy:", err);
        setError("Failed to load settings.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const doc: ReferralPolicyDoc = {
        id: user.uid, // Policy ID matches UID for 1:1 relationship
        uid: user.uid,
        acceptingReferrals: policy.acceptingReferrals ?? false,
        template: policy.template ?? "flat_fee",
        terms: policy.terms ?? "",
        attributionWindowDays: policy.attributionWindowDays ?? 90,
        payoutTrigger: policy.payoutTrigger ?? "Net 10 after payment",
        customTerms: policy.customTerms,
        createdAt: policy.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };

      await saveReferralPolicy(doc);
      setPolicy(doc);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save policy:", err);
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6 sm:p-8">
      <h2 className="text-xl font-bold text-slate-900 mb-6">Referral Settings</h2>
      
      <form onSubmit={handleSave} className="space-y-8">
        {/* Availability Toggle */}
        <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-50 border border-slate-100">
          <div className="flex-1">
            <label htmlFor="accepting" className="font-semibold text-slate-900 block mb-1">
              Accepting Referrals
            </label>
            <p className="text-sm text-slate-500">
              When enabled, your profile will show that you accept business introductions, and you&apos;ll appear in the referral directory.
            </p>
          </div>
          <div className="relative inline-flex items-center cursor-pointer">
            <input
              id="accepting"
              type="checkbox"
              className="sr-only peer"
              checked={policy.acceptingReferrals}
              onChange={(e) => setPolicy({ ...policy, acceptingReferrals: e.target.checked })}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
          </div>
        </div>

        {/* Policy Configuration */}
        <div className={`space-y-6 transition-opacity ${policy.acceptingReferrals ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Commission Model</label>
            <div className="grid sm:grid-cols-2 gap-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPolicy({ ...policy, template: t.value })}
                  className={`text-left p-3 rounded-lg border-2 transition-all ${
                    policy.template === t.value
                      ? "border-indigo-600 bg-indigo-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className={`font-semibold text-sm ${policy.template === t.value ? "text-indigo-700" : "text-slate-700"}`}>
                    {t.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Terms & Amounts *
            </label>
            <textarea
              required={policy.acceptingReferrals}
              value={policy.terms}
              onChange={(e) => setPolicy({ ...policy, terms: e.target.value })}
              rows={3}
              className="w-full rounded-lg px-3 py-2 border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
              placeholder={
                policy.template === "flat_fee" ? "e.g. $250 per closed deal" :
                policy.template === "percentage_first_invoice" ? "e.g. 10% of the first invoice, paid net 15" :
                "Describe your commission structure..."
              }
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Attribution Window (Days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={policy.attributionWindowDays}
                onChange={(e) => setPolicy({ ...policy, attributionWindowDays: parseInt(e.target.value) || 90 })}
                className="w-full rounded-lg px-3 py-2 border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
              />
              <p className="text-xs text-slate-400 mt-1">How long a referral is valid for.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Payout Trigger
              </label>
              <input
                type="text"
                value={policy.payoutTrigger}
                onChange={(e) => setPolicy({ ...policy, payoutTrigger: e.target.value })}
                className="w-full rounded-lg px-3 py-2 border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                placeholder="e.g. Net 15 after client pays"
              />
            </div>
          </div>
        </div>

        {/* Feedback & Actions */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
        
        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 p-3 rounded-lg">
            <CheckCircle2 className="h-4 w-4" />
            Settings saved successfully.
          </div>
        )}

        <div className="pt-4 border-t border-slate-100 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
}
