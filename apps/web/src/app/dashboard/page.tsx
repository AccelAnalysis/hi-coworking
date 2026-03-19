"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  CreditCard,
  Calendar,
  ChevronRight,
  Loader2,
  Shield,
  User,
  Users,
  ClipboardList,
  Plus,
  Sparkles,
  Target,
  Send,
  Inbox,
  Briefcase,
  Rocket,
  Lightbulb,
  Wrench,
  Laptop,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/authContext";
import {
  getUserBookingsFromFirestore,
  getProfileFromFirestore,
  computeProfileCompleteness,
  isProcurementReady,
  getUserRfxListFromFirestore,
  countPublishedProfilesByNaics,
  getRecommendedRfx,
  getSuggestedConnections,
  getUserActiveBidCount,
  getReceivedResponseCount,
  getUserDoc,
  updateUserMembershipTrack,
} from "@/lib/firestore";
import type { Booking, RfxDoc, ProfileDoc, MembershipTrack } from "@hi/shared";

// --- Membership Track Metadata (PR-08) ---

interface TrackMeta {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  callout: string;
}

const TRACK_META: Record<MembershipTrack, TrackMeta> = {
  remote_worker: {
    label: "Remote Worker",
    description: "Flexible workspace access for distributed teams",
    icon: Laptop,
    color: "text-sky-700",
    bgColor: "bg-sky-100",
    callout: "Book a desk or meeting room to stay productive today.",
  },
  capital_ready_founder: {
    label: "Capital-Ready Founder",
    description: "Building toward investment and growth",
    icon: Rocket,
    color: "text-violet-700",
    bgColor: "bg-violet-100",
    callout: "Check AccelProcure for contract opportunities to grow your pipeline.",
  },
  consultant: {
    label: "Consultant",
    description: "Advisory and professional services",
    icon: Lightbulb,
    color: "text-amber-700",
    bgColor: "bg-amber-100",
    callout: "Browse the directory for teaming partners on upcoming bids.",
  },
  service_provider: {
    label: "Service Provider",
    description: "Delivering specialized goods and services",
    icon: Wrench,
    color: "text-emerald-700",
    bgColor: "bg-emerald-100",
    callout: "New RFx opportunities may match your NAICS codes — check Recommended Opportunities below.",
  },
};

