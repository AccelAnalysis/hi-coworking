"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import {
  Globe,
  Lock,
  Users,
  Briefcase,
  Calendar,
  MapPin,
  Building2,
  Network,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Clock,
  Shield,
  TrendingUp,
  Zap,
  Target,
  Award,
  FileText,
  DollarSign,
  BarChart3,
  UserCheck,
  Home,
  Coffee,
  Handshake,
  Rocket,
} from "lucide-react";

type UserPathway = {
  id: string;
  label: string;
  icon: typeof Users;
  tagline: string;
  description: string;
  features: string[];
};

const userPathways: UserPathway[] = [
  {
    id: "guest",
    label: "Guest / Walk-In",
    icon: Clock,
    tagline: "Flexible hourly access with no commitment",
    description: "Perfect for occasional users who need professional workspace on-demand without monthly fees.",
    features: [
      "$17.50/hr with $115 daily cap",
      "Book up to 14 days in advance",
      "Instant smart access upon booking",
      "All amenities included",
      "No membership required",
    ],
  },
  {
    id: "virtual",
    label: "Virtual Member",
    icon: Network,
    tagline: "Directory access with flexible workspace hours",
    description: "Ideal for remote professionals who want business networking and occasional workspace access.",
    features: [
      "$49/month membership",
      "2 desk hours/month included",
      "Full directory access",
      "RFx marketplace participation",
      "Event invitations & discounts",
    ],
  },
  {
    id: "coworking",
    label: "Coworking Member",
    icon: Briefcase,
    tagline: "Regular workspace user with priority booking",
    description: "Best for professionals who work from the space regularly and value community connections.",
    features: [
      "$129/month membership",
      "15 desk hours/month included",
      "Extra hours at $10.50/hr",
      "90-day booking window",
      "Priority support & amenities",
    ],
  },
  {
    id: "plus",
    label: "Coworking Plus",
    icon: Award,
    tagline: "Power user with maximum flexibility",
    description: "Designed for daily users who need the most hours and highest booking priority.",
    features: [
      "$199/month membership",
      "30 desk hours/month included",
      "Extra hours at $9/hr",
      "Highest booking priority",
      "Premium member benefits",
    ],
  },
  {
    id: "partner",
    label: "Business Partner",
    icon: Handshake,
    tagline: "RFx vendor and contractor network",
    description: "For businesses seeking procurement opportunities and B2B connections through the platform.",
    features: [
      "Access to RFx opportunities",
      "Verified business profile",
      "Direct member connections",
      "Event sponsorship options",
      "Referral network participation",
    ],
  },
];

