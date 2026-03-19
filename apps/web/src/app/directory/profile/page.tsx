"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getProfileFromFirestore,
  computeProfileCompleteness,
  isProcurementReady,
} from "@/lib/firestore";
import type { ProfileDoc } from "@hi/shared";
import Image from "next/image";
import Link from "next/link";
import {
  Loader2,
  Shield,
  Globe,
  Linkedin,
  FileText,
  ArrowLeft,
  Award,
  Building2,
  Hash,
  ExternalLink,
} from "lucide-react";

export default function MemberProfilePage() {
  return (
    <RequireAuth>
      <MemberProfileContent />
    </RequireAuth>
  );
}

function MemberProfileContent() {
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid");

  const [profile, setProfile] = useState<ProfileDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!uid) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const p = await getProfileFromFirestore(uid);
        if (!p || !p.published) {
          setNotFound(true);
        } else {
          setProfile(p);
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (notFound || !profile) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto text-center py-24">
          <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Profile Not Found</h1>
          <p className="text-sm text-slate-500 mb-6">
            This member profile is not available or has not been published.
          </p>
          <Link
            href="/directory"
            className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Directory
          </Link>
        </div>
      </AppShell>
    );
  }

  const score = computeProfileCompleteness(profile);
  const procReady = isProcurementReady(score);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link
          href="/directory"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Directory
        </Link>

        {/* Profile header */}
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6 md:p-8 mb-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Photo */}
            <div className="relative h-24 w-24 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden ring-2 ring-slate-200 shrink-0">
              {profile.photoUrl ? (
                <Image
                  src={profile.photoUrl}
                  alt={profile.businessName || "Member"}
                  fill
                  className="object-cover"
                />
              ) : (
                <span className="text-3xl font-bold text-slate-400">
                  {profile.businessName?.[0]?.toUpperCase() || "?"}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900">
                  {profile.businessName || "Unnamed Business"}
                </h1>
                {procReady && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <Shield className="h-3.5 w-3.5" />
                    Procurement-Ready
                  </span>
                )}
              </div>

              {profile.bio && (
                <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                  {profile.bio}
                </p>
              )}

              {/* Links */}
              <div className="flex items-center gap-4 mt-4">
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    <Globe className="h-4 w-4" />
                    Website
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {profile.linkedin && (
                  <a
                    href={profile.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    <Linkedin className="h-4 w-4" />
                    LinkedIn
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Certifications */}
          {profile.certifications && profile.certifications.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
                <Award className="h-4 w-4 text-emerald-600" />
                Certifications
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile.certifications.map((cert) => (
                  <span
                    key={cert}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    {cert}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* NAICS Codes */}
          {profile.naicsCodes && profile.naicsCodes.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
                <Hash className="h-4 w-4 text-slate-500" />
                NAICS Codes
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile.naicsCodes.map((code) => (
                  <span
                    key={code}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 font-mono"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Government IDs */}
          {(profile.uei || profile.duns || profile.cageCode) && (
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
                <Building2 className="h-4 w-4 text-slate-500" />
                Government Identifiers
              </h2>
              <div className="space-y-3">
                {profile.uei && (
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">UEI</span>
                    <p className="text-sm font-mono text-slate-900 mt-0.5">{profile.uei}</p>
                  </div>
                )}
                {profile.duns && (
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">DUNS</span>
                    <p className="text-sm font-mono text-slate-900 mt-0.5">{profile.duns}</p>
                  </div>
                )}
                {profile.cageCode && (
                  <div>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">CAGE Code</span>
                    <p className="text-sm font-mono text-slate-900 mt-0.5">{profile.cageCode}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Capability Statement */}
          {profile.capabilityStatementUrl && (
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
                <FileText className="h-4 w-4 text-slate-500" />
                Capability Statement
              </h2>
              <a
                href={profile.capabilityStatementUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <FileText className="h-4 w-4 text-slate-500" />
                View Capability Statement
                <ExternalLink className="h-3 w-3 text-slate-400" />
              </a>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
