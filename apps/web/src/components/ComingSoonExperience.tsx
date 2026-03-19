"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Script from "next/script";
import { useMemo, useState } from "react";
import type { ComponentType, FormEvent } from "react";
import {
  ArrowRight,
  Briefcase,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coffee,
  Loader2,
  Mail,
  MapPin,
  Mic,
  Printer,
  Store,
  TrendingUp,
  Users,
  Wallet,
  Wifi,
  X,
} from "lucide-react";

const MapComponent = dynamic(
  () => import("@/components/MapComponent").then((m) => m.MapComponent),
  { ssr: false, loading: () => <div className="w-full h-64 md:h-80 rounded-2xl bg-slate-100 animate-pulse" /> }
);

type SurveyQuestion = {
  id: number;
  question: string;
  type: "single" | "multi" | "multi-limit-2" | "text";
  options?: string[];
  placeholder?: string;
};

const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: 1,
    question: "How do you currently work most days?",
    type: "single",
    options: [
      "From home",
      "From home, but I need a change",
      "Coffee shops / public spaces",
      "Client site / on the road",
      "Office outside immediate area",
      "Other",
    ],
  },
  {
    id: 2,
    question: "How often would you realistically use a local coworking space?",
    type: "single",
    options: ["A few times per month", "About once per week", "2-3 days per week", "4-5 days per week", "Only occasionally"],
  },
  {
    id: 3,
    question: "What would be your primary reason for using Hi Coworking?",
    type: "multi-limit-2",
    options: ["Focus and productivity", "Separation from home", "Professional setting", "Reliable internet", "Networking", "Specific amenities"],
  },
  {
    id: 4,
    question: "Which of the following would you actually use?",
    type: "multi",
    options: ["Open desk seating", "Quiet / focus desks", "Small meeting room", "Phone / video call area", "Printing / scanning", "Mail handling", "Podcast setup", "Workshops"],
  },
  {
    id: 5,
    question: "When you're working, which matters more to you?",
    type: "single",
    options: ["Quiet and minimal distractions", "Balance of quiet and light interaction", "Energy and conversation", "It depends on the day"],
  },
  {
    id: 6,
    question: "What makes a coworking space not worth using for you?",
    type: "multi-limit-2",
    options: ["Too loud / distracting", "Too expensive", "Hard to access", "Long-term commitments", "Overcrowded", "Poor internet"],
  },
  {
    id: 7,
    question: "How far would you be willing to travel to use a coworking space?",
    type: "single",
    options: ["Under 5 minutes", "5-10 minutes", "10-15 minutes", "15-25 minutes", "Only if I'm already there"],
  },
  {
    id: 8,
    question: "Which pricing style feels most reasonable?",
    type: "single",
    options: ["Half-day access", "Full-day access", "Multi-day packs", "Monthly (no contract)", "Pay-as-you-go"],
  },
  {
    id: 9,
    question: "If Hi Coworking opened tomorrow, what would make you try it?",
    type: "text",
    placeholder: "e.g., A free trial day, meeting other locals...",
  },
  {
    id: 10,
    question: "If you could design the perfect shared workspace for your area, what would it include?",
    type: "text",
    placeholder: "e.g., specific coffee, standing desks...",
  },
];

type FormStatus = "idle" | "submitting" | "success" | "error";

const LEADS_SUBMIT_URL =
  process.env.NEXT_PUBLIC_LEADS_SUBMIT_URL ||
  "https://us-central1-hi-coworking-ops.cloudfunctions.net/leads_submitLead";
const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

