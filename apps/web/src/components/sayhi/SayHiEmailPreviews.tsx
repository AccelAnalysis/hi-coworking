"use client";

import Link from "next/link";
import { SAYHI_EMAIL_PREVIEWS } from "@/lib/sayhiEmailPreviews.generated";

/**
 * Private preview only (/my-hi?demo=emails, NEXT_PUBLIC_SAYHI_PREVIEW_DEMO):
 * the SayHi follow-up emails exactly as the server renders them, with
 * fictional sample visits. Wording approved by Jonathan on Nov 1, 2026.
 */
export default function SayHiEmailPreviews() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm font-semibold text-[#101D4B]">Preview</p>
      <h1 className="mt-1 font-display text-3xl font-semibold text-[#101D4B]">
        SayHi follow-up emails
      </h1>
      <p className="mt-3 text-base text-slate-700">
        Draft wording with sample visits. These emails stay off until the wording is approved.
      </p>
      <nav aria-label="Emails" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {SAYHI_EMAIL_PREVIEWS.map((email) => (
            <li key={email.id}>
              <a
                href={`#${email.id}`}
                className="inline-flex min-h-11 items-center rounded-full border border-[#101D4B]/20 px-4 text-sm font-medium text-[#101D4B] hover:bg-[#101D4B]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B]"
              >
                {email.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {SAYHI_EMAIL_PREVIEWS.map((email) => (
        <section key={email.id} id={email.id} aria-labelledby={`${email.id}-title`} className="mt-10 scroll-mt-24">
          <h2 id={`${email.id}-title`} className="text-xl font-semibold text-[#101D4B]">
            {email.label}
          </h2>
          <p className="mt-1 text-sm text-slate-700">{email.trigger}</p>
          <dl className="mt-3 text-sm">
            <dt className="font-semibold text-slate-900">Subject</dt>
            <dd className="mt-0.5 text-slate-800">{email.subject}</dd>
          </dl>
          <iframe
            title={`${email.label} email preview`}
            srcDoc={email.html}
            sandbox=""
            className="mt-4 h-[880px] w-full rounded-2xl border border-slate-200 bg-white"
          />
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-[#101D4B]">
              Plain-text version
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-800">{email.text}</pre>
          </details>
        </section>
      ))}
      <p className="mt-10">
        <Link href="/my-hi?demo=member" className="inline-flex min-h-11 items-center text-sm font-medium text-[#101D4B] underline">
          Back to the SayHi preview
        </Link>
      </p>
    </main>
  );
}
