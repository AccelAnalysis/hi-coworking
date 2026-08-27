"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Coffee,
  MapPin,
  Printer,
  Wifi,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import { CoreWorkspaceSection } from "@/components/sections/CoreWorkspaceSection";

const MapComponent = dynamic(
  () => import("@/components/MapComponent").then(
    (module) => module.MapComponent,
  ),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-2xl bg-slate-100 md:h-80" />
    ),
  },
);

export default function SpacesPage() {
  return (
    <PublicSiteGate>
      <AppShell>
        <div className="relative">
          <BackgroundGradients />

          <section className="relative z-10 mx-auto max-w-7xl px-6 py-20 text-center md:px-12 md:py-32">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800 shadow-sm backdrop-blur-sm">
              <MapPin size={12} />
              Carrollton, VA
            </div>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 md:text-6xl">
              Our Spaces
            </h1>
            <p className="mx-auto max-w-2xl text-xl font-light leading-relaxed text-slate-600">
              Intentionally intimate. Designed for calm, focused work—not
              massive floors or constant noise.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/book"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-900 px-6 py-3 font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
              >
                Check live availability
              </Link>
              <Link
                href="/pricing"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 bg-white/80 px-6 py-3 font-semibold text-slate-800 backdrop-blur-sm transition hover:bg-white"
              >
                See pricing
              </Link>
            </div>
          </section>

          <CoreWorkspaceSection variant="light" />

          <section className="mx-auto max-w-7xl px-6 py-16 md:px-12">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tight">
              What&apos;s Included
            </h2>
            <div className="grid gap-6 md:grid-cols-4">
              {[
                {
                  icon: Wifi,
                  title: "High-Speed Internet",
                  description: "Fast, reliable Wi-Fi throughout the space.",
                },
                {
                  icon: Coffee,
                  title: "Coffee & Water",
                  description: "Complimentary refreshments to keep you going.",
                },
                {
                  icon: Printer,
                  title: "Printing Access",
                  description: "Scan, copy, and print when you need to.",
                },
                {
                  icon: MapPin,
                  title: "Convenient Location",
                  description: "Easy access right in Carrollton, VA.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="group rounded-2xl border border-white/50 bg-white/70 p-6 text-center shadow-xl shadow-slate-200/50 backdrop-blur-md transition duration-300 hover:-translate-y-1 hover:border-emerald-200/50"
                >
                  <item.icon className="mx-auto mb-3 h-8 w-8 text-slate-400 transition-colors group-hover:text-emerald-600" />
                  <h3 className="mb-1 font-bold">{item.title}</h3>
                  <p className="text-sm text-slate-600">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mx-auto max-w-4xl px-6 py-16 md:px-12">
            <h2 className="mb-4 text-center text-3xl font-bold tracking-tight">
              Find Us
            </h2>
            <p className="mb-8 text-center text-slate-600">
              Carrollton, VA — right in the heart of the community.
            </p>
            <MapComponent />
          </section>

          <section className="mx-auto max-w-7xl px-6 py-20 md:px-12">
            <div className="mx-auto max-w-4xl rounded-2xl border border-emerald-100 bg-emerald-50/50 p-8 text-center shadow-xl shadow-emerald-100/50 backdrop-blur-md md:p-12">
              <h2 className="mb-4 text-2xl font-bold text-emerald-950 md:text-3xl">
                Ready to work?
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-emerald-800">
                Choose when you want to work and see only the desks and setups
                available for the full stay.
              </p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row">
                <Link
                  href="/book"
                  className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
                >
                  Book a Space
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center rounded-full border border-emerald-200 bg-white/80 px-6 py-3 font-medium text-emerald-900 backdrop-blur-sm transition hover:bg-white hover:shadow-md"
                >
                  View Pricing
                </Link>
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}
