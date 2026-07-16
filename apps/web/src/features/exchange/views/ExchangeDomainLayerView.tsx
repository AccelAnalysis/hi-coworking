import Link from "next/link";
import { BookOpenText, BriefcaseBusiness, MapPinned, Users } from "lucide-react";
import { ExchangeViewTabs } from "../components/ExchangeViewTabs";
import type { ExchangeView } from "../state/exchangeWorkspaceTypes";

const COPY = {
  businesses: {
    icon: BriefcaseBusiness,
    eyebrow: "Available now",
    title: "Business discovery",
    body: "Explore claimable, claimed, and verified businesses serving the launch market. Public profiles preserve source provenance while owner-controlled details follow the protected claim workflow.",
    primary: ["Complete or claim a profile", "/profile"],
  },
  teaming: {
    icon: Users,
    eyebrow: "Available now",
    title: "Teaming and partner discovery",
    body: "Use opportunity context, capability alignment, and existing RFx team workflows to identify potential collaborators without creating a separate primary application.",
    primary: ["View opportunity matches", "/exchange?view=opportunities"],
  },
  resources: {
    icon: BookOpenText,
    eyebrow: "Available now",
    title: "Economic-development resources",
    body: "Find launch-market support beside business, opportunity, referral, and intelligence layers. Existing provenance-ready records remain authoritative while new external ingestion is deferred.",
    primary: ["Explore launch opportunities", "/exchange?view=opportunities"],
  },
} as const;

export function ExchangeDomainLayerView({ view, onViewChange }: {
  view: "businesses" | "teaming" | "resources";
  onViewChange: (view: ExchangeView) => void;
}) {
  const copy = COPY[view];
  const Icon = copy.icon;
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 py-2 text-white sm:px-4">
        <ExchangeViewTabs view={view} onChange={onViewChange} />
        <span className="ml-auto hidden text-xs font-bold text-slate-400 sm:block">Isle of Wight County launch market</span>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[23rem_1fr]">
        <aside className="z-10 overflow-y-auto border-r border-slate-200 bg-white p-6 shadow-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800"><Icon className="h-4 w-4" />{copy.eyebrow}</div>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950">{copy.title}</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">{copy.body}</p>
          <Link href={copy.primary[1]} className="mt-7 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white">{copy.primary[0]}</Link>
          <div className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-xs leading-5 text-indigo-950">Commercial actions, organization verification, and credits remain server-authoritative. This layer never grants access from browser-only state.</div>
        </aside>
        <section className="relative min-h-[28rem] overflow-hidden bg-[#dce8e2]" aria-label={`${copy.title} map layer`}>
          <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_25%_35%,#fff_0_2px,transparent_3px),radial-gradient(circle_at_70%_60%,#fff_0_2px,transparent_3px),linear-gradient(135deg,transparent_35%,#b8cec3_36%_38%,transparent_39%),linear-gradient(35deg,transparent_52%,#c5d9cf_53%_55%,transparent_56%)] [background-size:180px_180px,240px_240px,100%_100%,100%_100%]" />
          <div className="absolute left-[28%] top-[34%] rounded-full border-4 border-white bg-indigo-600 p-3 text-white shadow-2xl"><MapPinned className="h-6 w-6" /></div>
          <div className="absolute bottom-5 left-5 rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-lg backdrop-blur"><p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Launch market</p><p className="mt-1 text-sm font-bold text-slate-900">Located here · Serves here · Future expansion</p></div>
        </section>
      </div>
    </div>
  );
}
