"use client";

import Link from "next/link";
import { BadgeCheck, Building2, ExternalLink, MapPin, ShieldCheck } from "lucide-react";
import type { PublicOrganizationProjection } from "@/lib/firestore";

function safeWebsite(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function ExchangeOrganizationDetail({
  organization,
}: {
  organization: PublicOrganizationProjection;
}) {
  const website = safeWebsite(organization.website);
  const publicLocation = [organization.city, organization.state].filter(Boolean).join(", ");
  const tags = [
    ...(organization.capabilityKeywords ?? []),
    ...(organization.certifications ?? []),
  ].slice(0, 20);

  return (
    <div className="space-y-5 p-5">
      <div>
        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">
          <Building2 className="h-4 w-4" aria-hidden="true" /> Public organization
        </p>
        <h2 className="mt-2 text-xl font-bold leading-7 text-slate-950">{organization.name}</h2>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {publicLocation || "Public location not listed"}
        </p>
      </div>

      <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <dt className="font-semibold text-slate-600">Profile status</dt>
          <dd className="ml-auto capitalize text-slate-900">{organization.verificationStatus ?? "unverified"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <dt className="font-semibold text-slate-600">Claim status</dt>
          <dd className="ml-auto capitalize text-slate-900">{(organization.claimStatus ?? "unclaimed").replaceAll("_", " ")}</dd>
        </div>
        {organization.coordinateConfidence ? (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <dt className="font-semibold text-slate-600">Map confidence</dt>
            <dd className="ml-auto capitalize text-slate-900">{organization.coordinateConfidence}</dd>
          </div>
        ) : null}
      </dl>

      {organization.description ? (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">About</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{organization.description}</p>
        </div>
      ) : null}

      {tags.length || organization.naicsCodes?.length ? (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Capabilities</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">{tag}</span>
            ))}
          </div>
          {organization.naicsCodes?.length ? (
            <p className="mt-2 text-[11px] text-slate-500">NAICS {organization.naicsCodes.join(" · ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-600"
          >
            Visit website <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        {organization.claimStatus !== "claimed" ? (
          <Link
            href="/exchange/onboarding"
            className="inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-violet-600"
          >
            Review or claim this organization
          </Link>
        ) : null}
      </div>

      <p className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-xs leading-5 text-violet-950">
        This view uses the public organization projection. Private contacts, suppressed addresses, claim evidence, and internal trust data are not included.
      </p>
    </div>
  );
}
