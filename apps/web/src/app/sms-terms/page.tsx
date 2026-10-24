import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "SMS Terms | Hi Coworking",
  description: "Terms for Hi Coworking event texts: message types, frequency, rates, and how to opt out or get help.",
  alternates: { canonical: "/sms-terms" },
};

export default function SmsTermsPage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-6">SMS Terms</h1>

        <div className="prose prose-slate max-w-none text-sm text-slate-600 space-y-6">
          <h2 className="text-lg font-bold text-slate-900">Program</h2>
          <p>
            <strong>Hi Coworking event texts</strong> are sent by Hi Coworking (Accel Analysis LLC)
            to people who opt in on our website, when they sign up, update their preferences, or
            apply to an event. Opting in is optional and is never a condition of membership,
            purchase, or applying for an event.
          </p>

          <h2 className="text-lg font-bold text-slate-900">Messages you may get</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Invitations to Hi Coworking events</li>
            <li>Reminders for events you registered for or applied to</li>
            <li>Updates and follow-ups about those events</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-900">Frequency and cost</h2>
          <p>
            Message frequency varies. Msg &amp; data rates may apply. Check with your mobile carrier
            for details about your plan.
          </p>

          <h2 className="text-lg font-bold text-slate-900">Opt out and help</h2>
          <p>
            Reply <strong>STOP</strong> to any message to opt out. You&apos;ll get one message
            confirming you&apos;re opted out, and no more texts after that. You can also turn texts
            off on your <Link href="/preferences" className="font-semibold text-sky-800 underline underline-offset-2">preferences page</Link>.
          </p>
          <p>
            Reply <strong>HELP</strong> for help, or email{" "}
            <a href="mailto:hello@hi-coworking.com" className="font-semibold text-sky-800 underline underline-offset-2">hello@hi-coworking.com</a>.
          </p>

          <h2 className="text-lg font-bold text-slate-900">Carriers</h2>
          <p>Carriers are not liable for delayed or undelivered messages.</p>

          <h2 className="text-lg font-bold text-slate-900">Privacy</h2>
          <p>
            Mobile information will not be shared with third parties or affiliates for marketing or
            promotional purposes. Text messaging originator opt-in data and consent will not be
            shared with any third parties. See our{" "}
            <Link href="/privacy#sms" className="font-semibold text-sky-800 underline underline-offset-2">Privacy Policy</Link>{" "}
            and{" "}
            <Link href="/terms" className="font-semibold text-sky-800 underline underline-offset-2">Terms of Service</Link>.
          </p>

          <p className="text-xs text-slate-400 pt-4 border-t border-slate-200">
            Last updated: October 2026. Questions? Contact us at hello@hi-coworking.com.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
