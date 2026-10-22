/** Server mirror of the customer layout resolver; all wall times use facility timezone. */
type EffectiveRules = { precedence?: string; priority?: number; daysOfWeek?: number[]; startTime?: string; endTime?: string; oneOffOverrideWindows?: Array<{ start: number; end: number; priority?: number }> };
export type EffectiveLayout = { id: string; status?: string; updatedAt?: number; effectiveRules?: EffectiveRules };
export function effectiveLayoutId(layouts: EffectiveLayout[], timestamp: number): string | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = (value: string) => Number(value.split(":")[0]) * 60 + Number(value.split(":")[1]);
  const candidates = layouts.filter((layout) => layout.status === "PUBLISHED").flatMap((layout) => {
    const rule = layout.effectiveRules;
    const windows = rule?.oneOffOverrideWindows || [];
    const match = windows.filter((window) => timestamp >= window.start && timestamp < window.end).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
    if (match) return [{ layout, rank: 4, priority: match.priority || 0 }];
    if (windows.length || rule?.precedence === "OVERRIDE") return [];
    if (rule?.precedence === "DEFAULT") return [{ layout, rank: 1, priority: rule.priority || 0 }];
    if (rule?.daysOfWeek?.length && !rule.daysOfWeek.includes(day)) return [];
    if (rule?.startTime && rule.endTime && !(minutes >= toMinutes(rule.startTime) && minutes < toMinutes(rule.endTime))) return [];
    return [{ layout, rank: 2, priority: rule?.priority || 0 }];
  });
  candidates.sort((a, b) => b.rank - a.rank || b.priority - a.priority || (b.layout.updatedAt || 0) - (a.layout.updatedAt || 0) || a.layout.id.localeCompare(b.layout.id));
  return candidates[0]?.layout.id || null;
}

export function layoutCoversBooking(layouts: EffectiveLayout[], layoutId: string, start: number, end: number): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 24 * 60 * 60_000) return false;
  const checks = new Set([start, end - 1]);
  // Scheduled wall-time rules have minute resolution; include override edges,
  // which can occur between minute boundaries, as well.
  for (let timestamp = Math.floor(start / 60_000) * 60_000 + 60_000; timestamp < end; timestamp += 60_000) checks.add(timestamp);
  for (const layout of layouts) for (const window of layout.effectiveRules?.oneOffOverrideWindows || []) {
    for (const edge of [window.start, window.end]) if (edge >= start && edge < end) checks.add(edge);
  }
  return [...checks].every((timestamp) => effectiveLayoutId(layouts, timestamp) === layoutId);
}
