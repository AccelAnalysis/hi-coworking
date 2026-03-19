"use client";

import { useState } from "react";
import { Mail, MapPin, Clock, Phone, Loader2, CheckCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackgroundGradients } from "@/components/BackgroundGradients";
import { PublicSiteGate } from "@/components/PublicSiteGate";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const submitContact = httpsCallable<
  { name: string; email: string; message: string; source: string },
  { success: boolean }
>(functions, "leads_submitContact");

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await submitContact({ name: name.trim(), email: email.trim(), message: message.trim(), source: "contact_page" });
      setSent(true);
    } catch (err) {
      console.error("Contact form error:", err);
      setError("Failed to send message. Please try again or email us directly.");
    } finally {
      setSending(false);
    }
  };

  return (
    <PublicSiteGate>
      <AppShell>
      <div className="relative">
        <BackgroundGradients />

      <section className="py-20 md:py-32 px-6 md:px-12 max-w-5xl mx-auto relative z-10">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-slate-900 mb-6">Get in Touch</h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-light">
            Have a question or want to learn more? We&apos;d love to hear from you.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          {/* Contact Form */}
          <div className="bg-white/70 backdrop-blur-md p-8 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Send us a message</h2>
            {sent ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-12 w-12 text-emerald-500 mb-4" />
                <h3 className="text-lg font-bold text-slate-900 mb-1">Message sent!</h3>
                <p className="text-sm text-slate-500">We&apos;ll get back to you soon.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">{error}</div>
                )}
                <div>
                  <label className="text-sm font-semibold text-slate-700">Name</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 transition-all"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 transition-all"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700">Message</label>
                  <textarea
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-slate-900 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full py-3 bg-slate-900 text-white rounded-full font-medium hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : "Send Message"}
                </button>
              </form>
            )}
          </div>

          {/* Contact Info */}
          <div className="space-y-6">
            {[
              { icon: MapPin, title: "Location", text: "Carrollton, VA" },
              { icon: Mail, title: "Email", text: "hicoworking@accelanalysis.com" },
              { icon: Phone, title: "Phone", text: "757-236-0651" },
              { icon: Clock, title: "Hours", text: "Mon–Fri, 8am – 6pm" },
            ].map((item, i) => (
              <div key={i} className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white/50 shadow-xl shadow-slate-200/50 flex items-start gap-4">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
                  <item.icon size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">{item.title}</h3>
                  <p className="text-slate-600">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      </div>
      </AppShell>
    </PublicSiteGate>
  );
}
