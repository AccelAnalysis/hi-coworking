"use client";

import Link from "next/link";
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
            <li>Your mobile number and text message preferences, if you choose to give them</li>
            <li>Booking, membership, and payment information</li>
            <li>Event registration details</li>
            <li>Communications you send to us</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-900">2. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide and manage your membership, bookings, and event registrations</li>
            <li>Process payments through Stripe</li>
            <li>Send notifications about bookings, events, and your account</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-900">3. Data Sharing</h2>
          <p>
            We do not sell your personal information. We share data only with service providers
            necessary to operate Hi Coworking (e.g., Stripe for payments, Firebase for hosting,
            and Twilio to deliver text messages).
          </p>

          <h2 id="sms" className="text-lg font-bold text-slate-900">4. Text Messages (SMS)</h2>
          <p>
            Hi Coworking texts only people who opt in. Opting in is optional and is never a
            condition of membership, purchase, or applying for an event. We use your mobile number
            to send the event invitations, reminders and updates you asked for, and you can reply
            STOP at any time to opt out or HELP for help.
          </p>
          <p>
            Mobile information will not be shared with third parties or affiliates for marketing or
            promotional purposes. Text messaging originator opt-in data and consent will not be
            shared with any third parties. This includes any consent you give to share your
            business contact details with participating businesses: that consent never covers your
            mobile number or text message consent.
          </p>
          <p>
            See our <Link href="/sms-terms" className="font-semibold text-sky-800 underline underline-offset-2">SMS Terms</Link> for
            message types, frequency, and how to get help.
          </p>

          <h2 className="text-lg font-bold text-slate-900">5. Data Security</h2>
          <p>
            We use industry-standard security measures including encrypted connections, secure
            authentication, and role-based access controls. However, no method of transmission
            over the internet is 100% secure.
          </p>

          <h2 className="text-lg font-bold text-slate-900">6. Your Rights</h2>
          <p>
            You may update or delete your account information at any time through your profile
            settings. To request full data deletion, contact us at hicoworking@accelanalysis.com.
          </p>

          <h2 className="text-lg font-bold text-slate-900">7. Changes to This Policy</h2>
          <p>
            We may update this policy periodically. We will notify you of significant changes
            through the platform or via email.
          </p>

          <p className="text-xs text-slate-400 pt-4 border-t border-slate-200">
            Last updated: October 2026. Questions? Contact us at hicoworking@accelanalysis.com.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
