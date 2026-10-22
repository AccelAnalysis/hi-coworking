import type { LayoutVariant } from "@hi/shared";

export type PublishedSetup = { id: string; name: string; serviceType: "DESK" | "CONFERENCE"; resourceId: string; capacity: number; description?: string; arrangement?: string; addOnIds: string[]; layoutPath: string; published: boolean };
export type PublishedAddOn = { id: string; name: string; description?: string; priceCents: number; serviceTypes: string[]; published: boolean };
export type PublishedCatalog = { setups: PublishedSetup[]; addOns: PublishedAddOn[] };

export function compatibleAddOns(catalog: PublishedCatalog, setup?: PublishedSetup): PublishedAddOn[] {
  if (!setup?.published) return [];
  return catalog.addOns.filter((item) => item.published && setup.addOnIds.includes(item.id) && item.serviceTypes.includes(setup.serviceType) && Number.isInteger(item.priceCents) && item.priceCents >= 0);
}

/** Resolve the selected instant in facility time, never the browser's timezone or today. */
export function layoutForBooking(layouts: LayoutVariant[], timestamp: number, timeZone = "America/New_York"): LayoutVariant | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = (value: string) => Number(value.split(":")[0]) * 60 + Number(value.split(":")[1]);
  const candidates = layouts.filter((layout) => layout.status === "PUBLISHED").flatMap((layout) => {
    const rule = layout.effectiveRules;
    const windows = rule?.oneOffOverrideWindows ?? [];
    const match = windows.filter((window) => timestamp >= window.start && timestamp < window.end).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (match) return [{ layout, rank: 4, priority: match.priority ?? 0 }];
    if (windows.length || rule?.precedence === "OVERRIDE") return [];
    if (rule?.precedence === "DEFAULT") return [{ layout, rank: 1, priority: rule.priority ?? 0 }];
    if (rule?.daysOfWeek?.length && !rule.daysOfWeek.includes(day)) return [];
    if (rule?.startTime && rule.endTime && !(minutes >= toMinutes(rule.startTime) && minutes < toMinutes(rule.endTime))) return [];
    return [{ layout, rank: 2, priority: rule?.priority ?? 0 }];
  });
  candidates.sort((a, b) => b.rank - a.rank || b.priority - a.priority || b.layout.updatedAt - a.layout.updatedAt || a.layout.id.localeCompare(b.layout.id));
  return candidates[0]?.layout ?? null;
}
