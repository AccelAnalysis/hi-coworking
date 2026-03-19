import type { EventDoc } from "@hi/shared";

function formatUtcDate(value: number): string {
  const d = new Date(value);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const sec = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}${sec}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildEventIcs(event: EventDoc): string {
  const uid = `${event.id}@hi-coworking`;
  const title = escapeIcsText(event.title);
  const description = escapeIcsText(event.description || "");
  const location = escapeIcsText(event.location || event.virtualUrl || "");
  const nowStamp = formatUtcDate(Date.now());
  const startStamp = formatUtcDate(event.startTime);
  const endStamp = formatUtcDate(event.endTime);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hi Coworking//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART:${startStamp}`,
    `DTEND:${endStamp}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.join("\r\n")}\r\n`;
}

export function downloadEventIcs(event: EventDoc) {
  const ics = buildEventIcs(event);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
