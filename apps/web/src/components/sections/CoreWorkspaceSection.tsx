import { Check, Coffee, Users, Mic, Printer, Mail, Calendar } from "lucide-react";

export const CORE_FEATURES = [
  "Flexible desk seating",
  "Half-day and full-day access",
  "Fast, reliable internet",
  "Quiet-first layout",
  "Clean, professional environment",
];

export const ADD_ONS = [
  { icon: Coffee, label: "Private Focus Desks" },
  { icon: Users, label: "Small Meeting Room" },
  { icon: Mic, label: "Podcast Setup" },
  { icon: Printer, label: "Printing & Scan" },
  { icon: Mail, label: "Mail Address" },
  { icon: Calendar, label: "Workshops" },
];

interface CoreWorkspaceSectionProps {
  variant?: "dark" | "light";
}

export function CoreWorkspaceSection({ variant = "light" }: CoreWorkspaceSectionProps) {
  if (variant === "dark") {
    return <CoreWorkspaceDark />;
  }
  return <CoreWorkspaceLight />;
}

function CoreWorkspaceDark() {
  return (
    <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="bg-slate-900 text-white rounded-[2.5rem] relative overflow-hidden shadow-2xl shadow-slate-900/20 p-10 md:p-16">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative z-10">
          <div className="md:flex justify-between items-end mb-12 border-b border-slate-800 pb-8">
            <div className="max-w-xl">
              <h2 className="text-3xl font-bold mb-4 tracking-tight">What We&apos;re Building (Together)</h2>
              <p className="text-slate-400">
                Hi Coworking will open in phases. Some services launch immediately. Others will be added based on real interest and local demand.
              </p>
            </div>
            <div className="hidden md:block text-right">
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
                {CORE_FEATURES.map((item, i) => (
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
                <h3 className="text-xl font-bold">Possible Add-Ons</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {ADD_ONS.map((item, i) => (
                  <div key={i} className="bg-white/5 hover:bg-white/10 transition-colors p-4 rounded-xl border border-white/5 flex items-center gap-3 text-sm text-slate-300 cursor-default">
                    <item.icon className="w-4 h-4 text-slate-500" />
                    {item.label}
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm text-slate-500 italic">
                &ldquo;We&apos;re building the right things—not the most things.&rdquo;
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CoreWorkspaceLight() {
  return (
    <section className="py-16 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="grid md:grid-cols-2 gap-12 items-start">
        <div className="bg-white/70 backdrop-blur-md p-8 md:p-10 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
              <Check size={20} strokeWidth={3} />
            </div>
            <h2 className="text-2xl font-bold">Core Workspace (Day One)</h2>
          </div>
          <p className="text-slate-600 mb-6">Everything you need to sit down and get to work. No frills, no friction.</p>
          <ul className="space-y-4">
            {CORE_FEATURES.map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white/70 backdrop-blur-md p-8 md:p-10 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
              <Users size={20} />
            </div>
            <h2 className="text-2xl font-bold">Possible Add-Ons</h2>
          </div>
          <p className="text-slate-600 mb-6">These features will be added based on real interest and local demand.</p>
          <div className="grid grid-cols-2 gap-3">
            {ADD_ONS.map((item, i) => (
              <div key={i} className="bg-slate-50/80 p-4 rounded-xl border border-slate-100 flex items-center gap-3 text-sm text-slate-700">
                <item.icon className="w-4 h-4 text-slate-400" />
                {item.label}
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-500 italic">
            &ldquo;We&apos;re building the right things—not the most things.&rdquo;
          </p>
        </div>
      </div>
    </section>
  );
}
