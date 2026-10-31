"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SAYHI_FLOW } from "@/lib/sayhiFlags";

type Section = { id?: string; title: string; body: ReactNode };

/**
 * The check-in, extra-time, door-code and membership-end wording (Jonathan,
 * Oct 30-31, 2026) ships with the SayHi flow and stays out of production
 * until that flow is switched on.
 */
function termsSections(sayhi: boolean): Section[] {
  return [
    {
      title: "Acceptance of Terms",
      body: (
        <p>
          By creating an account, booking a space, or using any Hi Coworking service, you agree to
          these terms. If you do not agree, do not use our services.
        </p>
      ),
    },
    {
      id: "membership",
      title: "Membership & Billing",
      body: sayhi ? (
        <p>
          Membership subscriptions are billed monthly through Stripe. You may cancel at any time.
          Your membership stays active through the end of the month you&apos;ve paid for, and
          partial months aren&apos;t refunded. Bookings scheduled after your membership ends are
          cancelled automatically, along with their door codes. Desk passes are one-time purchases
          and are non-refundable once used.
        </p>
      ) : (
        <p>
          Membership subscriptions are billed monthly through Stripe. You may cancel at any time.
          Desk passes are one-time purchases and are non-refundable once used.
        </p>
      ),
    },
    {
      title: "Space Usage",
      body: (
        <p>
          Members and guests are expected to maintain a professional, respectful environment.
          Hi Coworking reserves the right to revoke access for disruptive behavior.
        </p>
      ),
    },
    {
      title: "Bookings & Cancellations",
      body: (
        <p>
          Bookings are subject to availability. Cancellations made at least 2 hours before the
          booking start time will not be charged. Late cancellations and no-shows may be charged
          the full booking amount.
        </p>
      ),
    },
    ...(sayhi
      ? [
          {
            id: "extra-time",
            title: "Check-In, Check-Out & Extra Time",
            body: (
              <>
                <p>
                  Check in when you arrive and check out on the front-desk iPad before you leave.
                  Your time runs until you check out.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Check out within 15 minutes after your booking ends and there&apos;s no extra charge.</li>
                  <li>
                    After that, extra time is charged in 15-minute steps at your plan&apos;s extra-hour
                    rate, or the guest hourly rate, to your card on file or your next membership bill.
                  </li>
                  <li>Leaving early? Your booked time is still charged.</li>
                  <li>
                    If you don&apos;t check out, time is billed up to one hour past your booking and
                    reviewed by our team.
                  </li>
                </ul>
              </>
            ),
          },
          {
            id: "door-codes",
            title: "Door Codes",
            body: (
              <p>
                Each booking has its own door code, shown in SayHi. Everyone enters with their own
                code, so please don&apos;t share yours or hold the door for others. Codes work only
                during your booking and stop working if the booking is cancelled or changed.
              </p>
            ),
          },
        ]
      : []),
    {
      title: "Limitation of Liability",
      body: (
        <p>
          Hi Coworking is not responsible for lost, stolen, or damaged personal property.
          Use of the space is at your own risk.
        </p>
      ),
    },
    {
      id: "sms",
      title: "Text Messages",
      body: (
        <p>
          If you opt in, Hi Coworking sends event invitations, reminders and updates by text.
          Texts are optional. Reply STOP to opt out or HELP for help. Our{" "}
          <Link href="/sms-terms" className="font-semibold text-sky-800 underline underline-offset-2">SMS Terms</Link>{" "}
          are part of these terms.
        </p>
      ),
    },
    {
      title: "Changes to Terms",
      body: sayhi ? (
        <p>
          We may update these terms and our space policies, including check-out and extra-time
          rules, at any time. The current version is always posted here, and continued use of the
          platform after changes constitutes acceptance of the updated terms.
        </p>
      ) : (
        <p>
          We may update these terms from time to time. Continued use of the platform after changes
          constitutes acceptance of the updated terms.
        </p>
      ),
    },
  ];
}

export default function TermsPage() {
  const sections = termsSections(SAYHI_FLOW);
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-6">Terms of Service</h1>

        <div className="prose prose-slate max-w-none text-sm text-slate-600 space-y-6">
          <p>
            Welcome to Hi Coworking. By accessing or using our platform and physical spaces, you agree
            to be bound by these Terms of Service. Please read them carefully.
          </p>

          {sections.map((section, index) => {
            const headingId = section.id ?? `terms-${index + 1}`;
            return (
              <section key={section.title} aria-labelledby={headingId} className="space-y-3">
                <h2 id={headingId} className="text-lg font-bold text-slate-900 scroll-mt-24">
                  {index + 1}. {section.title}
                </h2>
                {section.body}
              </section>
            );
          })}

          <p className="text-xs text-slate-400 pt-4 border-t border-slate-200">
            Last updated: October 2026. Questions? Contact us at hicoworking@accelanalysis.com.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
