"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getReferralsSent,
  getReferralsReceived,
  getProviderReferrals,
  updateReferralStatus,
  getReferralLeaderboard,
  getTeamInvitesReceived,
  updateTeamInviteStatus,
} from "@/lib/firestore";
import { acceptReferralFn, declineReferralFn } from "@/lib/functions";
import type { ReferralDoc, ReferralStatus, RfxTeamInviteDoc } from "@hi/shared";
import { ReferralPolicyEditor } from "@/components/referrals/ReferralPolicyEditor";
import { ReferralActionModal } from "@/components/referrals/ReferralActionModal";
import { CreateReferralForm } from "@/components/referrals/CreateReferralForm";
import {
  Users,
  Loader2,
  Plus,
  Send,
  Inbox,
  Trophy,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRight,
  Handshake,
  Check,
  X,
  Settings,
  AlertCircle,
  DollarSign,
  Briefcase,
} from "lucide-react";

const STATUS_CONFIG: Record<ReferralStatus, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  contacted: { label: "Contacted", color: "bg-blue-50 text-blue-700 border-blue-200", icon: ArrowRight },
  accepted: { label: "Accepted", color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: Check },
  declined: { label: "Declined", color: "bg-red-50 text-red-700 border-red-200", icon: X },
  converted: { label: "Converted", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  expired: { label: "Expired", color: "bg-slate-100 text-slate-500 border-slate-200", icon: XCircle },
  disputed: { label: "Disputed", color: "bg-orange-50 text-orange-700 border-orange-200", icon: AlertCircle },
  paid: { label: "Paid", color: "bg-green-100 text-green-800 border-green-300", icon: DollarSign },
};

export default function ReferralsPage() {
  return (
    <RequireAuth>
      <ReferralsContent />
    </RequireAuth>
  );
}

