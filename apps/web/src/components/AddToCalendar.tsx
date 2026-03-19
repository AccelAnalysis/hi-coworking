"use client";

import type { EventDoc } from "@hi/shared";
import { CalendarDays } from "lucide-react";
import { downloadEventIcs } from "@/lib/icsGenerator";

function toGoogleDate(value: number): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function AddToCalendar({ event }: { event: EventDoc }) {
  const dates = `${toGoogleDate(event.startTime)}/${toGoogleDate(event.endTime)}`;
  const details = [event.description, event.virtualUrl ? `Join link: ${event.virtualUrl}` : ""]
    .filter(Boolean)
    .join("\n\n");

  const googleUrl = new URL("https://calendar.google.com/calendar/render");
  googleUrl.searchParams.set("action", "TEMPLATE");
  googleUrl.searchParams.set("text", event.title);
  googleUrl.searchParams.set("dates", dates);
  googleUrl.searchParams.set("details", details);
  if (event.location) googleUrl.searchParams.set("location", event.location);

  const outlookUrl = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  outlookUrl.searchParams.set("path", "/calendar/action/compose");
  outlookUrl.searchParams.set("rru", "addevent");
  outlookUrl.searchParams.set("subject", event.title);
  outlookUrl.searchParams.set("body", details);
  outlookUrl.searchParams.set("startdt", new Date(event.startTime).toISOString());
  outlookUrl.searchParams.set("enddt", new Date(event.endTime).toISOString());
  if (event.location) outlookUrl.searchParams.set("location", event.location);

  return (
    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
      <p className="text-xs font-semibold uppercase text-slate-500 mb-3 flex items-center gap-1.5">
        <CalendarDays className="h-3.5 w-3.5" /> Add to Calendar
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={googleUrl.toString()}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Google
        </a>
        <a
          href={outlookUrl.toString()}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Outlook
        </a>
        <button
          type="button"
          onClick={() => downloadEventIcs(event)}
          className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Apple / ICS
        </button>
      </div>
    </div>
  );
}