const ALL_TRACKS: MembershipTrack[] = [
  "remote_worker",
  "capital_ready_founder",
  "consultant",
  "service_provider",
];

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const { user, userDoc } = useAuth();

  // Existing state
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(true);
  const [profileScore, setProfileScore] = useState<number | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [myRfxList, setMyRfxList] = useState<RfxDoc[]>([]);
  const [rfxLoading, setRfxLoading] = useState(true);
  const [naicsMatchCount, setNaicsMatchCount] = useState<number | null>(null);

  // PR-08 state
  const [recommendedRfx, setRecommendedRfx] = useState<RfxDoc[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(true);
  const [suggestedConnections, setSuggestedConnections] = useState<ProfileDoc[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [activeBids, setActiveBids] = useState<number>(0);
  const [receivedResponses, setReceivedResponses] = useState<number>(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [membershipTrack, setMembershipTrack] = useState<MembershipTrack | null>(null);
  const [trackSaving, setTrackSaving] = useState(false);

  // Fetch bookings
  useEffect(() => {
    async function fetchBookings() {
      if (!user) return;
      try {
        const data = await getUserBookingsFromFirestore(user.uid);
        setBookings(data);
      } catch (error) {
        console.error("Failed to fetch bookings:", error);
      } finally {
        setIsLoadingBookings(false);
      }
    }

    if (user) {
      fetchBookings();
    }
  }, [user]);

  // Fetch profile + NAICS-dependent data (PR-05/07/08)
  useEffect(() => {
    async function fetchProfileData() {
      if (!user) return;
      try {
        const profile = await getProfileFromFirestore(user.uid);
        setProfileScore(computeProfileCompleteness(profile));
        const codes = profile?.naicsCodes ?? [];

        // Parallel fetches that depend on NAICS codes
        const [naicsCount, recommended, connections] = await Promise.all([
          codes.length > 0 ? countPublishedProfilesByNaics(codes) : Promise.resolve(0),
          getRecommendedRfx(codes, 5),
          codes.length > 0
            ? getSuggestedConnections(codes, user.uid, 5)
            : Promise.resolve([]),
        ]);

        setNaicsMatchCount(naicsCount);
        setRecommendedRfx(recommended);
        setSuggestedConnections(connections);
      } catch (error) {
        console.error("Failed to fetch profile data:", error);
      } finally {
        setProfileLoading(false);
        setRecommendedLoading(false);
        setConnectionsLoading(false);
      }
    }

    if (user) {
      fetchProfileData();
    }
  }, [user]);

  // Fetch RFx data + quick stats (PR-06/08)
  useEffect(() => {
    async function fetchRfxStats() {
      if (!user) return;
      try {
        const [mine, bids, received] = await Promise.all([
          getUserRfxListFromFirestore(user.uid, 5),
          getUserActiveBidCount(user.uid),
          getReceivedResponseCount(user.uid),
        ]);
        setMyRfxList(mine);
        setActiveBids(bids);
        setReceivedResponses(received);
      } catch (error) {
        console.error("Failed to fetch RFx stats:", error);
      } finally {
        setRfxLoading(false);
        setStatsLoading(false);
      }
    }

    if (user) {
      fetchRfxStats();
    }
  }, [user]);

  // Fetch membership track (PR-08)
  useEffect(() => {
    async function fetchTrack() {
      if (!user) return;
      try {
        const userDoc = await getUserDoc(user.uid);
        if (userDoc?.membershipTrack) {
          setMembershipTrack(userDoc.membershipTrack);
        }
      } catch (error) {
        console.error("Failed to fetch user doc:", error);
      }
    }

    if (user) {
      fetchTrack();
    }
  }, [user]);

  const handleTrackSelect = useCallback(
    async (track: MembershipTrack) => {
      if (!user || trackSaving) return;
      setTrackSaving(true);
      try {
        await updateUserMembershipTrack(user.uid, track);
        setMembershipTrack(track);
      } catch (error) {
        console.error("Failed to save membership track:", error);
      } finally {
        setTrackSaving(false);
      }
    },
    [user, trackSaving]
  );

  if (!user) return null;

  const membershipStatus = userDoc?.membershipStatus ?? "none";
  const memberPlan = userDoc?.plan ?? null;
  const memberExpiresAt = userDoc?.expiresAt ? new Date(userDoc.expiresAt) : null;

  const upcomingBookings = bookings.filter(
    (b) => b.status === "CONFIRMED" && b.start > Date.now()
  );

  const trackMeta = membershipTrack ? TRACK_META[membershipTrack] : null;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        {/* ─── Welcome Header ─── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              Welcome back, {user.displayName || user.email?.split("@")[0] || "Member"}
            </h1>
            <p className="text-slate-500 mt-1">
              Your workspace and community at a glance.
            </p>
          </div>
          {membershipStatus === "active" ? (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200 hidden sm:inline-flex">
              Active Member
            </span>
          ) : membershipStatus === "trial" ? (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200 hidden sm:inline-flex">
              Trial
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 hidden sm:inline-flex">
              Non-Member
            </span>
          )}
        </div>

        {/* Track Callout */}
        {trackMeta && (
          <div className={`mb-8 p-4 rounded-xl ${trackMeta.bgColor} ring-1 ring-black/5 flex items-center gap-3`}>
            <trackMeta.icon className={`h-5 w-5 ${trackMeta.color} shrink-0`} />
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-bold uppercase tracking-wide ${trackMeta.color}`}>{trackMeta.label}</span>
              <p className="text-sm text-slate-700 mt-0.5">{trackMeta.callout}</p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            SECTION 1: YOUR WORKSPACE — Physical Credibility Layer
            The space is real. Bookings, desks, meeting rooms, credits.
            ═══════════════════════════════════════════════════ */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" /> Your Workspace
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Membership Card */}
            <div className="p-5 rounded-xl bg-slate-900 text-white shadow-lg relative overflow-hidden ring-1 ring-white/10">
              <div className="absolute top-0 right-0 p-3 opacity-15">
                <CreditCard className="w-14 h-14" />
              </div>
              <h3 className="text-slate-400 font-medium text-[10px] uppercase tracking-widest mb-1">Membership</h3>
              {membershipStatus === "active" || membershipStatus === "trial" ? (
                <>
                  <div className="text-xl font-bold capitalize">{memberPlan || membershipStatus}</div>
                  {memberExpiresAt && (
                    <p className="text-[10px] text-slate-500 mt-3">
                      Renews {memberExpiresAt.toLocaleDateString()}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-lg font-bold">No active plan</div>
                  <Link href="/pricing" className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
                    View membership options →
                  </Link>
                </>
              )}
            </div>

            {/* Next Booking */}
            <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Next Booking</h3>
              {isLoadingBookings ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-300 mt-2" />
              ) : upcomingBookings.length > 0 ? (
                <>
                  <div className="text-lg font-bold text-slate-900">{upcomingBookings[0].resourceName}</div>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" />
                    {new Date(upcomingBookings[0].start).toLocaleDateString()} at{" "}
                    {new Date(upcomingBookings[0].start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </p>
                  {upcomingBookings.length > 1 && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      +{upcomingBookings.length - 1} more upcoming
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-2">
                  <p className="text-sm text-slate-500">No upcoming bookings</p>
                  <Link href="/book" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium mt-1 inline-flex items-center gap-0.5">
                    Book a space <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            {/* Quick Book */}
            <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Quick Book</h3>
              <div className="space-y-2">
                <Link href="/book" className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 transition-colors group">
                  <div className="p-1.5 rounded-md bg-sky-50 text-sky-600"><Laptop className="h-3.5 w-3.5" /></div>
                  <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600">Hot Desk</span>
                </Link>
                <Link href="/book" className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 transition-colors group">
                  <div className="p-1.5 rounded-md bg-violet-50 text-violet-600"><Users className="h-3.5 w-3.5" /></div>
                  <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600">Meeting Room</span>
                </Link>
                <Link href="/book" className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 transition-colors group">
                  <div className="p-1.5 rounded-md bg-amber-50 text-amber-600"><Sparkles className="h-3.5 w-3.5" /></div>
                  <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600">Podcast Studio</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Recent Bookings (compact) */}
          {bookings.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Recent Bookings</span>
                <Link href="/book" className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5">
                  View all <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {bookings.slice(0, 3).map((b) => (
                  <div key={b.id} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-900 truncate block">{b.resourceName}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(b.start).toLocaleDateString()} · {new Date(b.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                      b.status === "CONFIRMED" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"
                    }`}>{b.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════
            SECTION 2: YOUR NETWORK — Digital Scale Layer
            Profile, directory, referrals — the community engine.
            ═══════════════════════════════════════════════════ */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" /> Your Network
          </h2>

          {/* Profile Completeness */}
          {!profileLoading && profileScore !== null && profileScore < 100 && (
            <Link
              href="/profile"
              className="block mb-4 p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${isProcurementReady(profileScore) ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {isProcurementReady(profileScore) ? <Shield className="h-5 w-5" /> : <User className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-bold text-slate-900">
                      {isProcurementReady(profileScore) ? "Procurement-Ready!" : "Complete Your Business Profile"}
                    </h3>
                    <span className="text-xs font-bold text-slate-500">{profileScore}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isProcurementReady(profileScore) ? "bg-emerald-500" : "bg-slate-400"}`}
                      style={{ width: `${profileScore}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1 group-hover:text-indigo-500 transition-colors">
                    {isProcurementReady(profileScore) ? "Add more details to strengthen your profile →" : "Reach 70% to earn Procurement-Ready status →"}
                  </p>
                </div>
              </div>
            </Link>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-[10px] font-medium text-slate-500 uppercase">Profile</span>
              </div>
              {profileLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : (
                <div className="text-xl font-bold text-slate-900">{profileScore ?? 0}%</div>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <Send className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-[10px] font-medium text-slate-500 uppercase">Active Bids</span>
              </div>
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : (
                <div className="text-xl font-bold text-slate-900">{activeBids}</div>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <Inbox className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-[10px] font-medium text-slate-500 uppercase">Bids Received</span>
              </div>
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : (
                <div className="text-xl font-bold text-slate-900">{receivedResponses}</div>
              )}
            </div>
            <Link href="/directory" className="p-3 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:ring-indigo-200 transition-colors group">
              <div className="flex items-center gap-1.5 mb-1">
                <Users className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-[10px] font-medium text-slate-500 uppercase">NAICS Matches</span>
              </div>
              <div className="text-xl font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{naicsMatchCount ?? 0}</div>
            </Link>
          </div>

          {/* Network Effect Banner */}
          {naicsMatchCount !== null && naicsMatchCount > 0 && (
            <Link
              href="/directory"
              className="block mb-4 p-4 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 hover:bg-indigo-100/70 transition-all group"
            >
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-indigo-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-indigo-900">
                    {naicsMatchCount} member{naicsMatchCount !== 1 ? "s" : ""} share your NAICS codes
                  </p>
                  <p className="text-xs text-indigo-600 mt-0.5">Discover partners and teaming opportunities in the directory →</p>
                </div>
              </div>
            </Link>
          )}

          {/* Suggested Connections */}
          {!connectionsLoading && suggestedConnections.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-slate-400" /> Members in Related Industries
                </h3>
                <Link href="/directory" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5">
                  View all <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {suggestedConnections.map((profile) => (
                  <Link
                    key={profile.uid}
                    href={`/directory/profile?uid=${profile.uid}`}
                    className="group flex items-center gap-3 p-3 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all"
                  >
                    <div className="relative h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden ring-2 ring-slate-200 shrink-0">
                      {profile.photoUrl ? (
                        <Image src={profile.photoUrl} alt={profile.businessName || "Member"} fill className="object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-slate-400">{profile.businessName?.[0]?.toUpperCase() || "?"}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
                        {profile.businessName || "Unnamed Business"}
                      </h4>
                      {profile.naicsCodes && profile.naicsCodes.length > 0 && (
                        <p className="text-[10px] text-slate-400">{profile.naicsCodes.length} shared NAICS</p>
                      )}
                    </div>
                    {isProcurementReady(profile.profileCompletenessScore ?? 0) && (
                      <Shield className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════
            SECTION 3: OPPORTUNITIES — Procurement & Growth
            RFx, bids, recommended contracts.
            ═══════════════════════════════════════════════════ */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5" /> Opportunities
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recommended Opportunities */}
            <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" /> Recommended for You
                </h3>
                <Link href="/rfx" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5">
                  Browse all <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
              {recommendedLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : recommendedRfx.length === 0 ? (
                <div className="text-center py-4"><p className="text-xs text-slate-400">No matching opportunities right now</p></div>
              ) : (
                <div className="space-y-1.5">
                  {recommendedRfx.map((rfx) => (
                    <Link key={rfx.id} href={`/rfx/detail?id=${rfx.id}`} className="block p-2.5 rounded-lg hover:bg-slate-50 transition-colors group">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 truncate">{rfx.title}</span>
                        {rfx.budget && <span className="text-xs font-semibold text-slate-500 shrink-0 ml-2">{rfx.budget}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {rfx.naicsCodes && rfx.naicsCodes.length > 0 && (
                          <span className="text-[10px] text-amber-600 font-semibold flex items-center gap-0.5">
                            <Target className="h-2.5 w-2.5" /> NAICS match
                          </span>
                        )}
                        {rfx.createdByName && <span className="text-[10px] text-slate-400">{rfx.createdByName}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* My Active RFxs */}
            <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4 text-slate-500" /> My Active RFxs
                </h3>
                <Link href="/rfx?tab=my" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5">
                  View all <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
              {rfxLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : myRfxList.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-slate-400 mb-2">No active RFxs yet</p>
                  <Link href="/rfx/new" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
                    <Plus className="h-3 w-3" /> Create your first RFx
                  </Link>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {myRfxList.slice(0, 3).map((rfx) => (
                    <Link key={rfx.id} href={`/rfx/evaluate?id=${rfx.id}`} className="block p-2.5 rounded-lg hover:bg-slate-50 transition-colors group">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-600 truncate">{rfx.title}</span>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-[10px] text-slate-400">{rfx.responseCount} bid{rfx.responseCount !== 1 ? "s" : ""}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            rfx.status === "open" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                          }`}>{rfx.status}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════
            SECTION 4: COMMUNITY & EVENTS — Engagement Funnel
            Free events → paid events → physical space → digital loop
            ═══════════════════════════════════════════════════ */}
        <div className="mb-10">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" /> Community &amp; Events
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Upcoming Events CTA */}
            <Link
              href="/events"
              className="p-5 rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 ring-1 ring-indigo-100 hover:shadow-md hover:-translate-y-0.5 transition-all group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-white/80 shadow-sm text-violet-600"><Calendar className="h-5 w-5" /></div>
                <h3 className="text-sm font-bold text-slate-900">Upcoming Events</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Workshops, meetups, and networking sessions — both in-person at our space and virtual. Free and paid events to grow your network.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 mt-3 group-hover:gap-2 transition-all">
                Browse events <ChevronRight className="h-3 w-3" />
              </span>
            </Link>

            {/* Referrals + Directory CTA */}
            <div className="grid grid-rows-2 gap-4">
              <Link
                href="/referrals"
                className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600"><Send className="h-4 w-4" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Refer a Colleague</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Grow the community and track your referral impact</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 ml-auto shrink-0 transition-colors" />
                </div>
              </Link>
              <Link
                href="/directory"
                className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><Briefcase className="h-4 w-4" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Member Directory</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Find teaming partners and local businesses</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 ml-auto shrink-0 transition-colors" />
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════
            SECTION 5: YOUR PATH — Membership Track Selector
            Personalization layer
            ═══════════════════════════════════════════════════ */}
        <div className="mb-8 p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Your Membership Path</h3>
          <p className="text-xs text-slate-500 mb-4">Select your path to see personalized recommendations and resources.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ALL_TRACKS.map((track) => {
              const meta = TRACK_META[track];
              const isSelected = membershipTrack === track;
              const Icon = meta.icon;
              return (
                <button
                  key={track}
                  onClick={() => handleTrackSelect(track)}
                  disabled={trackSaving}
                  className={`p-3 rounded-xl text-left transition-all border-2 ${
                    isSelected
                      ? `${meta.bgColor} border-current ${meta.color} shadow-sm`
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  } disabled:opacity-60`}
                >
                  <Icon className={`h-5 w-5 mb-2 ${isSelected ? meta.color : "text-slate-400"}`} />
                  <div className="text-xs font-bold">{meta.label}</div>
                  <p className="text-[10px] mt-0.5 opacity-70">{meta.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