export default function PlatformPage() {
  const [activePathway, setActivePathway] = useState<string>("guest");
  const selectedPathway = userPathways.find((p) => p.id === activePathway) || userPathways[0];

  return (
    <PublicSiteGate>
      <AppShell fullWidth>
        <div className="relative bg-white">
          {/* ── HERO ── */}
          <section className="relative overflow-hidden">
            <BackgroundGradients />
            <div className="relative z-10 max-w-5xl mx-auto px-6 py-20 md:py-32 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-sm text-slate-700 text-xs font-semibold tracking-wide uppercase border border-slate-200 shadow-sm mb-6">
                <Globe className="h-3 w-3" /> Platform Overview
              </div>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 mb-6">
                The Operating System for<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-slate-600">
                  Micro-Coworking
                </span>
              </h1>
              <p className="text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed mb-10">
                Hi Coworking combines premium workspace with an integrated digital platform—booking, directory, procurement, and community—all in one seamless experience.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/spaces"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-slate-900 text-white font-semibold shadow-xl shadow-slate-900/20 hover:bg-slate-800 transition-all"
                >
                  Explore Spaces <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-white text-slate-900 font-semibold border-2 border-slate-200 hover:border-slate-300 transition-all"
                >
                  Join as Member
                </Link>
              </div>
            </div>
          </section>

          {/* ── CONCEPT BADGES ── */}
          <section className="py-16 bg-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-slate-100">
                  <div className="text-5xl font-bold text-emerald-600 mb-2">5</div>
                  <div className="text-sm font-semibold text-slate-900">Platform Features</div>
                  <div className="text-xs text-slate-500 mt-1">Integrated layers</div>
                </div>
                <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-slate-100">
                  <div className="text-5xl font-bold text-slate-900 mb-2">6</div>
                  <div className="text-sm font-semibold text-slate-900">Desk Seats</div>
                  <div className="text-xs text-slate-500 mt-1">+ Conference mode</div>
                </div>
                <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-slate-100">
                  <div className="text-5xl font-bold text-amber-600 mb-2">3</div>
                  <div className="text-sm font-semibold text-slate-900">Membership Tiers</div>
                  <div className="text-xs text-slate-500 mt-1">Plus guest access</div>
                </div>
                <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-slate-100">
                  <div className="text-5xl font-bold text-slate-900 mb-2">1</div>
                  <div className="text-sm font-semibold text-slate-900">Local Location</div>
                  <div className="text-xs text-slate-500 mt-1">Carrollton, VA</div>
                </div>
              </div>
            </div>
          </section>

          {/* ── THE PROBLEM ── */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-red-600 uppercase tracking-wider mb-3">The Problem</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Fractured Workspace Solutions
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Professionals today face disconnected options that fail to meet their needs for flexibility, professionalism, and community.
                </p>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                  <Coffee className="h-10 w-10 text-slate-400 mb-4" />
                  <h4 className="font-bold text-slate-900 mb-2">Coffee Shops</h4>
                  <p className="text-sm text-slate-600">Lack privacy, professionalism, and reliable connectivity for client calls.</p>
                </div>
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                  <Home className="h-10 w-10 text-slate-400 mb-4" />
                  <h4 className="font-bold text-slate-900 mb-2">Home Offices</h4>
                  <p className="text-sm text-slate-600">No separation between work and life, limited networking opportunities.</p>
                </div>
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                  <Building2 className="h-10 w-10 text-slate-400 mb-4" />
                  <h4 className="font-bold text-slate-900 mb-2">Traditional Coworking</h4>
                  <p className="text-sm text-slate-600">Requires long-term commitments and often feels impersonal at scale.</p>
                </div>
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                  <Network className="h-10 w-10 text-slate-400 mb-4" />
                  <h4 className="font-bold text-slate-900 mb-2">No Integration</h4>
                  <p className="text-sm text-slate-600">Workspace, networking, and business tools remain siloed and disconnected.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── PLATFORM ARCHITECTURE ── */}
          <section className="py-20 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-3">The Solution</h2>
                <h3 className="text-4xl md:text-5xl font-bold mb-4">
                  One Platform, Five Integrated Layers
                </h3>
                <p className="text-lg text-slate-300 max-w-2xl mx-auto">
                  Hi Coworking delivers a complete ecosystem where physical space meets digital tools for seamless professional growth.
                </p>
              </div>
              <div className="grid md:grid-cols-5 gap-4">
                <div className="p-6 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
                  <MapPin className="h-8 w-8 text-emerald-400 mb-3" />
                  <h4 className="font-bold mb-2">Physical Space</h4>
                  <p className="text-sm text-slate-300">Premium micro-coworking environment designed for focus and client meetings.</p>
                </div>
                <div className="p-6 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
                  <Calendar className="h-8 w-8 text-amber-400 mb-3" />
                  <h4 className="font-bold mb-2">Smart Booking</h4>
                  <p className="text-sm text-slate-300">Frictionless reservations with automated access control and payment.</p>
                </div>
                <div className="p-6 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
                  <Users className="h-8 w-8 text-blue-400 mb-3" />
                  <h4 className="font-bold mb-2">Member Directory</h4>
                  <p className="text-sm text-slate-300">Verified professional network with NAICS-based matching and connections.</p>
                </div>
                <div className="p-6 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
                  <FileText className="h-8 w-8 text-purple-400 mb-3" />
                  <h4 className="font-bold mb-2">RFx Marketplace</h4>
                  <p className="text-sm text-slate-300">B2B procurement opportunities connecting members to contracts and revenue.</p>
                </div>
                <div className="p-6 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
                  <Sparkles className="h-8 w-8 text-pink-400 mb-3" />
                  <h4 className="font-bold mb-2">Events & Community</h4>
                  <p className="text-sm text-slate-300">Programming, workshops, and networking that builds lasting relationships.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── USER PATHWAYS ── */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-3">User Pathways</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Built for Every Stakeholder
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Tailored experiences for guests, members, and business partners—each with unique benefits and access levels.
                </p>
              </div>

              {/* Pathway Tabs */}
              <div className="flex flex-wrap justify-center gap-3 mb-8">
                {userPathways.map((pathway) => (
                  <button
                    key={pathway.id}
                    onClick={() => setActivePathway(pathway.id)}
                    className={`px-5 py-2.5 rounded-full font-medium text-sm transition-all ${
                      activePathway === pathway.id
                        ? "bg-slate-900 text-white shadow-lg"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {pathway.label}
                  </button>
                ))}
              </div>

              {/* Active Pathway Details */}
              <div className="bg-gradient-to-br from-slate-50 to-emerald-50 rounded-3xl p-8 md:p-12 border border-slate-200">
                <div className="flex items-start gap-6">
                  <div className="p-4 rounded-2xl bg-white shadow-sm border border-slate-200">
                    <selectedPathway.icon className="h-10 w-10 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-2xl font-bold text-slate-900 mb-2">{selectedPathway.label}</h4>
                    <p className="text-lg text-emerald-700 font-medium mb-4">{selectedPathway.tagline}</p>
                    <p className="text-slate-600 mb-6">{selectedPathway.description}</p>
                    <ul className="space-y-3">
                      {selectedPathway.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-3 text-slate-700">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── BOOKING WORKFLOW ── */}
          <section className="py-20 bg-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3">Booking Workflow</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Book Space in Minutes
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Our streamlined process gets you from browsing to working in just four simple steps.
                </p>
              </div>
              <div className="grid md:grid-cols-4 gap-6">
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xl flex items-center justify-center mb-4">1</div>
                    <Calendar className="h-8 w-8 text-slate-400 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Browse Availability</h4>
                    <p className="text-sm text-slate-600">View real-time desk and conference room availability on your preferred dates.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-slate-300" />
                </div>
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xl flex items-center justify-center mb-4">2</div>
                    <Target className="h-8 w-8 text-slate-400 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Select Time & Resource</h4>
                    <p className="text-sm text-slate-600">Choose your desk or conference room and specify the hours you need.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-slate-300" />
                </div>
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xl flex items-center justify-center mb-4">3</div>
                    <DollarSign className="h-8 w-8 text-slate-400 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Secure Payment</h4>
                    <p className="text-sm text-slate-600">Complete your booking with secure Stripe payment processing.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-slate-300" />
                </div>
                <div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xl flex items-center justify-center mb-4">4</div>
                    <Zap className="h-8 w-8 text-slate-400 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Smart Access Granted</h4>
                    <p className="text-sm text-slate-600">Receive your access code instantly and walk in when you're ready.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── IMPACT METRICS ── */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-3">What Gets Measured</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Impact Quantified
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Track the metrics that matter—from space utilization to member success and business growth.
                </p>
              </div>
              <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <BarChart3 className="h-8 w-8 text-emerald-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-900">Desk Utilization</h4>
                  <p className="text-xs text-slate-500 mt-1">Real-time capacity tracking</p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <TrendingUp className="h-8 w-8 text-blue-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-900">Member Engagement</h4>
                  <p className="text-xs text-slate-500 mt-1">Activity & retention scores</p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <FileText className="h-8 w-8 text-purple-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-900">RFx Opportunities</h4>
                  <p className="text-xs text-slate-500 mt-1">Matched contracts</p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <Sparkles className="h-8 w-8 text-amber-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-900">Event Attendance</h4>
                  <p className="text-xs text-slate-500 mt-1">Community participation</p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <Handshake className="h-8 w-8 text-emerald-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-900">Referral Conversions</h4>
                  <p className="text-xs text-slate-500 mt-1">Network growth</p>
                </div>
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <Shield className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-900">Access Analytics</h4>
                  <p className="text-xs text-slate-500 mt-1">Security & usage data</p>
                </div>
              </div>
            </div>
          </section>

          {/* ── MEMBER JOURNEY ── */}
          <section className="py-20 bg-gradient-to-br from-emerald-50 to-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-3">Member Journey</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Directed Entry. Expanding Discovery.
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  A guided onboarding flow that gets you started quickly, then opens up the full platform as you engage.
                </p>
              </div>
              <div className="grid md:grid-cols-5 gap-6">
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-200">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-4">1</div>
                    <UserCheck className="h-8 w-8 text-emerald-600 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Register & Verify</h4>
                    <p className="text-sm text-slate-600">Create account and complete identity verification for trusted network access.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-emerald-300" />
                </div>
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-200">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-4">2</div>
                    <Award className="h-8 w-8 text-emerald-600 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Choose Tier</h4>
                    <p className="text-sm text-slate-600">Select the membership level that fits your workspace and networking needs.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-emerald-300" />
                </div>
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-200">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-4">3</div>
                    <Calendar className="h-8 w-8 text-emerald-600 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Book First Space</h4>
                    <p className="text-sm text-slate-600">Make your first reservation and experience the seamless booking flow.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-emerald-300" />
                </div>
                <div className="relative">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-200">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-4">4</div>
                    <Network className="h-8 w-8 text-emerald-600 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Explore Directory & RFx</h4>
                    <p className="text-sm text-slate-600">Connect with verified professionals and discover procurement opportunities.</p>
                  </div>
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 h-6 w-6 text-emerald-300" />
                </div>
                <div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-200">
                    <div className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-4">5</div>
                    <Sparkles className="h-8 w-8 text-emerald-600 mb-3" />
                    <h4 className="font-bold text-slate-900 mb-2">Engage Community</h4>
                    <p className="text-sm text-slate-600">Attend events, make referrals, and build lasting business relationships.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── PRIVACY & SECURITY ── */}
          <section className="py-20 bg-slate-900 text-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-3">Security Architecture</h2>
                <h3 className="text-4xl md:text-5xl font-bold mb-4">
                  Privacy Built Into the Core
                </h3>
                <p className="text-lg text-slate-300 max-w-2xl mx-auto">
                  Tiered access controls ensure members share only what they choose, with verification building trust across the network.
                </p>
              </div>
              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="p-6 rounded-2xl bg-white/5 border-2 border-slate-700">
                  <div className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Public Tier</div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                      <span>Basic profile visibility</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                      <span>Guest booking access</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                      <span>Limited directory view</span>
                    </li>
                  </ul>
                </div>
                <div className="p-6 rounded-2xl bg-white/5 border-2 border-emerald-600">
                  <div className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-4">Member Tier</div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Full directory access</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Booking history & analytics</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Event participation</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>Referral network access</span>
                    </li>
                  </ul>
                </div>
                <div className="p-6 rounded-2xl bg-white/5 border-2 border-amber-600">
                  <div className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-4">Verified Tier</div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>Full RFx participation</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>Enriched business profile</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>Priority matching</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>Trust badge display</span>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="p-6 rounded-2xl bg-emerald-900/30 border border-emerald-700/50">
                <Lock className="h-8 w-8 text-emerald-400 mb-3" />
                <p className="text-slate-200 italic">
                  "Our verification process includes identity confirmation, business license validation, and EIN verification—ensuring every member in the directory is a real, trusted professional. This creates a procurement-ready network where connections lead to real business opportunities."
                </p>
              </div>
            </div>
          </section>

          {/* ── BUSINESS MODEL ── */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-3">Business Model</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Multiple Revenue Streams
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  A diversified model that combines recurring subscriptions with usage-based and platform fees for sustainable growth.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-6 mb-10">
                <div className="p-8 rounded-2xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="p-3 rounded-xl bg-emerald-100">
                      <Users className="h-8 w-8 text-emerald-700" />
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Membership Subscriptions</h4>
                      <div className="text-sm text-emerald-700 font-semibold mt-1">Recurring Monthly</div>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      <span>Virtual: $49/month</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      <span>Coworking: $129/month</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      <span>Coworking Plus: $199/month</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      <span>Predictable, scalable revenue base</span>
                    </li>
                  </ul>
                </div>
                <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-50 to-white border border-slate-200">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="p-3 rounded-xl bg-slate-100">
                      <Clock className="h-8 w-8 text-slate-700" />
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Hourly Bookings</h4>
                      <div className="text-sm text-slate-600 font-semibold mt-1">Guest & Overage Usage</div>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-600 mt-0.5 shrink-0" />
                      <span>Guest rate: $17.50/hr ($115 daily cap)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-600 mt-0.5 shrink-0" />
                      <span>Member extra hours: $9-$12/hr</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-slate-600 mt-0.5 shrink-0" />
                      <span>Flexible revenue from occasional users</span>
                    </li>
                  </ul>
                </div>
                <div className="p-8 rounded-2xl bg-gradient-to-br from-amber-50 to-white border border-amber-200">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="p-3 rounded-xl bg-amber-100">
                      <Building2 className="h-8 w-8 text-amber-700" />
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Conference Room</h4>
                      <div className="text-sm text-amber-700 font-semibold mt-1">Premium Meeting Space</div>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <span>$75/hour for up to 10 people</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <span>Modular space conversion</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <span>High-margin professional meetings</span>
                    </li>
                  </ul>
                </div>
                <div className="p-8 rounded-2xl bg-gradient-to-br from-purple-50 to-white border border-purple-200">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="p-3 rounded-xl bg-purple-100">
                      <Sparkles className="h-8 w-8 text-purple-700" />
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Platform Fees</h4>
                      <div className="text-sm text-purple-700 font-semibold mt-1">RFx, Events, Bookstore</div>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
                      <span>RFx facilitation fees</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
                      <span>Event tickets & sponsorships</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
                      <span>Bookstore affiliate & owned sales</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* TAM Stats */}
              <div className="grid md:grid-cols-3 gap-6">
                <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <div className="text-3xl font-bold text-slate-900 mb-1">2,400+</div>
                  <div className="text-sm text-slate-600">Home-based businesses in Isle of Wight County</div>
                </div>
                <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <div className="text-3xl font-bold text-slate-900 mb-1">38%</div>
                  <div className="text-sm text-slate-600">Remote/hybrid workers in Hampton Roads region</div>
                </div>
                <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <div className="text-3xl font-bold text-slate-900 mb-1">$85K</div>
                  <div className="text-sm text-slate-600">Median household income (local affordability)</div>
                </div>
              </div>
            </div>
          </section>

          {/* ── ROADMAP ── */}
          <section className="py-20 bg-slate-50">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3">Product Roadmap</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Built in Phases. Designed to Scale.
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  A strategic rollout that validates the core model before expanding features and locations.
                </p>
              </div>
              <div className="space-y-6">
                <div className="flex gap-6">
                  <div className="w-32 shrink-0">
                    <div className="p-4 rounded-xl bg-emerald-600 text-white text-center">
                      <div className="text-xs font-bold uppercase tracking-wider mb-1">Phase 1</div>
                      <div className="text-sm font-semibold">Current</div>
                    </div>
                  </div>
                  <div className="flex-1 bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <h4 className="text-xl font-bold text-slate-900 mb-4">Core Operations</h4>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Physical space operational (6 desks + conference)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Smart booking & access control (Seam integration)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Membership tiers & Stripe payments</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Basic member directory</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="w-32 shrink-0">
                    <div className="p-4 rounded-xl bg-amber-600 text-white text-center">
                      <div className="text-xs font-bold uppercase tracking-wider mb-1">Phase 2</div>
                      <div className="text-sm font-semibold">Q2 2026</div>
                    </div>
                  </div>
                  <div className="flex-1 bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <h4 className="text-xl font-bold text-slate-900 mb-4">Network Effects</h4>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="flex items-start gap-2">
                        <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Enhanced directory with NAICS matching</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">RFx marketplace launch & facilitation</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Regular events & community programming</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Referral system & rewards</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="w-32 shrink-0">
                    <div className="p-4 rounded-xl bg-slate-600 text-white text-center">
                      <div className="text-xs font-bold uppercase tracking-wider mb-1">Phase 3</div>
                      <div className="text-sm font-semibold">2027</div>
                    </div>
                  </div>
                  <div className="flex-1 bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                    <h4 className="text-xl font-bold text-slate-900 mb-4">Multi-Location Expansion</h4>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="flex items-start gap-2">
                        <Rocket className="h-5 w-5 text-slate-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Territory expansion model (franchise-ready)</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Rocket className="h-5 w-5 text-slate-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Multi-location member access</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Rocket className="h-5 w-5 text-slate-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Regional network effects</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Rocket className="h-5 w-5 text-slate-600 mt-0.5 shrink-0" />
                        <span className="text-sm text-slate-700">Platform licensing opportunities</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── WHY HI COWORKING ── */}
          <section className="py-20 bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-12">
                <h2 className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-3">Why Hi Coworking</h2>
                <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                  Built for an Underserved Market
                </h3>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Four key differentiators that set Hi Coworking apart in the flexible workspace landscape.
                </p>
              </div>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="flex gap-6">
                  <div className="p-4 rounded-2xl bg-emerald-100 h-fit">
                    <MapPin className="h-10 w-10 text-emerald-700" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-slate-900 mb-3">Micro-Coworking Focus</h4>
                    <p className="text-slate-600 leading-relaxed">
                      Intimate, not massive. Our 6-desk footprint creates a calm, high-trust environment where professionals can focus and build real relationships—not get lost in a sea of strangers.
                    </p>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="p-4 rounded-2xl bg-blue-100 h-fit">
                    <Network className="h-10 w-10 text-blue-700" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-slate-900 mb-3">Integrated Platform</h4>
                    <p className="text-slate-600 leading-relaxed">
                      Not just desks. We combine physical workspace with digital tools for booking, networking, procurement, and community—creating value that compounds as you engage.
                    </p>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="p-4 rounded-2xl bg-purple-100 h-fit">
                    <Shield className="h-10 w-10 text-purple-700" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-slate-900 mb-3">Procurement-Ready Network</h4>
                    <p className="text-slate-600 leading-relaxed">
                      Verified professionals only. Our identity verification and business enrichment process creates a trusted network where connections translate to real contracts and revenue opportunities.
                    </p>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="p-4 rounded-2xl bg-amber-100 h-fit">
                    <Home className="h-10 w-10 text-amber-700" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-slate-900 mb-3">Local-First Approach</h4>
                    <p className="text-slate-600 leading-relaxed">
                      Rooted in Carrollton, VA. We serve the underserved—bringing premium coworking to a community that deserves it, with deep local knowledge and commitment to regional growth.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── CALL TO ACTION ── */}
          <section className="relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-800" />
            <div className="relative z-10 max-w-4xl mx-auto px-6 py-20 md:py-32 text-center text-white">
              <h2 className="text-4xl md:text-6xl font-bold mb-6">
                Partner With Hi Coworking
              </h2>
              <p className="text-xl text-slate-200 mb-4 leading-relaxed">
                Whether you're a professional seeking workspace and community, a business looking for procurement opportunities, or an investor interested in the future of micro-coworking—we'd love to connect.
              </p>
              <p className="text-lg text-slate-300 mb-10 leading-relaxed">
                Join us in building a platform that proves premium coworking can thrive in underserved markets, creating value for members, partners, and communities alike.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-white text-slate-900 font-semibold shadow-xl hover:bg-slate-100 transition-all"
                >
                  Become a Member <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-all"
                >
                  Book a Tour
                </Link>
                <Link
                  href="/about"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full border-2 border-white/30 text-white font-semibold hover:bg-white/10 transition-all"
                >
                  Learn More
                </Link>
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </PublicSiteGate>
  );
}
