"use client";

import { MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { MicroCoworkingSection } from "@/components/sections/MicroCoworkingSection";
import { WhyHiExistsSection } from "@/components/sections/WhyHiExistsSection";
import { PublicSiteGate } from "@/components/PublicSiteGate";

export default function AboutPage() {
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
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-slate-900 mb-6">
          Big ideas.<br /><span className="text-slate-400">Intimate space.</span>
        </h1>
        <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-light">
          Hi Coworking is a micro-coworking space designed for focus, flexibility, and real local use—not massive floors or long contracts.
        </p>
      </section>

        <MicroCoworkingSection />
        <WhyHiExistsSection />
      </div>
      </AppShell>
    </PublicSiteGate>
  );
}
