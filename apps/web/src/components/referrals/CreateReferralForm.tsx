"use client";

import { useState } from "react";
import { createReferralFn } from "@/lib/functions";
import { Loader2, Send, Briefcase, Mail, AlertTriangle } from "lucide-react";

interface CreateReferralFormProps {
  uid: string;
  currentUsage: number;
  onCreated: () => void;
  onCancel: () => void;
}

export function CreateReferralForm({
  uid,
  currentUsage,
  onCreated,
  onCancel,
}: CreateReferralFormProps) {
  const [type, setType] = useState<"platform_invite" | "business_intro">("platform_invite");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fields
  const [referredEmail, setReferredEmail] = useState("");
  const [referredName, setReferredName] = useState("");
  
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  
  const [note, setNote] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (type === "platform_invite") {
        if (!referredEmail) throw new Error("Email is required");
        await createReferralFn({
          type: "platform_invite",
          referredEmail,
          referredName,
          note,
        });
      } else {
        if (!clientName || !clientEmail) throw new Error("Client name and email are required");
        await createReferralFn({
          type: "business_intro",
          providerUid: uid, 
          clientName,
          clientEmail,
          clientCompany,
          clientPhone,
          note,
        });
      }
      onCreated();
    } catch (err: unknown) {
      console.error("Error creating referral:", err);
      const msg = err instanceof Error ? err.message : "Failed to create referral";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-8 p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-slate-900">New Referral</h3>
        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
          Monthly Usage: {currentUsage}
        </span>
      </div>
      
      <div className="flex gap-4 mb-6">
        <button
          type="button"
          onClick={() => setType("platform_invite")}
          className={`flex-1 p-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 ${
            type === "platform_invite"
              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Mail className="h-4 w-4" />
          Invite to Platform
        </button>
        <button
          type="button"
          onClick={() => setType("business_intro")}
          className={`flex-1 p-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 ${
            type === "business_intro"
              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Briefcase className="h-4 w-4" />
          Business Intro
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {type === "platform_invite" ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={referredEmail}
                  onChange={(e) => setReferredEmail(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                  placeholder="friend@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <input
                  type="text"
                  value={referredName}
                  onChange={(e) => setReferredName(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                  placeholder="Jane Doe"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded-lg mb-2">
              Note: To refer a client to a specific member, please go to the member&apos;s directory profile and click &quot;Refer&quot;. This form creates a general lead.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Client Name *</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Client Email *</label>
                <input
                  type="email"
                  required
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Company</label>
                <input
                  type="text"
                  value={clientCompany}
                  onChange={(e) => setClientCompany(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Note (Optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 outline-none resize-none"
            placeholder="Add a personal note..."
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Referral
          </button>
        </div>
      </form>
    </div>
  );
}
