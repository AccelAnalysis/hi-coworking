"use client";

import { AppShell } from "@/components/AppShell";

export default function PrivacyPage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-6">Privacy Policy</h1>

        <div className="prose prose-slate max-w-none text-sm text-slate-600 space-y-6">
          <p>
            Hi Coworking (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is committed to
            protecting your privacy. This policy explains how we collect, use, and safeguard your
            information when you use our platform and physical spaces.
          </p>

          <h2 className="text-lg font-bold text-slate-900">1. Information We Collect</h2>
          <p>We collect information you provide directly, including:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Account information (name, email, password)</li>
            <li>Business profile data (business name, NAICS codes, certifications)</li>
            <li>Booking and payment information</li>
            <li>Communications you send to us</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-900">2. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide and manage your membership and bookings</li>
            <li>Process payments through Stripe</li>
            <li>Display your business profile in the Member Directory (if you opt in)</li>
            <li>Match you with relevant RFx opportunities</li>
            <li>Send notifications about bookings, events, and platform activity</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-900">3. Data Sharing</h2>
          <p>
            We do not sell your personal information. We share data only with service providers
            necessary to operate the platform (e.g., Stripe for payments, Firebase for hosting).
            Published business profiles are visible to other authenticated members.
          </p>

          <h2 className="text-lg font-bold text-slate-900">4. Data Security</h2>
          <p>
            We use industry-standard security measures including encrypted connections, secure
            authentication, and role-based access controls. However, no method of transmission
            over the internet is 100% secure.
          </p>

          <h2 className="text-lg font-bold text-slate-900">5. Your Rights</h2>
          <p>
            You may update or delete your account information at any time through your profile
            settings. To request full data deletion, contact us at hicoworking@accelanalysis.com.
          </p>

          <h2 className="text-lg font-bold text-slate-900">6. Changes to This Policy</h2>
          <p>
            We may update this policy periodically. We will notify you of significant changes
            through the platform or via email.
          </p>

          <p className="text-xs text-slate-400 pt-4 border-t border-slate-200">
            Last updated: February 2026. Questions? Contact us at hicoworking@accelanalysis.com.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
