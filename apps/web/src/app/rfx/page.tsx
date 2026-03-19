"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  type ViewportBounds,
  getTeamInvitesReceived,
  getOpenRfxByViewportGeohash,
  getOpenRfxListFromFirestore,
  getProfileFromFirestore,
  getRfxSuggestionsForUser,
  getUserRfxListFromFirestore,
} from "@/lib/firestore";
import {
  listReleasedTerritoriesFn,
  refreshRfxSuggestionsFn,
  teamCreateFn,
  teamInviteFn,
  teamManageMemberFn,
  teamRespondInviteFn,
} from "@/lib/functions";
import { MarketplaceMap } from "@/components/rfx/MarketplaceMap";
import { PreviewModeBanner } from "@/components/rfx/PreviewModeBanner";
import {
  canTransact,
  type ProfileDoc,
  type RfxDoc,
  type RfxTeamDoc,
  type RfxTeamInviteDoc,
  type RfxTeamRole,
  type TerritoryDoc,
} from "@hi/shared";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Loader2,
  Plus,
  Bookmark,
  Layers3,
  Search,
  MapPin,
  Calendar,
  Users,
  FileText,
  ChevronRight,
  SlidersHorizontal,
  ClipboardList,
  Sparkles,
  Lock,
  MessagesSquare,
  UserPlus,
  Shield,
  FileStack,
  Trash2,
} from "lucide-react";

type Tab = "open" | "my-rfx" | "saved" | "teaming";

export default function RfxFeedPage() {
  return (
    <RequireAuth>
      <RfxFeedContent />
    </RequireAuth>
  );
}

