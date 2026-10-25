import type { EventRegistrationV2 } from "@/lib/eventsV2";

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const ROSTER_CSV_HEADER = [
  "Name",
  "Email",
  "Status",
  "Tickets",
  "Checked in",
  "Attendance",
  "Source",
  "Registered at",
];

export function rosterCsv(registrations: EventRegistrationV2[]): string {
  const rows = registrations.map((registration) => [
    registration.displayName,
    registration.email,
    registration.status,
    registration.quantity,
    registration.checkedInQuantity || 0,
    registration.attendanceStatus || "",
    registration.source || "",
    registration.registeredAt ? new Date(registration.registeredAt).toISOString() : "",
  ]);
  return [ROSTER_CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function rosterCsvFilename(title: string, startTime: number): string {
  const date = new Date(startTime).toISOString().slice(0, 10);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
  return `${slug}-${date}-roster.csv`;
}
