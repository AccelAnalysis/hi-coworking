"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  ArrowRight,
  MapPin,
  Wifi,
  Users,
  Briefcase,
} from "lucide-react";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { MicroCoworkingSection } from "@/components/sections/MicroCoworkingSection";
import { WhyHiExistsSection } from "@/components/sections/WhyHiExistsSection";
import { CoreWorkspaceSection } from "@/components/sections/CoreWorkspaceSection";
import { PublicSiteGate } from "@/components/PublicSiteGate";

const MapComponent = dynamic(
  () => import("@/components/MapComponent").then((m) => m.MapComponent),
  { ssr: false, loading: () => <div className="w-full h-64 md:h-80 rounded-2xl bg-slate-100 animate-pulse" /> }
);

export default function Home() {
  return (
    <PublicSiteGate>
      <AppShell>
        <div className="relative overflow-hidden">
        <BackgroundGradients />

        {/* Hero Section */}
        <header className="pt-12 pb-20 md:pt-20 md:pb-32 px-6 relative z-10">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/50 backdrop-blur-sm text-emerald-800 text-xs font-semibold tracking-wide uppercase border border-emerald-100 shadow-sm">
              <MapPin size={12} /> Carrollton, VA
            </div>
            <h1 className="text-5xl md:text-8xl font-bold tracking-tight text-slate-900 leading-[1.1] drop-shadow-sm">
              Big ideas.<br />
              <span className="text-slate-400">Intimate space.</span>
            </h1>
            <p className="text-xl md:text-2xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-light">
              A micro-coworking space designed for focus, flexibility, and real local use—not massive floors or long contracts.
            </p>
            <MapComponent />
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
              <Link
                href="/book"
                className="group inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-slate-900 text-white hover:bg-slate-800 shadow-xl shadow-slate-900/10 transition-all duration-300"
              >
                Find a Space <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-white/80 backdrop-blur-sm text-slate-900 border border-slate-200 hover:bg-white hover:shadow-md shadow-lg shadow-slate-200/50 transition-all duration-300"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </header>

        <MicroCoworkingSection />

        {/* Who It's For */}
        <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4 tracking-tight">Who Hi Coworking Is For</h2>
            <p className="text-slate-600">If any of this sounds familiar, you&apos;re in the right place.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Wifi, title: "Remote Workers", desc: "Need separation from home to actually get things done." },
              { icon: Briefcase, title: "Independent Owners", desc: "Owners who don't yet need a full office lease." },
              { icon: Users, title: "Consultants", desc: "Analysts, creatives, and builders who value focus." },
              { icon: MapPin, title: "Locals", desc: "People who want a workspace nearby—not a commute." },
            ].map((card, i) => (
              <div key={i} className="bg-white/70 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50 hover:shadow-2xl hover:shadow-slate-200/70 hover:-translate-y-1 transition-all duration-300 group hover:border-emerald-200/50">
                <card.icon className="w-10 h-10 text-slate-400 group-hover:text-emerald-600 transition-colors mb-4" />
                <h3 className="font-bold text-lg mb-2">{card.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <WhyHiExistsSection />

        <CoreWorkspaceSection variant="dark" />

        {/* CTA */}
        <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto">
          <div className="bg-emerald-50/50 backdrop-blur-md rounded-2xl p-8 md:p-12 text-center max-w-4xl mx-auto border border-emerald-100 shadow-xl shadow-emerald-100/50">
            <h2 className="text-2xl md:text-3xl font-bold text-emerald-950 mb-4">Ready to find your workspace?</h2>
            <p className="text-emerald-800 mb-8 max-w-2xl mx-auto">
              Hi Coworking is an intimate workspace—built intentionally for the way work actually happens. Join today or explore our spaces.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-emerald-600 hover:bg-emerald-700 text-white border-transparent shadow-lg shadow-emerald-600/20 transition-all duration-300"
              >
                Create an Account
              </Link>
              <Link
                href="/spaces"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-white/80 backdrop-blur-sm text-emerald-900 border border-emerald-200 hover:bg-white hover:shadow-md transition-all duration-300"
              >
                Explore Spaces
              </Link>
            </div>
          </div>
        </section>

        {/* Footer is now provided by AppShell */}
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}
