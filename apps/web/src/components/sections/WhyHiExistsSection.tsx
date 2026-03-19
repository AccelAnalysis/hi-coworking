import { Users, Briefcase, Wallet, TrendingUp } from "lucide-react";

const REASONS = [
  { icon: Users, title: "Support Locals", text: "Support people who live here and work remotely." },
  { icon: Briefcase, title: "Accelerate Growth", text: "Create room for businesses to grow into their potential." },
  { icon: Wallet, title: "Build Local Economy", text: "Grow mid-day, professional work activity right here." },
];

export function WhyHiExistsSection() {
  return (
    <section className="py-20 md:py-32 px-6 md:px-12 max-w-7xl mx-auto">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-xs font-semibold tracking-wide uppercase border border-blue-100 mb-6">
            <TrendingUp size={12} /> Why This Matters Locally
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 tracking-tight">Why Hi Coworking Exists</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {REASONS.map((item, i) => (
            <div key={i} className="text-center p-6 rounded-2xl bg-white/40 border border-white/60 backdrop-blur-sm hover:bg-white/60 transition-colors">
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
  );
}