export function ComingSoonExperience() {
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [formStatus, setFormStatus] = useState<FormStatus>("idle");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
    intent: "updates",
    interests: [] as string[],
  });

  const interests = useMemo(
    () => ["Desk access", "Meeting space", "Business address", "Podcast / Recording", "Events"],
    []
  );

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleInterest = (interest: string) => {
    setFormData((prev) => {
      const exists = prev.interests.includes(interest);
      return {
        ...prev,
        interests: exists ? prev.interests.filter((i) => i !== interest) : [...prev.interests, interest],
      };
    });
  };

  const handleEarlyAccessSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormStatus("submitting");
    const ok = await submitLead({
      type: "early_access",
      ...formData,
      source: "web-coming-soon",
      submission_version: "3.0",
      timestamp: new Date().toISOString(),
    });
    setFormStatus(ok ? "success" : "error");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 relative overflow-hidden">
      {RECAPTCHA_SITE_KEY && (
        <Script src={`https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`} strategy="afterInteractive" />
      )}

      <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-slate-300/20 blur-[120px] pointer-events-none" />

      <nav className="sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-white/30">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-4 flex items-center justify-between">
          <div className="font-bold text-xl tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded-2xl rounded-bl-none flex items-center justify-center text-white text-sm font-bold">Hi</div>
            <span>Coworking</span>
          </div>
          <div className="hidden md:flex gap-6 text-sm font-medium text-slate-600">
            <button onClick={() => scrollToSection("concept")} className="hover:text-slate-900 transition-colors">Concept</button>
            <button onClick={() => scrollToSection("impact")} className="hover:text-slate-900 transition-colors">Local Impact</button>
            <button onClick={() => scrollToSection("ecosystem")} className="hover:text-slate-900 transition-colors">Ecosystem</button>
            <button onClick={() => scrollToSection("access")} className="hover:text-slate-900 transition-colors">Early Access</button>
          </div>
          <button
            onClick={() => scrollToSection("access")}
            className="px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Get Early Access
          </button>
        </div>
      </nav>

      <header className="pt-16 pb-20 md:pt-24 md:pb-28 px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/60 text-emerald-800 text-xs font-semibold uppercase border border-emerald-100 shadow-sm">
            <MapPin size={12} /> Space opening soon
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Big ideas.<br />
            <span className="text-slate-400">Intimate space.</span>
          </h1>
          <p className="text-lg md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
            Space rentals are launching when the physical space is fully operational. While we build the space,
            you can start using the ecosystem now.
          </p>
          <MapComponent />
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <button
              onClick={() => scrollToSection("ecosystem")}
              className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-slate-900 text-white hover:bg-slate-800 shadow-xl shadow-slate-900/10 transition-all"
            >
              Explore the Ecosystem <ArrowRight size={18} className="ml-2" />
            </button>
            <button
              onClick={() => setSurveyOpen(true)}
              className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-white/80 text-slate-900 border border-slate-200 hover:bg-white transition-all"
            >
              Shape the Space
            </button>
          </div>
        </div>
      </header>

      {/* Concept Section */}
      <section id="concept" className="py-16 md:py-24 px-6 md:px-12 max-w-7xl mx-auto relative z-10">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">What is a Micro-Coworking Space?</h2>
            <p className="text-lg text-slate-600 leading-relaxed">
              It&apos;s intentionally intimate. Instead of hundreds of desks and constant noise, Hi Coworking offers a calm, efficient workspace built around how people actually work today.
            </p>
            <ul className="space-y-4 pt-4">
              {[
                "Fewer desks, less distraction",
                "Short-term and flexible use",
                "Professional environment, no overhead",
                "Space designed for productivity, not spectacle",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-slate-700">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                    <Check size={14} strokeWidth={3} />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
            <div className="pt-4 font-medium text-slate-900 italic">
              &ldquo;Big ideas don&apos;t require big buildings.&rdquo;
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4 translate-y-8">
              <div className="bg-slate-50/80 backdrop-blur-md p-8 rounded-2xl border border-slate-200/50 shadow-sm">
                <div className="text-3xl mb-2 grayscale opacity-50">🚫</div>
                <div className="font-semibold text-slate-400 line-through">Massive Floors</div>
              </div>
              <div className="bg-white/80 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
                <div className="text-3xl mb-2">✨</div>
                <div className="font-semibold">Calm Focus</div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="bg-emerald-50/70 backdrop-blur-md p-8 rounded-2xl border border-emerald-100/50 shadow-sm">
                <div className="text-3xl mb-2">📍</div>
                <div className="font-semibold text-emerald-900">Local Use</div>
              </div>
              <div className="bg-slate-50/80 backdrop-blur-md p-8 rounded-2xl border border-slate-200/50 shadow-sm">
                <div className="text-3xl mb-2 grayscale opacity-50">🚫</div>
                <div className="font-semibold text-slate-400 line-through">Long Contracts</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Who It's For */}
      <section className="py-16 md:py-24 px-6 md:px-12 max-w-7xl mx-auto relative z-10">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Who Hi Coworking Is For</h2>
          <p className="text-slate-600">If any of this sounds familiar, you&apos;re in the right place.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {([
            { icon: Wifi, title: "Remote Workers", desc: "Need separation from home to actually get things done." },
            { icon: Briefcase, title: "Independent Owners", desc: "Owners who don\u2019t yet need a full office lease." },
            { icon: Users, title: "Consultants", desc: "Analysts, creatives, and builders who value focus." },
            { icon: MapPin, title: "Locals", desc: "People who want a workspace nearby\u2014not a commute." },
          ] as { icon: ComponentType<{ className?: string }>; title: string; desc: string }[]).map((card, i) => (
            <div key={i} className="group bg-white/80 border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-1 hover:border-emerald-200/50 transition-all duration-300">
              <card.icon className="w-10 h-10 text-slate-400 group-hover:text-emerald-600 transition-colors mb-4" />
              <h3 className="font-bold text-lg mb-2">{card.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Hi Coworking Exists */}
      <section id="impact" className="py-16 md:py-24 px-6 md:px-12 relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-xs font-semibold tracking-wide uppercase border border-blue-100 mb-6">
              <TrendingUp size={12} /> Why This Matters Locally
            </div>
            <h2 className="text-3xl md:text-4xl font-bold">Why Hi Coworking Exists</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {([
              { icon: Users, title: "Support Locals", text: "Support people who live here and work remotely." },
              { icon: Briefcase, title: "Accelerate Growth", text: "Create room for businesses to grow into their potential." },
              { icon: Wallet, title: "Build Local Economy", text: "Grow mid-day, professional work activity right here." },
            ] as { icon: ComponentType<{ size: number }>; title: string; text: string }[]).map((item, i) => (
              <div key={i} className="text-center p-6 rounded-2xl bg-white/60 border border-white/60 backdrop-blur-sm hover:bg-white/80 transition-colors shadow-sm">
                <div className="w-12 h-12 bg-white rounded-xl shadow-lg shadow-slate-200/50 text-slate-900 flex items-center justify-center mx-auto mb-4">
                  <item.icon size={24} />
                </div>
                <h3 className="font-bold text-lg mb-2 text-slate-900">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What We're Building (Together) */}
      <section className="py-16 md:py-24 px-6 md:px-12 max-w-7xl mx-auto relative z-10">
        <div className="bg-slate-900 text-white rounded-[2.5rem] relative overflow-hidden px-8 md:px-16 py-16 shadow-2xl shadow-slate-900/20">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />
          <div className="relative z-10">
            <div className="md:flex justify-between items-end mb-12 border-b border-slate-800 pb-8">
              <div className="max-w-xl">
                <h2 className="text-3xl font-bold mb-4">What We&apos;re Building (Together)</h2>
                <p className="text-slate-400">
                  Hi Coworking will open in phases. Some services launch immediately. Others will be added based on real interest and local demand.
                </p>
              </div>
              <div className="hidden md:block text-right mt-4 md:mt-0">
                <div className="text-sm text-slate-500 uppercase tracking-wider font-semibold mb-1">Status</div>
                <div className="flex items-center gap-2 text-emerald-400 font-medium">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  Finalizing Layout
                </div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-12">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm">
                    <Check className="text-white w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold">Core Workspace (Day One)</h3>
                </div>
                <ul className="space-y-4 pl-4 border-l border-slate-800">
                  {[
                    "Flexible desk seating",
                    "Half-day and full-day access",
                    "Fast, reliable internet",
                    "Quiet-first layout",
                    "Clean, professional environment",
                  ].map((item, i) => (
                    <li key={i} className="text-slate-300 flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm">
                    <Users className="text-white w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold">Possible Add-Ons (Vote)</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { icon: Coffee, label: "Private Focus Desks" },
                    { icon: Users, label: "Small Meeting Room" },
                    { icon: Mic, label: "Podcast Setup" },
                    { icon: Printer, label: "Printing & Scan" },
                    { icon: Mail, label: "Mail Address" },
                    { icon: Calendar, label: "Workshops" },
                  ].map((item, i) => (
                    <div key={i} className="bg-white/5 hover:bg-white/10 transition-colors p-4 rounded-xl border border-white/5 flex items-center gap-3 text-sm text-slate-300">
                      <item.icon className="w-4 h-4 text-slate-500" />
                      {item.label}
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-sm text-slate-500 italic">
                  &ldquo;We&apos;re building the right things&mdash;not the most things.&rdquo;
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Survey Callout */}
      <section id="community" className="py-12 px-6 md:px-12 max-w-7xl mx-auto relative z-10">
        <div className="bg-emerald-50/70 backdrop-blur-md rounded-2xl p-8 md:p-12 text-center max-w-4xl mx-auto border border-emerald-100 shadow-xl shadow-emerald-100/50">
          <h2 className="text-2xl md:text-3xl font-bold text-emerald-950 mb-4">Help Shape the Space</h2>
          <p className="text-emerald-800 mb-8 max-w-2xl mx-auto">
            Hi Coworking isn&apos;t being designed in a vacuum. Before opening, we&apos;re collecting input from the people who will actually use the space.
          </p>
          <button
            onClick={() => setSurveyOpen(true)}
            className="inline-flex items-center justify-center px-6 py-3 rounded-full font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 transition-colors"
          >
            Take the 2-Minute Survey
          </button>
          <p className="mt-4 text-xs text-emerald-700 uppercase tracking-wide font-semibold">
            Short survey. Real influence.
          </p>
        </div>
      </section>

      <section id="ecosystem" className="py-16 md:py-24 px-6 md:px-12 max-w-7xl mx-auto relative z-10">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">While We Build the Space, You Can Start Using the Ecosystem Now</h2>
          <p className="text-slate-600 max-w-3xl mx-auto">
            Hi Coworking is opening soon - and you do not have to wait to plug in.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Card
            icon={ClipboardList}
            title="Explore the RFx Exchange"
            description="Register now to build and schedule RFx releases. Pre-launch access is private - get ready. Browsing and responding to RFx opportunities begins March 16th."
            ctaLabel="Register for the RFx Exchange"
            href="/rfx"
          />
          <Card
            icon={Calendar}
            title="Register for Upcoming Events"
            description="Reserve your seat for workshops, meetups, and working sessions. Some events are in-person (limited seats), and some are virtual (unlimited)."
            ctaLabel="View Events & Register"
            href="/events"
          />
          <Card
            icon={Store}
            title="Visit the Bookstore"
            description="Explore curated series and featured reads - including our 'What I'm Reading Now' section."
            ctaLabel="Browse the Bookstore"
            href="/bookstore"
          />
        </div>
      </section>

      <section id="access" className="py-16 md:py-24 px-6 md:px-12 max-w-7xl mx-auto border-t border-slate-200 relative z-10">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-3">Get Early Access</h2>
            <p className="text-slate-600">
              Join the list for launch updates and early booking invitations.
            </p>
          </div>

          {formStatus === "success" ? (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-8 text-center">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={28} />
              </div>
              <h3 className="text-xl font-bold text-emerald-950 mb-2">Thank you - you&apos;re on the list.</h3>
              <p className="text-emerald-800">We will share meaningful updates as launch milestones are finalized.</p>
            </div>
          ) : (
            <form onSubmit={handleEarlyAccessSubmit} className="bg-white/80 border border-slate-200 rounded-2xl p-6 md:p-8 space-y-5 shadow-sm">
              {formStatus === "error" && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                  Submission failed. Please try again.
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <Input label="Name" value={formData.name} onChange={(v) => setFormData((p) => ({ ...p, name: v }))} required />
                <Input label="Email" type="email" value={formData.email} onChange={(v) => setFormData((p) => ({ ...p, email: v }))} required />
              </div>

              <fieldset>
                <legend className="text-sm font-medium text-slate-700 mb-2">I&apos;m interested in...</legend>
                <div className="grid grid-cols-2 gap-2">
                  {interests.map((opt) => {
                    const checked = formData.interests.includes(opt);
                    return (
                      <label
                        key={opt}
                        className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          checked ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleInterest(opt)} />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <label className="text-sm font-medium text-slate-700">Optional Message</label>
                <textarea
                  rows={3}
                  value={formData.message}
                  onChange={(e) => setFormData((p) => ({ ...p, message: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                  placeholder="What would you like to see in the space?"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="intent"
                    checked={formData.intent === "updates"}
                    onChange={() => setFormData((p) => ({ ...p, intent: "updates" }))}
                  />
                  I&apos;d like launch updates
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="intent"
                    checked={formData.intent === "exploring"}
                    onChange={() => setFormData((p) => ({ ...p, intent: "exploring" }))}
                  />
                  I&apos;m exploring options
                </label>
              </div>

              <button
                type="submit"
                disabled={formStatus === "submitting"}
                className="w-full inline-flex justify-center items-center gap-2 px-5 py-3 rounded-full bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors disabled:opacity-60"
              >
                {formStatus === "submitting" ? <><Loader2 className="h-4 w-4 animate-spin" /> Joining...</> : "Join Early Access"}
              </button>
            </form>
          )}
        </div>
      </section>

      {surveyOpen && <SurveyModal onClose={() => setSurveyOpen(false)} />}
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  description,
  ctaLabel,
  href,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
}) {
  return (
    <article className="bg-white/80 border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mb-4">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed mb-6">{description}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
      >
        {ctaLabel}
      </Link>
    </article>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
      />
    </div>
  );
}

function SurveyModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  const q = SURVEY_QUESTIONS[step];
  const progress = ((step + 1) / SURVEY_QUESTIONS.length) * 100;

  const setSingle = (value: string) => {
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    setTimeout(() => setStep((s) => Math.min(s + 1, SURVEY_QUESTIONS.length - 1)), 180);
  };

  const toggleMulti = (value: string) => {
    const current = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
    const hasLimit = q.type === "multi-limit-2";
    const atLimit = hasLimit && current.length >= 2;
    setAnswers((prev) => ({
      ...prev,
      [q.id]: current.includes(value)
        ? current.filter((v) => v !== value)
        : atLimit
          ? current
          : [...current, value],
    }));
  };

  const next = async () => {
    if (step < SURVEY_QUESTIONS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    setIsSubmitting(true);
    await submitLead({
      type: "survey",
      name: "Survey Respondent",
      email: "anonymous@survey.local",
      answers,
      source: "web-coming-soon",
      submission_version: "4.0",
      timestamp: new Date().toISOString(),
    });
    setIsSubmitting(false);
    setCompleted(true);
  };

  if (completed) {
    return (
      <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-lg p-8 text-center">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={28} />
          </div>
          <h3 className="text-2xl font-bold mb-3">Thank you</h3>
          <p className="text-slate-600 mb-6">Your input has been recorded and will help shape launch priorities.</p>
          <button onClick={onClose} className="px-5 py-2 rounded-full bg-slate-900 text-white hover:bg-slate-800">Back to site</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl h-[620px] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Question {step + 1} of {SURVEY_QUESTIONS.length}
            </p>
            <div className="w-40 h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-slate-900" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={22} /></button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <h3 className="text-2xl font-bold text-slate-900 mb-6">{q.question}</h3>

          <div className="space-y-3">
            {q.type !== "text" && q.options?.map((opt) => {
              const selected = q.type === "single"
                ? answers[q.id] === opt
                : Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt);
              const selectedCount = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]).length : 0;
              const disabled = q.type === "multi-limit-2" && !selected && selectedCount >= 2;

              return (
                <button
                  key={opt}
                  disabled={disabled}
                  onClick={() => (q.type === "single" ? setSingle(opt) : toggleMulti(opt))}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    selected
                      ? "border-slate-900 bg-slate-50"
                      : disabled
                        ? "border-slate-200 bg-slate-50/40 text-slate-400 cursor-not-allowed"
                        : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {opt}
                </button>
              );
            })}

            {q.type === "text" && (
              <textarea
                autoFocus
                value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder={q.placeholder}
                className="w-full h-40 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1 text-sm text-slate-500 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <button
            onClick={next}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
          >
            {isSubmitting ? "Sending..." : step === SURVEY_QUESTIONS.length - 1 ? "Finish" : "Next"}
            {!isSubmitting && step !== SURVEY_QUESTIONS.length - 1 && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

async function submitLead(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const recaptchaToken = await getRecaptchaToken(payload.type === "survey" ? "survey" : "early_access");
    const resp = await fetch(LEADS_SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, recaptchaToken }),
    });
    return resp.ok;
  } catch (err) {
    console.error("submitLead failed", err);
    return false;
  }
}

async function getRecaptchaToken(action: string): Promise<string | null> {
  if (!RECAPTCHA_SITE_KEY) return null;
  if (typeof window === "undefined") return null;
  const grecaptcha = (window as Window & { grecaptcha?: { execute: (key: string, opts: { action: string }) => Promise<string> } }).grecaptcha;
  if (!grecaptcha) return null;
  try {
    return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
  } catch {
    return null;
  }
}
