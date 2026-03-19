"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import {
  TrendingUp,
  Target,
  DollarSign,
  Users,
  Building2,
  Zap,
  Globe,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  MapPin,
  Network,
  Shield,
  Rocket,
  Award,
  Clock,
  Briefcase,
  Home,
  Coffee,
} from "lucide-react";

type MetricCard = {
  label: string;
  value: string;
  subtext: string;
  icon: typeof TrendingUp;
};

const keyMetrics: MetricCard[] = [
  {
    label: "Target Market",
    value: "$15B+",
    subtext: "U.S. coworking market by 2025",
    icon: Target,
  },
  {
    label: "Unit Economics",
    value: "40-60%",
    subtext: "Target gross margin per location",
    icon: DollarSign,
  },
  {
    label: "Addressable Markets",
    value: "3,000+",
    subtext: "U.S. towns 10K-50K population",
    icon: MapPin,
  },
  {
    label: "Payback Period",
    value: "18-24mo",
    subtext: "Estimated location breakeven",
    icon: Clock,
  },
];

export default function PitchDeckPage() {
  const [activeTab, setActiveTab] = useState<"problem" | "solution" | "model">("problem");

  return (
    <PublicSiteGate>
      <AppShell fullWidth>
        <div className="bg-white">
          {/* Hero Section */}
          <section className="relative overflow-hidden">
            <BackgroundGradients />
            <div className="relative z-10 max-w-6xl mx-auto px-6 py-20 md:py-32 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold tracking-wide uppercase border border-emerald-200 mb-6">
                <Rocket className="h-3 w-3" /> Investor Pitch Deck
              </div>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 mb-6">
                Micro-Coworking for
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-slate-600">
                  Underserved Markets
                </span>
              </h1>
              <p className="text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed mb-10">
                A scalable, tech-enabled coworking platform designed for small towns and suburban markets—where demand exists but supply doesn&apos;t.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-slate-900 text-white font-semibold shadow-xl shadow-slate-900/20 hover:bg-slate-800 transition-all"
                >
                  Schedule a Call <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/platform"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-white text-slate-900 font-semibold border-2 border-slate-200 hover:border-slate-300 transition-all"
                >
                  View Platform Details
                </Link>
              </div>
            </div>
          </section>

          {/* Key Metrics */}
          <section className="py-16 bg-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {keyMetrics.map((metric, i) => (
                  <div
                    key={i}
                    className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <metric.icon className="h-8 w-8 text-emerald-600" />
                    </div>
                    <div className="text-3xl font-bold text-slate-900 mb-1">{metric.value}</div>
                    <div className="text-sm font-semibold text-slate-700 mb-1">{metric.label}</div>
                    <div className="text-xs text-slate-500">{metric.subtext}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* The Opportunity */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  The Opportunity
                </h2>
                <p className="text-lg text-slate-600 max-w-3xl mx-auto">
                  Coworking has exploded in major metros, but 3,000+ small U.S. towns remain underserved—creating a massive whitespace opportunity.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <div className="bg-slate-50 p-8 rounded-2xl border border-slate-200">
                  <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center text-red-600 mb-4">
                    <Target className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">Market Gap</h3>
                  <p className="text-slate-600 leading-relaxed">
                    Remote work is everywhere, but coworking infrastructure is concentrated in 50-100 major cities. Small towns have demand but no supply.
                  </p>
                </div>

                <div className="bg-slate-50 p-8 rounded-2xl border border-slate-200">
                  <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">Growing Demand</h3>
                  <p className="text-slate-600 leading-relaxed">
                    Freelancers, remote employees, and small business owners in these markets need professional workspace—but have nowhere to go.
                  </p>
                </div>

                <div className="bg-slate-50 p-8 rounded-2xl border border-slate-200">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                    <Zap className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">Lower Competition</h3>
                  <p className="text-slate-600 leading-relaxed">
                    National chains ignore these markets due to perceived scale challenges. We see opportunity where others see obstacles.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Problem / Solution / Model Tabs */}
          <section className="py-20 bg-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="flex justify-center gap-2 mb-12">
                <button
                  onClick={() => setActiveTab("problem")}
                  className={`px-6 py-3 rounded-full font-semibold transition-all ${
                    activeTab === "problem"
                      ? "bg-slate-900 text-white shadow-lg"
                      : "bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  The Problem
                </button>
                <button
                  onClick={() => setActiveTab("solution")}
                  className={`px-6 py-3 rounded-full font-semibold transition-all ${
                    activeTab === "solution"
                      ? "bg-slate-900 text-white shadow-lg"
                      : "bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Our Solution
                </button>
                <button
                  onClick={() => setActiveTab("model")}
                  className={`px-6 py-3 rounded-full font-semibold transition-all ${
                    activeTab === "model"
                      ? "bg-slate-900 text-white shadow-lg"
                      : "bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Business Model
                </button>
              </div>

              {activeTab === "problem" && (
                <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-xl">
                  <h3 className="text-3xl font-bold text-slate-900 mb-6">Why Traditional Coworking Fails in Small Markets</h3>
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center text-red-600 shrink-0">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">High Fixed Costs</h4>
                        <p className="text-slate-600">
                          Large spaces (10,000+ sq ft) require significant upfront capital and high monthly overhead—uneconomical for smaller populations.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center text-red-600 shrink-0">
                        <Users className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">Scale Assumptions</h4>
                        <p className="text-slate-600">
                          National operators need 100+ members per location to hit margins. Small towns can&apos;t support that density.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center text-red-600 shrink-0">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">One-Size-Fits-All</h4>
                        <p className="text-slate-600">
                          Cookie-cutter models ignore local needs. Small markets require flexible, community-integrated solutions.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "solution" && (
                <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-xl">
                  <h3 className="text-3xl font-bold text-slate-900 mb-6">The Hi Coworking Model</h3>
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
                        <Home className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">Micro-Format (1,000-2,000 sq ft)</h4>
                        <p className="text-slate-600">
                          Small footprint = lower rent, lower buildout costs, faster breakeven. Designed for 10-20 active members, not 100+.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
                        <Network className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">Integrated Digital Platform</h4>
                        <p className="text-slate-600">
                          Booking, member directory, procurement marketplace, and community events—all in one app. Tech-enabled efficiency at scale.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
                        <Coffee className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">Hybrid Revenue Streams</h4>
                        <p className="text-slate-600">
                          Memberships + hourly bookings + virtual tiers + conference room rentals. Multiple paths to profitability.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
                        <Rocket className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">Replicable Playbook</h4>
                        <p className="text-slate-600">
                          Standardized site selection, buildout, tech stack, and operations. Proven model ready to scale across similar markets.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "model" && (
                <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-xl">
                  <h3 className="text-3xl font-bold text-slate-900 mb-6">Revenue Model & Unit Economics</h3>
                  <div className="grid md:grid-cols-2 gap-8 mb-8">
                    <div>
                      <h4 className="font-bold text-slate-900 mb-4">Revenue Streams</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <span className="text-slate-700"><strong>Virtual Memberships:</strong> $49/mo</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <span className="text-slate-700"><strong>Coworking Memberships:</strong> $129-$199/mo</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <span className="text-slate-700"><strong>Hourly Bookings:</strong> $9-$17.50/hr</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <span className="text-slate-700"><strong>Conference Room:</strong> $75/hr</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <span className="text-slate-700"><strong>Marketplace Fees:</strong> RFx platform revenue</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 mb-4">Target Unit Economics</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-slate-200">
                          <span className="text-slate-600">Monthly Revenue (Mature)</span>
                          <span className="font-bold text-slate-900">$8K-$12K</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-slate-200">
                          <span className="text-slate-600">Rent + Utilities</span>
                          <span className="font-bold text-slate-900">$2K-$3K</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-slate-200">
                          <span className="text-slate-600">Operating Expenses</span>
                          <span className="font-bold text-slate-900">$2K-$3K</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-slate-200">
                          <span className="text-slate-600">Gross Margin</span>
                          <span className="font-bold text-emerald-600">40-60%</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-slate-600">Initial Investment</span>
                          <span className="font-bold text-slate-900">$50K-$75K</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200">
                    <div className="flex items-start gap-3">
                      <Award className="h-6 w-6 text-emerald-600 shrink-0 mt-1" />
                      <div>
                        <h5 className="font-bold text-slate-900 mb-1">Path to Profitability</h5>
                        <p className="text-slate-700 text-sm">
                          With 12-15 active members and consistent hourly bookings, a location can reach breakeven within 18-24 months. Mature locations targeting $4K-$6K monthly EBITDA.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Competitive Advantages */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Competitive Advantages
                </h2>
                <p className="text-lg text-slate-600 max-w-3xl mx-auto">
                  What makes Hi Coworking defensible and scalable in underserved markets.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-gradient-to-br from-slate-50 to-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                    <Zap className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">First-Mover in Micro Markets</h3>
                  <p className="text-slate-600 leading-relaxed">
                    We&apos;re building brand recognition and community trust in towns where no modern coworking exists. Early entry = long-term loyalty.
                  </p>
                </div>

                <div className="bg-gradient-to-br from-slate-50 to-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4">
                    <Network className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">Proprietary Tech Platform</h3>
                  <p className="text-slate-600 leading-relaxed">
                    Custom-built booking, access control, member directory, and procurement tools. Competitors would need years to replicate.
                  </p>
                </div>

                <div className="bg-gradient-to-br from-slate-50 to-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 mb-4">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">Data-Driven Site Selection</h3>
                  <p className="text-slate-600 leading-relaxed">
                    We use demographic, economic, and remote work data to identify high-potential markets before competitors even look.
                  </p>
                </div>

                <div className="bg-gradient-to-br from-slate-50 to-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-4">
                    <Shield className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">Community Integration</h3>
                  <p className="text-slate-600 leading-relaxed">
                    We partner with local businesses, chambers of commerce, and economic development orgs—creating network effects and referral loops.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Expansion Strategy */}
          <section className="py-20 bg-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Expansion Strategy
                </h2>
                <p className="text-lg text-slate-600 max-w-3xl mx-auto">
                  A phased approach to scaling across underserved U.S. markets.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <div className="bg-white p-8 rounded-2xl border-2 border-emerald-200 shadow-sm">
                  <div className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-2">Phase 1</div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-4">Proof of Concept</h3>
                  <p className="text-slate-600 mb-6">
                    Launch 1-2 pilot locations in target markets. Validate unit economics, refine operations, and build case studies.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Carrollton, VA (active)</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Target: 12-18 months to breakeven</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-2xl border-2 border-slate-200 shadow-sm">
                  <div className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2">Phase 2</div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-4">Regional Cluster</h3>
                  <p className="text-slate-600 mb-6">
                    Open 5-10 locations in a single region (e.g., Mid-Atlantic). Build operational efficiency and brand recognition.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span>Target markets: 15K-40K population</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span>Shared regional management</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-2xl border-2 border-slate-200 shadow-sm">
                  <div className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2">Phase 3</div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-4">National Rollout</h3>
                  <p className="text-slate-600 mb-6">
                    Scale to 50+ locations nationwide. Explore franchise model or strategic partnerships for accelerated growth.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span>Multi-region expansion</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span>Franchise or licensing opportunities</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Investment Opportunity */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-12 text-center shadow-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm text-white text-xs font-semibold tracking-wide uppercase border border-white/20 mb-6">
                  <Briefcase className="h-3 w-3" /> Investment Opportunity
                </div>
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                  Partner with Us
                </h2>
                <p className="text-xl text-slate-300 max-w-3xl mx-auto mb-10 leading-relaxed">
                  We&apos;re seeking strategic investors and partners to scale the Hi Coworking model across underserved U.S. markets. Join us in building the future of micro-coworking.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href="/contact"
                    className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-white text-slate-900 font-semibold shadow-xl hover:bg-slate-100 transition-all"
                  >
                    Request Investment Deck <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/platform"
                    className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full border-2 border-white/30 text-white font-semibold hover:bg-white/10 transition-all"
                  >
                    Explore the Platform
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}
