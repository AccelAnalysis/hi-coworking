import { BadgeCheck, MapPin, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecipientSuggestion } from "../data/exchangeRun3Gateway";

export function RecipientSuggestions({
  suggestions,
  selectedId,
  onSelect,
  compact = false,
}: {
  suggestions: RecipientSuggestion[];
  selectedId?: string;
  onSelect?: (suggestion: RecipientSuggestion) => void;
  compact?: boolean;
}) {
  return (
    <section aria-labelledby="recipient-suggestions-title">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden="true" />
        <h3 id="recipient-suggestions-title" className="text-sm font-bold text-slate-950">Suggested recipients</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500">Rule-based matches from published capabilities, territories, offers, and verified history.</p>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => {
          const content = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-950">{suggestion.providerLabel}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{suggestion.relationshipState.replaceAll("_", " ")} relationship</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800">{suggestion.score}% match</span>
              </div>
              <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
                <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
                <span>{suggestion.matchedCapabilities.join(", ")}</span>
              </div>
              {!compact ? (
                <>
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-600">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                    <span>{suggestion.territoryExplanation}</span>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {suggestion.reasons.map((reason) => (
                      <li key={reason} className="rounded-md bg-slate-100 px-1.5 py-1 text-[10px] font-medium text-slate-600">{reason}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="mt-2 text-[11px] font-semibold text-slate-600">
                {suggestion.acceptingReferrals ? "Accepting referrals" : "Not accepting referrals"}
                {suggestion.compensationConfigured ? " · Compensation configured" : " · No compensation configured"}
              </p>
            </>
          );
          return onSelect ? (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => onSelect(suggestion)}
              aria-pressed={selectedId === suggestion.id}
              className={cn(
                "w-full rounded-xl border bg-white p-3 text-left outline-none transition hover:border-indigo-300 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-indigo-500",
                selectedId === suggestion.id ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200",
              )}
            >
              {content}
            </button>
          ) : (
            <article key={suggestion.id} className="rounded-xl border border-slate-200 bg-white p-3">{content}</article>
          );
        })}
      </div>
    </section>
  );
}
