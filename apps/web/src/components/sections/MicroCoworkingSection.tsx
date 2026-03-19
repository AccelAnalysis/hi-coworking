import { Check } from "lucide-react";

const BENEFITS = [
  "Fewer desks, less distraction",
  "Short-term and flexible use",
  "Professional environment, no overhead",
  "Space designed for productivity, not spectacle",
];

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
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4 translate-y-8">
            <div className="bg-slate-50/50 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
              <div className="text-3xl mb-2 grayscale opacity-50">🚫</div>
              <div className="font-semibold text-slate-400 line-through">Massive Floors</div>
            </div>
            <div className="bg-white/70 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
              <div className="text-3xl mb-2">✨</div>
              <div className="font-semibold">Calm Focus</div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-emerald-50/50 backdrop-blur-md p-8 rounded-2xl border border-emerald-100/50 shadow-xl shadow-slate-200/50">
              <div className="text-3xl mb-2">📍</div>
              <div className="font-semibold text-emerald-900">Local Use</div>
            </div>
            <div className="bg-slate-50/50 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
              <div className="text-3xl mb-2 grayscale opacity-50">🚫</div>
              <div className="font-semibold text-slate-400 line-through">Long Contracts</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
