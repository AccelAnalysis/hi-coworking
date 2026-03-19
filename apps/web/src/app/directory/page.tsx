"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getPublishedProfiles,
  isProcurementReady,
  type DirectoryFilters,
} from "@/lib/firestore";
import type { ProfileDoc } from "@hi/shared";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Shield,
  Loader2,
  Users,
  Filter,
  X,
  Globe,
  Award,
  ChevronRight,
} from "lucide-react";

const CERTIFICATION_OPTIONS = [
  "8(a)",
  "WOSB",
  "EDWOSB",
  "HUBZone",
  "SDVOSB",
  "VOSB",
  "MBE",
  "WBE",
  "DBE",
  "SDB",
  "LGBTBE",
];

const PAGE_SIZE = 12;

export default function DirectoryPageWrapper() {
  return (
    <RequireAuth>
      <DirectoryContent />
    </RequireAuth>
  );
}

function DirectoryContent() {
  const [profiles, setProfiles] = useState<ProfileDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [certification, setCertification] = useState("");
  const [procurementReady, setProcurementReady] = useState(false);

  const buildFilters = useCallback((): DirectoryFilters => {
    const f: DirectoryFilters = {};
    if (search.trim()) f.search = search.trim();
    if (certification) f.certification = certification;
    if (procurementReady) f.procurementReady = true;
    return f;
  }, [search, certification, procurementReady]);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPublishedProfiles(buildFilters(), PAGE_SIZE);
      setProfiles(result.profiles);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error("Failed to fetch directory:", err);
    } finally {
      setLoading(false);
    }
  }, [buildFilters]);

  // Initial load + re-fetch on filter changes
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getPublishedProfiles(buildFilters(), PAGE_SIZE, lastDoc);
      setProfiles((prev) => [...prev, ...result.profiles]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error("Failed to load more profiles:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setCertification("");
    setProcurementReady(false);
  };

  const hasActiveFilters = !!search || !!certification || procurementReady;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Users className="h-8 w-8 text-slate-400" />
              Member Directory
            </h1>
            <p className="text-slate-500 mt-1">
              Discover businesses, consultants, and contractors in the Hi Coworking network.
            </p>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by business name or description..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all text-sm"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
              showFilters || hasActiveFilters
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 h-5 w-5 rounded-full bg-white/20 text-[10px] font-bold flex items-center justify-center">
                {(certification ? 1 : 0) + (procurementReady ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Expandable filters */}
        {showFilters && (
          <div className="p-5 mb-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">Filter Members</h3>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Certification filter */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Certification
                </label>
                <select
                  value={certification}
                  onChange={(e) => setCertification(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                >
                  <option value="">All certifications</option>
                  {CERTIFICATION_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Procurement-Ready filter */}
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2.5 cursor-pointer py-2.5">
                  <input
                    type="checkbox"
                    checked={procurementReady}
                    onChange={(e) => setProcurementReady(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-emerald-600" />
                    Procurement-Ready only
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-24">
            <Users className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">No members found</h2>
            <p className="text-sm text-slate-500">
              {hasActiveFilters
                ? "Try adjusting your filters or search terms."
                : "No members have published their profiles yet."}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {profiles.map((profile) => (
                <MemberCard key={profile.uid} profile={profile} />
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-all disabled:opacity-60"
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function MemberCard({ profile }: { profile: ProfileDoc }) {
  const score = profile.profileCompletenessScore ?? 0;
  const procReady = isProcurementReady(score);

  return (
    <Link
      href={`/directory/profile?uid=${profile.uid}`}
      className="group block p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start gap-4">
        {/* Photo */}
        <div className="relative h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden ring-2 ring-slate-200 shrink-0">
          {profile.photoUrl ? (
            <Image
              src={profile.photoUrl}
              alt={profile.businessName || "Member"}
              fill
              className="object-cover"
            />
          ) : (
            <span className="text-lg font-bold text-slate-400">
              {profile.businessName?.[0]?.toUpperCase() || "?"}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 truncate group-hover:text-indigo-600 transition-colors">
              {profile.businessName || "Unnamed Business"}
            </h3>
            {procReady && (
              <span title="Procurement-Ready">
                <Shield className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              </span>
            )}
          </div>

          {profile.bio && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
              {profile.bio}
            </p>
          )}
        </div>
      </div>

      {/* Certifications */}
      {profile.certifications && profile.certifications.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {profile.certifications.slice(0, 4).map((cert) => (
            <span
              key={cert}
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              {cert}
            </span>
          ))}
          {profile.certifications.length > 4 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
              +{profile.certifications.length - 4}
            </span>
          )}
        </div>
      )}

      {/* NAICS + Website */}
      <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-400">
        {profile.naicsCodes && profile.naicsCodes.length > 0 && (
          <span className="flex items-center gap-1">
            <Award className="h-3 w-3" />
            {profile.naicsCodes.length} NAICS
          </span>
        )}
        {profile.website && (
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            Website
          </span>
        )}
        {procReady && (
          <span className="ml-auto text-emerald-600 font-semibold">
            Procurement-Ready
          </span>
        )}
      </div>
    </Link>
  );
}
