"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileClock,
  HelpCircle,
  Loader2,
  MessageSquarePlus,
  Send,
} from "lucide-react";
import { useOpportunityGovernance } from "../data/useOpportunityGovernance";
import { formatExchangeDate } from "../utils/formatting";

export function OpportunityGovernancePanel({
  rfxId,
}: {
  rfxId: string;
}) {
  const governance = useOpportunityGovernance(rfxId);
  const [question, setQuestion] = useState("");
  const [visibilityRequested, setVisibilityRequested] = useState<"public" | "private">("public");
  const [submitted, setSubmitted] = useState(false);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answerVisibility, setAnswerVisibility] = useState<Record<string, "public" | "private">>({});
  const [addendumTitle, setAddendumTitle] = useState("");
  const [addendumSummary, setAddendumSummary] = useState("");
  const [materialChanges, setMaterialChanges] = useState("");
  const [acknowledgmentRequired, setAcknowledgmentRequired] = useState(false);
  const [deadlineChanged, setDeadlineChanged] = useState(false);
  const [newDeadline, setNewDeadline] = useState("");

  return (
    <details className="rounded-2xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
        <span className="flex items-center gap-2">
          <FileClock className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Addenda, Q&amp;A, and procurement calendar
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </summary>
      <div className="space-y-5 border-t border-slate-100 p-4">
        {governance.loading ? (
          <div className="flex min-h-16 items-center justify-center gap-2 text-sm text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading governed updates…
          </div>
        ) : governance.error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Update history unavailable</p>
            <p className="mt-1 text-xs leading-5">{governance.error.message}</p>
            <button type="button" onClick={() => void governance.refresh()} className="mt-2 min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Retry</button>
          </div>
        ) : null}

        <section aria-labelledby="opportunity-addenda-heading">
          <div className="flex items-center justify-between gap-3">
            <h4 id="opportunity-addenda-heading" className="text-xs font-black uppercase tracking-wide text-slate-500">Addenda</h4>
            <span className="text-[11px] font-bold text-slate-400">{governance.addenda.length}{governance.addendaTruncated ? "+" : ""}</span>
          </div>
          {governance.addenda.length ? (
            <ol className="mt-2 space-y-2">
              {governance.addenda.map((addendum) => (
                <li key={addendum.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">v{addendum.version} · {addendum.title}</p>
                    <span className="text-[10px] font-semibold text-slate-500">{formatExchangeDate(addendum.publishedAt)}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-700">{addendum.summary}</p>
                  {addendum.materialChanges.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {addendum.materialChanges.map((change, index) => <li key={`${addendum.id}-${index}`}>• {change}</li>)}
                    </ul>
                  ) : null}
                  {addendum.deadlineChanged ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-900">
                      Deadline changed{addendum.previousDeadline ? ` from ${formatExchangeDate(addendum.previousDeadline)}` : ""}{addendum.newDeadline ? ` to ${formatExchangeDate(addendum.newDeadline)}` : ""}.
                    </p>
                  ) : null}
                  {addendum.acknowledgmentRequired ? (
                    <button
                      type="button"
                      disabled={governance.mutating}
                      onClick={() => void governance.acknowledgeAddendum({ addendumId: addendum.id })}
                      className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-800 outline-none hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" /> Acknowledge addendum
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No published addenda.</p>
          )}
          {governance.canManage ? (
            <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-bold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
                Publish governed addendum
              </summary>
              <form
                className="space-y-2 border-t border-slate-200 p-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const changes = materialChanges
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean);
                  if (!addendumTitle.trim() || !addendumSummary.trim() || !changes.length) return;
                  await governance.createAddendum({
                    title: addendumTitle,
                    summary: addendumSummary,
                    materialChanges: changes,
                    deadlineChanged,
                    ...(deadlineChanged && newDeadline
                      ? { newDeadline: new Date(newDeadline).getTime() }
                      : {}),
                    acknowledgmentRequired,
                  });
                  setAddendumTitle("");
                  setAddendumSummary("");
                  setMaterialChanges("");
                  setAcknowledgmentRequired(false);
                  setDeadlineChanged(false);
                  setNewDeadline("");
                }}
              >
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-600">Title</span>
                  <input
                    value={addendumTitle}
                    onChange={(event) => setAddendumTitle(event.target.value)}
                    maxLength={180}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-600">Summary</span>
                  <textarea
                    value={addendumSummary}
                    onChange={(event) => setAddendumSummary(event.target.value)}
                    maxLength={5_000}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-600">Material changes, one per line</span>
                  <textarea
                    value={materialChanges}
                    onChange={(event) => setMaterialChanges(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={acknowledgmentRequired}
                    onChange={(event) => setAcknowledgmentRequired(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Require acknowledgment
                </label>
                <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={deadlineChanged}
                    onChange={(event) => setDeadlineChanged(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Response deadline changed
                </label>
                {deadlineChanged ? (
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-600">New response deadline</span>
                    <input
                      type="datetime-local"
                      value={newDeadline}
                      onChange={(event) => setNewDeadline(event.target.value)}
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>
                ) : null}
                <button
                  type="submit"
                  disabled={
                    governance.mutating
                    || !addendumTitle.trim()
                    || !addendumSummary.trim()
                    || !materialChanges.trim()
                    || (deadlineChanged && !newDeadline)
                  }
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" aria-hidden="true" /> Publish addendum
                </button>
              </form>
            </details>
          ) : null}
        </section>

        <section aria-labelledby="opportunity-calendar-heading">
          <h4 id="opportunity-calendar-heading" className="text-xs font-black uppercase tracking-wide text-slate-500">Procurement calendar</h4>
          <dl className="mt-2 grid gap-2 text-xs text-slate-700">
            <div><dt className="font-bold">Question deadline</dt><dd>{governance.questionDeadline ? formatExchangeDate(governance.questionDeadline) : "Not published"}</dd></div>
            <div><dt className="font-bold">Pre-bid meeting</dt><dd>{governance.preBidMeeting || "Not published"}</dd></div>
            <div><dt className="font-bold">Site visit</dt><dd>{governance.siteVisit || "Not published"}</dd></div>
            <div><dt className="font-bold">Submission instructions</dt><dd className="whitespace-pre-wrap">{governance.submissionInstructions || "Use the secured response workflow unless the issuer publishes alternate instructions."}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="opportunity-questions-heading">
          <div className="flex items-center justify-between gap-3">
            <h4 id="opportunity-questions-heading" className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500"><HelpCircle className="h-4 w-4" aria-hidden="true" /> Questions and answers</h4>
            <span className="text-[11px] font-bold text-slate-400">{governance.questions.length}{governance.questionsTruncated ? "+" : ""}</span>
          </div>
          {governance.questions.length ? (
            <div className="mt-2 space-y-2">
              {governance.questions.map((item) => (
                <article key={item.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{item.visibility}{item.isMine ? " · Your question" : ""}</span>
                    <span className="text-[10px] text-slate-400">{formatExchangeDate(item.submittedAt)}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold leading-5 text-slate-900">{item.question}</p>
                  {item.answer ? (
                    <div className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-sm leading-5 text-emerald-950">
                      <strong>Issuer response:</strong> {item.answer}
                    </div>
                  ) : governance.canManage ? (
                    <div className="mt-3 space-y-2">
                      <label className="block">
                        <span className="sr-only">Answer question</span>
                        <textarea
                          value={answerDrafts[item.id] ?? ""}
                          onChange={(event) => setAnswerDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                          rows={3}
                          placeholder="Write the governed issuer response"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={answerVisibility[item.id] ?? "public"}
                          onChange={(event) => setAnswerVisibility((current) => ({ ...current, [item.id]: event.target.value as "public" | "private" }))}
                          aria-label="Answer visibility"
                          className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="public">Public answer</option>
                          <option value="private">Private answer</option>
                        </select>
                        <button
                          type="button"
                          disabled={governance.mutating || !(answerDrafts[item.id] ?? "").trim()}
                          onClick={async () => {
                            await governance.answerQuestion({
                              questionId: item.id,
                              answer: answerDrafts[item.id] ?? "",
                              visibility: answerVisibility[item.id] ?? "public",
                            });
                            setAnswerDrafts((current) => ({ ...current, [item.id]: "" }));
                          }}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" aria-hidden="true" /> Publish answer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs italic text-slate-500">Awaiting issuer response.</p>
                  )}
                </article>
              ))}
            </div>
          ) : <p className="mt-2 text-sm text-slate-500">No visible questions yet.</p>}
        </section>

        {governance.canAsk ? (
          <form
            className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!question.trim()) return;
              await governance.submitQuestion({ question, visibilityRequested });
              setQuestion("");
              setSubmitted(true);
              window.setTimeout(() => setSubmitted(false), 2400);
            }}
          >
            <label className="block">
              <span className="flex items-center gap-2 text-xs font-bold text-indigo-950"><MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> Ask the issuer</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
                placeholder="Ask a procurement question without including protected bid information"
                className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <select
                value={visibilityRequested}
                onChange={(event) => setVisibilityRequested(event.target.value as "public" | "private")}
                aria-label="Requested question visibility"
                className="h-10 rounded-xl border border-indigo-200 bg-white px-3 text-xs font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="public">May be published publicly</option>
                <option value="private">Request private response</option>
              </select>
              <button
                type="submit"
                disabled={governance.mutating || question.trim().length < 5}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-indigo-700 px-3 text-xs font-bold text-white outline-none hover:bg-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
              >
                {submitted ? <Check className="h-4 w-4" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {submitted ? "Question submitted" : "Submit question"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </details>
  );
}
