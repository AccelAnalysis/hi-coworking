import { Clock3 } from "lucide-react";
import type { ReferralTimelineEvent } from "../data/exchangeRun3Gateway";

export function ReferralTimeline({ events }: { events: ReferralTimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No timeline events are available.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="absolute -left-[1.65rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold text-slate-900">{event.label}</p>
          {event.description ? <p className="mt-0.5 text-xs text-slate-600">{event.description}</p> : null}
          <p className="mt-1 text-[11px] text-slate-500">
            {event.actorLabel} · {new Date(event.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}