function TeamingPanel({
  transactAllowed,
  rfxOpportunities,
  teamByRfxId,
  selectedTeam,
  selectedTeamId,
  setSelectedTeamId,
  teamList,
  teamInvites,
  teamDirectoryUsers,
  createTeamName,
  setCreateTeamName,
  createTeamNotes,
  setCreateTeamNotes,
  inviteeUid,
  setInviteeUid,
  inviteRole,
  setInviteRole,
  inviteNote,
  setInviteNote,
  teamingBusy,
  onCreateTeam,
  onInviteMember,
  onRespondInvite,
  onRemoveMember,
}: {
  transactAllowed: boolean;
  rfxOpportunities: RfxDoc[];
  teamByRfxId: Map<string, RfxTeamDoc>;
  selectedTeam: RfxTeamDoc | null;
  selectedTeamId: string;
  setSelectedTeamId: (id: string) => void;
  teamList: RfxTeamDoc[];
  teamInvites: RfxTeamInviteDoc[];
  teamDirectoryUsers: Array<{ uid: string; displayName?: string; email?: string; role?: string }>;
  createTeamName: string;
  setCreateTeamName: (value: string) => void;
  createTeamNotes: string;
  setCreateTeamNotes: (value: string) => void;
  inviteeUid: string;
  setInviteeUid: (value: string) => void;
  inviteRole: Exclude<RfxTeamRole, "prime">;
  setInviteRole: (value: Exclude<RfxTeamRole, "prime">) => void;
  inviteNote: string;
  setInviteNote: (value: string) => void;
  teamingBusy: boolean;
  onCreateTeam: (rfxId: string) => Promise<void>;
  onInviteMember: () => Promise<void>;
  onRespondInvite: (inviteId: string, accept: boolean) => Promise<void>;
  onRemoveMember: (memberUid: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      {!transactAllowed ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Teaming requires transact mode (released territory + verified profile).
        </div>
      ) : null}

      {teamInvites.filter((invite) => invite.status === "pending").length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
            <UserPlus className="h-3.5 w-3.5" /> Pending Team Invites
          </h4>
          <div className="space-y-2">
            {teamInvites
              .filter((invite) => invite.status === "pending")
              .map((invite) => (
                <div key={invite.id} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="text-xs font-semibold text-slate-800">RFx {invite.rfxId}</div>
                  <div className="text-[11px] text-slate-500">
                    Role: {invite.role || "sub"} · From {invite.inviterUid}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onRespondInvite(invite.id, true)}
                      disabled={teamingBusy}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => onRespondInvite(invite.id, false)}
                      disabled={teamingBusy}
                      className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
          <Shield className="h-3.5 w-3.5" /> Teaming Directory (Open RFx)
        </h4>
        <div className="space-y-2">
          {rfxOpportunities.slice(0, 10).map((rfx) => {
            const existingTeam = teamByRfxId.get(rfx.id);
            return (
              <div key={rfx.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="text-xs font-semibold text-slate-800">{rfx.title}</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {existingTeam ? `Existing team: ${existingTeam.name}` : "No team yet"}
                </div>
                {!existingTeam ? (
                  <div className="mt-2 grid gap-2">
                    <input
                      value={createTeamName}
                      onChange={(e) => setCreateTeamName(e.target.value)}
                      placeholder="Team name"
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    />
                    <textarea
                      value={createTeamNotes}
                      onChange={(e) => setCreateTeamNotes(e.target.value)}
                      placeholder="Internal notes"
                      rows={2}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => onCreateTeam(rfx.id)}
                      disabled={teamingBusy || !transactAllowed}
                      className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      Create Team
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
          <FileStack className="h-3.5 w-3.5" /> Team Dashboard
        </h4>
        {teamList.length === 0 ? (
          <p className="text-xs text-slate-500">No teams yet. Create or accept a team invite.</p>
        ) : (
          <>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              {teamList.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} ({team.status})
                </option>
              ))}
            </select>

            {selectedTeam ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                  <div><span className="font-semibold text-slate-800">RFx:</span> {selectedTeam.rfxId}</div>
                  <div><span className="font-semibold text-slate-800">Notes:</span> {selectedTeam.internalNotes || "—"}</div>
                </div>

                <div className="rounded-lg border border-slate-200 p-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Roster</div>
                  <div className="space-y-1">
                    {selectedTeam.members.map((member) => (
                      <div key={member.uid} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-[11px]">
                        <div>
                          <span className="font-semibold text-slate-800">{member.displayName || member.uid}</span>
                          <span className="ml-1 text-slate-500">· {member.role}</span>
                        </div>
                        {member.uid !== selectedTeam.primeUid ? (
                          <button
                            onClick={() => onRemoveMember(member.uid)}
                            disabled={teamingBusy}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                          >
                            <Trash2 className="h-3 w-3" /> Remove
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-indigo-700">Prime</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Documents (placeholder)
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Shared team document workspace is coming soon. Use internal notes + roster management for now.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 p-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Invite member</div>
                  <select
                    value={inviteeUid}
                    onChange={(e) => setInviteeUid(e.target.value)}
                    className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    <option value="">Select user</option>
                    {teamDirectoryUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName || u.email || u.uid} ({u.role || "member"})
                      </option>
                    ))}
                  </select>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Exclude<RfxTeamRole, "prime">)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    >
                      <option value="sub">sub</option>
                      <option value="estimator">estimator</option>
                      <option value="compliance">compliance</option>
                      <option value="proposal_writer">proposal_writer</option>
                    </select>
                    <input
                      value={inviteNote}
                      onChange={(e) => setInviteNote(e.target.value)}
                      placeholder="Invite note"
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    />
                  </div>
                  <button
                    onClick={onInviteMember}
                    disabled={teamingBusy || !inviteeUid}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Send invite
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function RfxFeedContent() {
  const { user, role } = useAuth();
  const [tab, setTab] = useState<Tab>("open");
  const [openRfxList, setOpenRfxList] = useState<RfxDoc[]>([]);
  const [suggestedOpenRfxList, setSuggestedOpenRfxList] = useState<RfxDoc[]>([]);
  const [myRfxList, setMyRfxList] = useState<RfxDoc[]>([]);
  const [savedRfxIds, setSavedRfxIds] = useState<string[]>([]);
  const [releasedTerritories, setReleasedTerritories] = useState<TerritoryDoc[]>([]);
  const [scheduledTerritories, setScheduledTerritories] = useState<TerritoryDoc[]>([]);
  const [profile, setProfile] = useState<ProfileDoc | null>(null);
  const [selectedRfxId, setSelectedRfxId] = useState<string>("");
  const [territoryMessage, setTerritoryMessage] = useState<string>("");
  const [localFirstOnly, setLocalFirstOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [suggestionMode, setSuggestionMode] = useState<"cached" | "live">("live");
  const [searchTerm, setSearchTerm] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [naicsFilter, setNaicsFilter] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [mapViewport, setMapViewport] = useState<ViewportBounds | null>(null);
  const [teamList, setTeamList] = useState<RfxTeamDoc[]>([]);
  const [teamInvites, setTeamInvites] = useState<RfxTeamInviteDoc[]>([]);
  const [teamDirectoryUsers, setTeamDirectoryUsers] = useState<Array<{ uid: string; displayName?: string; email?: string; role?: string }>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [createTeamName, setCreateTeamName] = useState("");
  const [createTeamNotes, setCreateTeamNotes] = useState("");
  const [inviteeUid, setInviteeUid] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<RfxTeamRole, "prime">>("sub");
  const [inviteNote, setInviteNote] = useState("");
  const [teamingBusy, setTeamingBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      try {
        const uid = user?.uid;
        if (!uid) return;
        const [mine, userProfile, territoryRes] = await Promise.all([
          getUserRfxListFromFirestore(uid),
          getProfileFromFirestore(uid),
          listReleasedTerritoriesFn({}),
        ]);

        const naicsCodes = userProfile?.naicsCodes || [];
        let open = await getRfxSuggestionsForUser(uid, naicsCodes, 60);
        let source: "cached" | "live" = "cached";

        if (open.length === 0) {
          await refreshRfxSuggestionsFn({});
          open = await getRfxSuggestionsForUser(uid, naicsCodes, 60);
        }

        if (open.length === 0) {
          open = await getOpenRfxListFromFirestore();
          source = "live";
        }

        if (!cancelled) {
          setSuggestedOpenRfxList(open);
          setOpenRfxList(open);
          setMyRfxList(mine);
          setProfile(userProfile);
          setReleasedTerritories(territoryRes.data.released || []);
          setScheduledTerritories(territoryRes.data.scheduled || []);
          setSuggestionMode(source);
          if (!selectedRfxId && open.length > 0) {
            setSelectedRfxId(open[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to fetch RFx list:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [selectedRfxId, user]);

  useEffect(() => {
    if (!mapViewport) return;
    const viewport = mapViewport;
    let cancelled = false;

    async function fetchViewportPins() {
      try {
        const viewportRfx = await getOpenRfxByViewportGeohash(viewport, 220);
        if (cancelled) return;

        if (viewportRfx.length > 0) {
          setOpenRfxList(viewportRfx);
        } else {
          setOpenRfxList(suggestedOpenRfxList);
        }
      } catch (err) {
        console.error("Failed viewport geohash fetch:", err);
      }
    }

    fetchViewportPins();
    return () => {
      cancelled = true;
    };
  }, [mapViewport, suggestedOpenRfxList]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchTeamingData() {
      try {
        const uid = user?.uid;
        if (!uid) return;
        const [primeTeamSnap, memberTeamSnap, invites, usersSnap] = await Promise.all([
          getDocs(query(collection(db, "rfxTeams"), where("primeUid", "==", uid), limit(120))),
          getDocs(query(collection(db, "rfxTeams"), where("memberUids", "array-contains", uid), limit(120))),
          getTeamInvitesReceived(uid),
          getDocs(
            query(
              collection(db, "users"),
              where("role", "in", ["member", "externalVendor", "econPartner"]),
              limit(300)
            )
          ),
        ]);

        if (cancelled) return;

        const teamsById = new Map<string, RfxTeamDoc>();
        [...primeTeamSnap.docs, ...memberTeamSnap.docs].forEach((docSnap) => {
          const team = docSnap.data() as RfxTeamDoc;
          teamsById.set(team.id, team);
        });
        const teams = Array.from(teamsById.values()).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

        setTeamList(teams);
        setTeamInvites(invites);
        setTeamDirectoryUsers(
          usersSnap.docs
            .map((d) => d.data() as { uid: string; displayName?: string; email?: string; role?: string })
            .filter((u) => u.uid && u.uid !== uid)
        );

        if (!selectedTeamId && teams.length > 0) {
          setSelectedTeamId(teams[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch teaming data:", err);
      }
    }

    fetchTeamingData();
    return () => {
      cancelled = true;
    };
  }, [user, selectedTeamId]);

  useEffect(() => {
    if (!user) return;
    const key = `saved_rfx_${user.uid}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        setSavedRfxIds(parsed);
      }
    } catch {
      // ignore invalid saved format
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(`saved_rfx_${user.uid}`, JSON.stringify(savedRfxIds));
  }, [savedRfxIds, user]);

  const transactGate = canTransact({
    userRole: role ?? undefined,
    verificationStatus: profile?.verificationStatus,
    territoryStatus: releasedTerritories.length > 0 ? "released" : "scheduled",
  });

  const toggleSaved = (rfxId: string) => {
    setSavedRfxIds((prev) =>
      prev.includes(rfxId) ? prev.filter((id) => id !== rfxId) : [...prev, rfxId]
    );
  };

  const teamByRfxId = useMemo(() => {
    const map = new Map<string, RfxTeamDoc>();
    teamList.forEach((team) => {
      if (!map.has(team.rfxId)) {
        map.set(team.rfxId, team);
      }
    });
    return map;
  }, [teamList]);

  const selectedTeam = teamList.find((team) => team.id === selectedTeamId) || null;

  const handleCreateTeam = async (rfxId: string) => {
    if (!transactGate.allowed) {
      setTerritoryMessage("Teaming is transact-only. Complete verification and wait for territory release.");
      return;
    }
    if (!createTeamName.trim()) {
      setTerritoryMessage("Team name is required.");
      return;
    }
    setTeamingBusy(true);
    try {
      const { data } = await teamCreateFn({
        rfxId,
        name: createTeamName.trim(),
        internalNotes: createTeamNotes.trim() || undefined,
      });
      setSelectedTeamId(data.teamId);
      setCreateTeamName("");
      setCreateTeamNotes("");
      const teamSnap = await getDoc(doc(db, "rfxTeams", data.teamId));
      const createdTeam = (teamSnap.exists() ? (teamSnap.data() as RfxTeamDoc) : undefined);
      if (createdTeam) {
        setTeamList((prev) => [createdTeam, ...prev.filter((t) => t.id !== createdTeam.id)]);
      }
    } catch (err) {
      console.error("Failed to create team:", err);
      setTerritoryMessage((err as Error)?.message || "Failed to create team.");
    } finally {
      setTeamingBusy(false);
    }
  };

  const handleInviteMember = async () => {
    if (!selectedTeam || !inviteeUid) return;
    setTeamingBusy(true);
    try {
      await teamInviteFn({ teamId: selectedTeam.id, inviteeUid, role: inviteRole, note: inviteNote.trim() || undefined });
      setInviteeUid("");
      setInviteNote("");
      setTerritoryMessage("Team invite sent.");
    } catch (err) {
      console.error("Failed to send invite:", err);
      setTerritoryMessage((err as Error)?.message || "Failed to send invite.");
    } finally {
      setTeamingBusy(false);
    }
  };

  const handleRespondInvite = async (inviteId: string, accept: boolean) => {
    setTeamingBusy(true);
    try {
      const { data } = await teamRespondInviteFn({ inviteId, accept });
      if (accept && data.teamId) {
        setSelectedTeamId(data.teamId);
      }
      setTeamInvites((prev) =>
        prev.map((invite) =>
          invite.id === inviteId
            ? { ...invite, status: accept ? "accepted" : "declined", updatedAt: Date.now() }
            : invite
        )
      );
    } catch (err) {
      console.error("Failed to respond to invite:", err);
    } finally {
      setTeamingBusy(false);
    }
  };

  const handleRemoveMember = async (memberUid: string) => {
    if (!selectedTeam) return;
    setTeamingBusy(true);
    try {
      await teamManageMemberFn({ teamId: selectedTeam.id, memberUid, action: "remove" });
      setTeamList((prev) =>
        prev.map((team) =>
          team.id === selectedTeam.id
            ? { ...team, members: team.members.filter((m) => m.uid !== memberUid), updatedAt: Date.now() }
            : team
        )
      );
    } catch (err) {
      console.error("Failed to remove member:", err);
      setTerritoryMessage((err as Error)?.message || "Failed to remove member.");
    } finally {
      setTeamingBusy(false);
    }
  };

  const filteredOpen = useMemo(() => {
    let list = openRfxList;

    if (localFirstOnly && releasedTerritories.length > 0) {
      const releasedFipsSet = new Set(releasedTerritories.map((t) => t.fips));
      list = list.filter((rfx) => !rfx.territoryFips || releasedFipsSet.has(rfx.territoryFips));
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(lower) ||
          r.description.toLowerCase().includes(lower) ||
          r.createdByName?.toLowerCase().includes(lower)
      );
    }
    if (locationFilter) {
      const lower = locationFilter.toLowerCase();
      list = list.filter((r) => r.location?.toLowerCase().includes(lower));
    }
    if (naicsFilter) {
      const codes = naicsFilter.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (codes.length > 0) {
        list = list.filter((r) =>
          r.naicsCodes?.some((nc) => codes.some((c) => nc.toLowerCase().includes(c)))
        );
      }
    }

    return list;
  }, [
    localFirstOnly,
    locationFilter,
    naicsFilter,
    openRfxList,
    releasedTerritories,
    searchTerm,
  ]);

  const savedRfxList = useMemo(
    () => openRfxList.filter((rfx) => savedRfxIds.includes(rfx.id)),
    [openRfxList, savedRfxIds]
  );

  const teamingPlaceholderList = useMemo(
    () => filteredOpen.filter((rfx) => rfx.status === "open").slice(0, 8),
    [filteredOpen]
  );

  const activeList =
    tab === "open"
      ? filteredOpen
      : tab === "my-rfx"
      ? myRfxList
      : tab === "saved"
      ? savedRfxList
      : teamingPlaceholderList;

  const selectedRfx = activeList.find((r) => r.id === selectedRfxId) || activeList[0] || null;
  const shouldSuggestRadiusExpansion = localFirstOnly && filteredOpen.length < 3;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px]">
        <PreviewModeBanner visible={!transactGate.allowed} reasons={transactGate.reasons} />

        {territoryMessage ? (
          <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {territoryMessage}
          </div>
        ) : null}

        {/* Header */}
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">RFx Marketplace</h1>
            <p className="mt-1 text-slate-500">
              Map-first procurement marketplace with territory release controls.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className={`hidden rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide md:inline-flex ${
              suggestionMode === "cached"
                ? "bg-indigo-100 text-indigo-800"
                : "bg-slate-100 text-slate-600"
            }`}>
              {suggestionMode === "cached" ? "Personalized Feed" : "Live Feed"}
            </span>
            <button
              onClick={() => setLocalFirstOnly((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                localFirstOnly
                  ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300"
                  : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Local First {localFirstOnly ? "On" : "Off"}
            </button>

            <Link
              href="/rfx/new"
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Create RFx
            </Link>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="h-[70vh] min-h-[520px]">
            <MarketplaceMap
              rfxList={filteredOpen}
              releasedTerritories={releasedTerritories}
              scheduledTerritories={scheduledTerritories}
              selectedRfxId={selectedRfxId}
              onSelectRfx={(id) => {
                setSelectedRfxId(id);
                setTab("open");
              }}
              onTerritoryMessage={(msg) => setTerritoryMessage(msg)}
              onViewportChange={(bounds) => setMapViewport(bounds)}
            />
          </div>

          <div className="h-[70vh] min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] font-semibold uppercase tracking-wide sm:grid-cols-4">
                {[
                  { key: "open", label: "Open", icon: ClipboardList, count: filteredOpen.length },
                  { key: "my-rfx", label: "My RFx", icon: FileText, count: myRfxList.length },
                  { key: "saved", label: "Saved", icon: Bookmark, count: savedRfxList.length },
                  { key: "teaming", label: "Teaming", icon: MessagesSquare, count: teamingPlaceholderList.length },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setTab(item.key as Tab)}
                      className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 transition-all ${
                        tab === item.key
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                      <span className="ml-1 text-[10px] font-bold opacity-80">{item.count}</span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                  showFilters
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
              </button>

              {shouldSuggestRadiusExpansion ? (
                <button
                  onClick={() => setLocalFirstOnly(false)}
                  className="ml-2 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800"
                >
                  <Sparkles className="h-3 w-3" />
                  Expand radius
                </button>
              ) : null}

              {showFilters && (
                <div className="mt-3 grid gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search title, description, issuer..."
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <input
                    type="text"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    placeholder="Location filter"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-slate-900"
                  />
                  <input
                    type="text"
                    value={naicsFilter}
                    onChange={(e) => setNaicsFilter(e.target.value)}
                    placeholder="NAICS filter (comma separated)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              )}
            </div>

            <div className="h-[calc(100%-180px)] overflow-y-auto px-4 py-3">
              {tab === "teaming" ? (
                <TeamingPanel
                  transactAllowed={transactGate.allowed}
                  rfxOpportunities={teamingPlaceholderList}
                  teamByRfxId={teamByRfxId}
                  selectedTeam={selectedTeam}
                  selectedTeamId={selectedTeamId}
                  setSelectedTeamId={setSelectedTeamId}
                  teamList={teamList}
                  teamInvites={teamInvites}
                  teamDirectoryUsers={teamDirectoryUsers}
                  createTeamName={createTeamName}
                  setCreateTeamName={setCreateTeamName}
                  createTeamNotes={createTeamNotes}
                  setCreateTeamNotes={setCreateTeamNotes}
                  inviteeUid={inviteeUid}
                  setInviteeUid={setInviteeUid}
                  inviteRole={inviteRole}
                  setInviteRole={setInviteRole}
                  inviteNote={inviteNote}
                  setInviteNote={setInviteNote}
                  teamingBusy={teamingBusy}
                  onCreateTeam={handleCreateTeam}
                  onInviteMember={handleInviteMember}
                  onRespondInvite={handleRespondInvite}
                  onRemoveMember={handleRemoveMember}
                />
              ) : loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : activeList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <Layers3 className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                  <h3 className="text-sm font-bold text-slate-900">Nothing to show in this view</h3>
                  <p className="mt-1 text-xs text-slate-500">Try widening your filters or disabling Local First.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeList.map((rfx) => (
                    <RfxCard
                      key={rfx.id}
                      rfx={rfx}
                      teamName={teamByRfxId.get(rfx.id)?.name}
                      isOwner={rfx.createdBy === user?.uid}
                      isSelected={selectedRfx?.id === rfx.id}
                      isSaved={savedRfxIds.includes(rfx.id)}
                      onSelect={() => setSelectedRfxId(rfx.id)}
                      onToggleSaved={() => toggleSaved(rfx.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 px-4 py-3">
              {selectedRfx ? (
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Selected:</p>
                  <p className="mt-0.5 line-clamp-1">{selectedRfx.title}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <Link
                      href={selectedRfx.createdBy === user?.uid ? `/rfx/evaluate?id=${selectedRfx.id}` : `/rfx/detail?id=${selectedRfx.id}`}
                      className="font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      Open details
                    </Link>
                    {!transactGate.allowed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        <Lock className="h-3 w-3" />
                        View-only
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function RfxCard({
  rfx,
  teamName,
  isOwner,
  isSelected,
  isSaved,
  onSelect,
  onToggleSaved,
}: {
  rfx: RfxDoc;
  teamName?: string;
  isOwner: boolean;
  isSelected: boolean;
  isSaved: boolean;
  onSelect: () => void;
  onToggleSaved: () => void;
}) {
  const [now] = useState(() => Date.now());
  const isPastDue = rfx.dueDate && rfx.dueDate < now;

  return (
    <button
      onClick={onSelect}
      className={`group block w-full rounded-xl p-4 text-left transition-all ${
        isSelected
          ? "bg-slate-900 text-white ring-2 ring-slate-900"
          : "bg-white text-slate-900 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
              {rfx.title}
            </h3>
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                rfx.status === "open"
                  ? "bg-emerald-50 text-emerald-700"
                  : rfx.status === "awarded"
                  ? "bg-indigo-50 text-indigo-700"
                  : rfx.status === "closed"
                  ? "bg-slate-100 text-slate-500"
                  : "bg-yellow-50 text-yellow-600"
              }`}
            >
              {rfx.status}
            </span>
            {rfx.memberOnly && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 uppercase tracking-wide">
                Members only
              </span>
            )}
            {teamName ? (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 uppercase tracking-wide">
                Team: {teamName}
              </span>
            ) : null}
          </div>

          <p className="text-sm text-slate-500 line-clamp-2 mb-3">{rfx.description}</p>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {isOwner && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                You posted this
              </span>
            )}
            {rfx.createdByName && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {rfx.createdByName}
              </span>
            )}
            {rfx.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {rfx.location}
              </span>
            )}
            {rfx.dueDate && (
              <span className={`flex items-center gap-1 ${isPastDue ? "text-red-400" : ""}`}>
                <Calendar className="h-3.5 w-3.5" />
                Due {new Date(rfx.dueDate).toLocaleDateString()}
              </span>
            )}
            {rfx.budget && (
              <span className="font-semibold text-slate-600">{rfx.budget}</span>
            )}
            <span className="flex items-center gap-1 font-semibold text-slate-600">
              <FileText className="h-3.5 w-3.5" />
              {rfx.responseCount} response{rfx.responseCount !== 1 ? "s" : ""}
            </span>
          </div>

          {rfx.naicsCodes && rfx.naicsCodes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {rfx.naicsCodes.slice(0, 4).map((code) => (
                <span
                  key={code}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-50 text-slate-500"
                >
                  {code}
                </span>
              ))}
              {rfx.naicsCodes.length > 4 && (
                <span className="text-[10px] text-slate-400">+{rfx.naicsCodes.length - 4} more</span>
              )}
            </div>
          )}
        </div>

        <div className="mt-1 flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSaved();
            }}
            className={`rounded-full p-1.5 transition-colors ${
              isSaved ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500 hover:text-indigo-700"
            }`}
            title={isSaved ? "Remove from saved" : "Save RFx"}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </button>
          <ChevronRight className="h-5 w-5 text-slate-300 transition-colors group-hover:text-indigo-500" />
        </div>
      </div>
    </button>
  );
}
