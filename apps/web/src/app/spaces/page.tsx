"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Coffee, Wifi, Printer, MapPin } from "lucide-react";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { CoreWorkspaceSection } from "@/components/sections/CoreWorkspaceSection";
import { PublicSiteGate } from "@/components/PublicSiteGate";

const MapComponent = dynamic(
  () => import("@/components/MapComponent").then((m) => m.MapComponent),
  { ssr: false, loading: () => <div className="w-full h-64 md:h-80 rounded-2xl bg-slate-100 animate-pulse" /> }
);

export default function SpacesPage() {
  return (
    <PublicSiteGate>
      <AppShell>
        <div className="relative">
        <BackgroundGradients />

        {/* Hero */}
        <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/50 backdrop-blur-sm text-emerald-800 text-xs font-semibold tracking-wide uppercase border border-emerald-100 shadow-sm mb-6">
            <MapPin size={12} /> Carrollton, VA
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-slate-900 mb-6">Our Spaces</h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-light">
            Intentionally intimate. Designed for calm, focused work—not massive floors or constant noise.
          </p>
        </section>

        <CoreWorkspaceSection variant="light" />

        {/* Amenities */}
        <section className="py-16 px-6 md:px-12 max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12 tracking-tight">What&apos;s Included</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { icon: Wifi, title: "High-Speed Internet", desc: "Fast, reliable Wi-Fi throughout the space." },
              { icon: Coffee, title: "Coffee & Water", desc: "Complimentary refreshments to keep you going." },
              { icon: Printer, title: "Printing Access", desc: "Scan, copy, and print when you need to." },
              { icon: MapPin, title: "Convenient Location", desc: "Easy access right in Carrollton, VA." },
            ].map((item, i) => (
              <div key={i} className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50 text-center group hover:border-emerald-200/50 hover:-translate-y-1 transition-all duration-300">
                <item.icon className="w-8 h-8 text-slate-400 group-hover:text-emerald-600 transition-colors mx-auto mb-3" />
                <h3 className="font-bold mb-1">{item.title}</h3>
                <p className="text-sm text-slate-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Map */}
        <section className="py-16 px-6 md:px-12 max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 tracking-tight">Find Us</h2>
          <p className="text-center text-slate-600 mb-8">Carrollton, VA — right in the heart of the community.</p>
          <MapComponent />
        </section>

        {/* CTA */}
        <section className="py-20 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="bg-emerald-50/50 backdrop-blur-md rounded-2xl p-8 md:p-12 text-center max-w-4xl mx-auto border border-emerald-100 shadow-xl shadow-emerald-100/50">
            <h2 className="text-2xl md:text-3xl font-bold text-emerald-950 mb-4">Ready to work?</h2>
            <p className="text-emerald-800 mb-8 max-w-2xl mx-auto">
              Book a desk today and experience focused, flexible workspace.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/book"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/10 transition-all duration-300"
              >
                Book a Space
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-white/80 backdrop-blur-sm text-emerald-900 border border-emerald-200 hover:bg-white hover:shadow-md transition-all duration-300"
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
