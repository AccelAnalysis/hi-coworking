"use client";

import { AppShell } from "@/components/AppShell";

export default function TermsPage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-6">Terms of Service</h1>

        <div className="prose prose-slate max-w-none text-sm text-slate-600 space-y-6">
          <p>
            Welcome to Hi Coworking. By accessing or using our platform and physical spaces, you agree
            to be bound by these Terms of Service. Please read them carefully.
          </p>

          <h2 className="text-lg font-bold text-slate-900">1. Acceptance of Terms</h2>
          <p>
            By creating an account, booking a space, or using any Hi Coworking service, you agree to
            these terms. If you do not agree, do not use our services.
          </p>

          <h2 className="text-lg font-bold text-slate-900">2. Membership &amp; Billing</h2>
          <p>
            Membership subscriptions are billed monthly through Stripe. You may cancel at any time.
            Desk passes are one-time purchases and are non-refundable once used.
          </p>

          <h2 className="text-lg font-bold text-slate-900">3. Space Usage</h2>
          <p>
            Members and guests are expected to maintain a professional, respectful environment.
            Hi Coworking reserves the right to revoke access for disruptive behavior.
          </p>

          <h2 className="text-lg font-bold text-slate-900">4. Bookings &amp; Cancellations</h2>
          <p>
            Bookings are subject to availability. Cancellations made at least 2 hours before the
            booking start time will not be charged. Late cancellations and no-shows may be charged
            the full booking amount.
          </p>

          <h2 className="text-lg font-bold text-slate-900">5. Limitation of Liability</h2>
          <p>
            Hi Coworking is not responsible for lost, stolen, or damaged personal property.
            Use of the space is at your own risk.
          </p>

          <h2 className="text-lg font-bold text-slate-900">6. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the platform after changes
            constitutes acceptance of the updated terms.
          </p>

          <p className="text-xs text-slate-400 pt-4 border-t border-slate-200">
            Last updated: February 2026. Questions? Contact us at hicoworking@accelanalysis.com.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
