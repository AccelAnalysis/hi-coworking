import type { ReactNode } from "react";
import { Check } from "lucide-react";

const BENEFITS = [
  "Fewer desks, less distraction",
  "Short-term and flexible use",
  "Professional environment, no overhead",
  "Space designed for productivity, not spectacle",
];

type PrincipleTone = "neutral" | "positive" | "featured";

type PrincipleCardProps = {
  eyebrow: "Not about" | "Built around";
  title: string;
  tone: PrincipleTone;
  illustration: ReactNode;
};

function PrincipleCard({ eyebrow, title, tone, illustration }: PrincipleCardProps) {
  const surface =
    tone === "featured"
      ? "bg-emerald-50/70 border-emerald-100"
      : tone === "positive"
        ? "bg-white/80 border-slate-200/70"
        : "bg-slate-50/70 border-slate-200/80";
  const iconTone = tone === "featured" ? "text-emerald-900" : "text-slate-700";
  const eyebrowTone = tone === "neutral" ? "text-slate-400" : "text-emerald-700";

  return (
    <div
      className={`${surface} min-h-44 rounded-[1.4rem] border p-6 md:p-7 shadow-sm backdrop-blur-md flex flex-col justify-between gap-6`}
    >
      <div
        className={`w-14 h-14 rounded-2xl border border-slate-200/80 bg-white/80 ${iconTone} flex items-center justify-center`}
        aria-hidden="true"
      >
        {illustration}
      </div>
      <div>
        <div className={`${eyebrowTone} text-[0.68rem] font-bold tracking-[0.18em] uppercase mb-1.5`}>
          {eyebrow}
        </div>
        <div className="font-semibold text-slate-900 leading-tight">{title}</div>
      </div>
    </div>
  );
}

function MassiveFloorsIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 51V16h30v35" />
      <path d="M13 51h38" />
      <path d="M23 23h6M35 23h6M23 30h6M35 30h6M23 37h6M35 37h6" />
      <path d="M29 51v-7h6v7" />
    </svg>
  );
}

function CalmFocusIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 40h36" />
      <path d="M20 40v12M44 40v12" />
      <path d="M24 31h14v9H24z" />
      <path d="M43 38V23l6-7" />
      <path d="M46 18h8" />
      <path d="M28 27h6" />
    </svg>
  );
}

function LocalUseIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 28h29v24H14z" />
      <path d="M11 28l4-10h27l4 10" />
      <path d="M20 52V40h9v12M34 36h5" />
      <path d="M49 22c0 5-6 11-6 11s-6-6-6-11a6 6 0 1 1 12 0Z" />
      <circle cx="43" cy="22" r="2" />
    </svg>
  );
}

function LongContractsIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 12h20l8 8v32H18z" />
      <path d="M38 12v9h8" />
      <path d="M24 29h16M24 35h16M24 41h10" />
      <path d="M39 47c2-3 5-4 8-2l2 1" />
      <path d="M49 46l3 2-3 3" />
    </svg>
  );
}

function MicroCoworkingPrinciples() {
  return (
    <div className="grid grid-cols-2 gap-4" aria-label="What micro-coworking prioritizes">
      <div className="space-y-4 translate-y-8">
        <PrincipleCard
          eyebrow="Not about"
          title="Massive Floors"
          tone="neutral"
          illustration={<MassiveFloorsIllustration />}
        />
        <PrincipleCard
          eyebrow="Built around"
          title="Calm Focus"
          tone="positive"
          illustration={<CalmFocusIllustration />}
        />
      </div>
      <div className="space-y-4">
        <PrincipleCard
          eyebrow="Built around"
          title="Local Use"
          tone="featured"
          illustration={<LocalUseIllustration />}
        />
        <PrincipleCard
          eyebrow="Not about"
          title="Long Contracts"
          tone="neutral"
          illustration={<LongContractsIllustration />}
        />
      </div>
    </div>
  );
}

export function MicroCoworkingSection() {
  return (
    <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="grid md:grid-cols-2 gap-16 items-center">
        <div className="space-y-6">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">What is a Micro-Coworking Space?</h2>
          <p className="text-lg text-slate-600 leading-relaxed">
            It&apos;s intentionally intimate. Instead of hundreds of desks and constant noise, Hi Coworking offers a calm, efficient workspace built around how people actually work today.
          </p>
          <ul className="space-y-4 pt-4">
            {BENEFITS.map((item, i) => (
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
        <MicroCoworkingPrinciples />
      </div>
    </section>
  );
}