function ReferralsContent() {
  const { user, userDoc } = useAuth();
  const [tab, setTab] = useState<"sent" | "received" | "team" | "leaderboard" | "settings">("sent");
  const [sent, setSent] = useState<ReferralDoc[]>([]);
  const [received, setReceived] = useState<ReferralDoc[]>([]);
  const [teamInvites, setTeamInvites] = useState<RfxTeamInviteDoc[]>([]);
  const [leaderboard, setLeaderboard] = useState<{ uid: string; count: number; displayName?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Action Modal State
  const [selectedReferral, setSelectedReferral] = useState<ReferralDoc | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [s, rInvites, rProvider, t, l] = await Promise.all([
        getReferralsSent(user.uid),
        getReferralsReceived(userDoc?.email || user.email || ""),
        getProviderReferrals(user.uid),
        getTeamInvitesReceived(user.uid),
        getReferralLeaderboard(),
      ]);

      setSent(s);

      // Merge invites (by email) and business intros (by providerUid)
      // Deduplicate by ID just in case
      const mergedReceived = [...rInvites, ...rProvider].reduce((acc, curr) => {
        if (!acc.find(r => r.id === curr.id)) acc.push(curr);
        return acc;
      }, [] as ReferralDoc[]);

      setReceived(mergedReceived.sort((a, b) => b.createdAt - a.createdAt));

      setTeamInvites(t);
      setLeaderboard(l);
    } catch (err) {
      console.error("Failed to fetch referral data:", err);
    } finally {
      setLoading(false);
    }
  }, [user, userDoc]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenAction = (referral: ReferralDoc) => {
    setSelectedReferral(referral);
    setIsActionModalOpen(true);
  };

  const convertedCount = sent.filter((r) => r.status === "converted" || r.status === "paid").length;

  // Calculate referrals sent this month for monetization check
  const sentThisMonthCount = sent.filter(r => {
    const d = new Date(r.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Users className="h-8 w-8 text-slate-400" />
              Referrals &amp; Teaming
            </h1>
            <p className="text-slate-500 mt-1">
              Refer colleagues and build teams for RFx opportunities.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {convertedCount > 0 && (
              <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                <Trophy className="h-3.5 w-3.5" />
                {convertedCount} converted
              </span>
            )}
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              New Referral
            </button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <CreateReferralForm
            uid={user?.uid || ""}
            currentUsage={sentThisMonthCount}
            onCreated={() => { setShowCreate(false); fetchData(); }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Action Modal */}
        {selectedReferral && (
          <ReferralActionModal
            referral={selectedReferral}
            isOpen={isActionModalOpen}
            onClose={() => { setIsActionModalOpen(false); setSelectedReferral(null); }}
            onUpdate={fetchData}
          />
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: "sent", label: "Sent", icon: Send, count: sent.length },
            { key: "received", label: "Received", icon: Inbox, count: received.length },
            { key: "team", label: "Team Invites", icon: Handshake, count: teamInvites.filter((t) => t.status === "pending").length },
            { key: "leaderboard", label: "Leaderboard", icon: Trophy },
            { key: "settings", label: "Settings", icon: Settings },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                tab === t.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {"count" in t && t.count !== undefined && t.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading && tab !== "settings" ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {tab === "sent" && (
              <ReferralList 
                referrals={sent} 
                type="sent" 
                onUpdate={fetchData} 
                onAction={handleOpenAction}
              />
            )}
            {tab === "received" && (
              <ReferralList 
                referrals={received} 
                type="received" 
                onUpdate={fetchData} 
                onAction={handleOpenAction}
              />
            )}
            {tab === "team" && <TeamInvitesList invites={teamInvites} onUpdate={fetchData} />}
            {tab === "leaderboard" && <Leaderboard entries={leaderboard} />}
            {tab === "settings" && <ReferralPolicyEditor />}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ... CreateReferralForm ...

// --- Referral List ---

function ReferralList({
  referrals,
  type,
  onUpdate,
  onAction,
}: {
  referrals: ReferralDoc[];
  type: "sent" | "received";
  onUpdate: () => void;
  onAction: (referral: ReferralDoc) => void;
}) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleAccept = async (referral: ReferralDoc) => {
    setProcessingId(referral.id);
    try {
      await acceptReferralFn({ referralId: referral.id });
      onUpdate();
    } catch (err) {
      console.error("Failed to accept:", err);
      alert("Failed to accept referral. You may have reached your monthly limit.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (referral: ReferralDoc) => {
    if (!confirm("Are you sure you want to decline this referral?")) return;
    setProcessingId(referral.id);
    try {
      await declineReferralFn({ referralId: referral.id });
      onUpdate();
    } catch (err) {
      console.error("Failed to decline:", err);
    } finally {
      setProcessingId(null);
    }
  };

  if (referrals.length === 0) {
    return (
      <div className="text-center py-16">
        <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">
          {type === "sent" ? "No referrals sent yet." : "No referrals received."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {referrals.map((ref) => {
        const cfg = STATUS_CONFIG[ref.status];
        const StatusIcon = cfg.icon;
        const isProcessing = processingId === ref.id;

        // Differentiate invite vs business intro
        const isBusinessIntro = ref.type === "business_intro" || !!ref.clientName;
        const title = isBusinessIntro 
          ? (type === "sent" ? ref.clientName || "Client Lead" : ref.clientName || "New Lead")
          : (ref.referredName || ref.referredEmail);
        
        const subtitle = isBusinessIntro
          ? (type === "sent" ? `Sent to provider` : `From member`) 
          : ref.referredEmail;

        return (
          <div key={ref.id} className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {isBusinessIntro && <Briefcase className="h-3.5 w-3.5 text-slate-400" />}
                  <span className="text-sm font-bold text-slate-900">{title}</span>
                </div>
                <span className="text-xs text-slate-400 block mt-0.5">{subtitle}</span>
                {ref.note && (
                  <p className="text-xs text-slate-500 mt-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100 max-w-md">
                    &ldquo;{ref.note}&rdquo;
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] text-slate-400">
                    {new Date(ref.createdAt).toLocaleDateString()}
                  </span>
                  {ref.policySnapshot?.amountCents && (
                    <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                      ${(ref.policySnapshot.amountCents / 100).toFixed(0)} Fee
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border inline-flex items-center gap-1 ${cfg.color}`}>
                  <StatusIcon className="h-3 w-3" />
                  {cfg.label}
                </span>

                {/* Actions for Received Referrals (Provider Flow) */}
                {type === "received" && (
                  <div className="flex items-center gap-2">
                    {ref.status === "pending" && (
                      <>
                        <button
                          onClick={() => handleAccept(ref)}
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                        >
                          {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Accept"}
                        </button>
                        <button
                          onClick={() => handleDecline(ref)}
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </>
                    )}

                    {(ref.status === "accepted" || ref.status === "converted") && (
                      <button
                        onClick={() => onAction(ref)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-medium hover:bg-indigo-100 flex items-center gap-1"
                      >
                        <Settings className="h-3 w-3" />
                        Manage
                      </button>
                    )}
                  </div>
                )}

                {/* Actions for Sent Referrals (Referrer Flow) */}
                {type === "sent" && ref.status === "pending" && (
                  <button
                    onClick={async () => { await updateReferralStatus(ref.id, "contacted"); onUpdate(); }}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Mark Contacted
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Team Invites ---

function TeamInvitesList({
  invites,
  onUpdate,
}: {
  invites: RfxTeamInviteDoc[];
  onUpdate: () => void;
}) {
  if (invites.length === 0) {
    return (
      <div className="text-center py-16">
        <Handshake className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No team invitations received.</p>
      </div>
    );
  }

  const handleRespond = async (inviteId: string, status: "accepted" | "declined") => {
    try {
      await updateTeamInviteStatus(inviteId, status);
      onUpdate();
    } catch (err) {
      console.error("Failed to update invite:", err);
    }
  };

  return (
    <div className="space-y-3">
      {invites.map((invite) => (
        <div key={invite.id} className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-slate-900">
                Team invite for RFx
              </span>
              {invite.role && (
                <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200">
                  {invite.role}
                </span>
              )}
              {invite.note && (
                <p className="text-xs text-slate-500 mt-0.5">{invite.note}</p>
              )}
              <span className="text-[10px] text-slate-400 block mt-1">
                {new Date(invite.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {invite.status === "pending" ? (
                <>
                  <button
                    onClick={() => handleRespond(invite.id, "accepted")}
                    className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleRespond(invite.id, "declined")}
                    className="p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 border border-red-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  invite.status === "accepted"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-red-50 text-red-600 border-red-200"
                }`}>
                  {invite.status}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Leaderboard ---

function Leaderboard({ entries }: { entries: { uid: string; count: number; displayName?: string }[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-16">
        <Trophy className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No converted referrals yet. Be the first!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-2">
        <Trophy className="h-3.5 w-3.5" />
        Top Referrers
      </div>
      <div className="divide-y divide-slate-100">
        {entries.map((entry, idx) => (
          <div key={entry.uid} className="flex items-center gap-4 px-5 py-3">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              idx === 0 ? "bg-amber-100 text-amber-700" :
              idx === 1 ? "bg-slate-200 text-slate-600" :
              idx === 2 ? "bg-orange-100 text-orange-700" :
              "bg-slate-100 text-slate-500"
            }`}>
              {idx + 1}
            </span>
            <span className="text-sm font-medium text-slate-700 flex-1 truncate">
              {entry.displayName || `Member ${entry.uid.slice(0, 8)}`}
            </span>
            <span className="text-sm font-bold text-slate-900">
              {entry.count} referral{entry.count !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
