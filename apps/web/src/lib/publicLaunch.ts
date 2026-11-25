/**
 * When the public Coming Soon gate expires on its own.
 *
 * Single source of truth for the default launch countdown and the public site gate.
 * The compiled default is 8:00 AM America/New_York on Monday, November 30, 2026.
 * That date is after DST ends, so New York is on EST (UTC-05:00): 13:00 UTC.
 * Admins can set a later opening time on siteSettings/public.launchAt without a deploy.
 */
export const PUBLIC_LAUNCH_AT_ISO = "2026-11-30T08:00:00-05:00";

export const PUBLIC_LAUNCH_AT = Date.parse(PUBLIC_LAUNCH_AT_ISO);

/** Shown when a pre-launch checkout or registration callable is refused. */
export const PUBLIC_LAUNCH_LOCKED_MESSAGE = "Booking opens Monday, November 30 at 8 AM";


export type PublicLaunchSettings = {
  comingSoonEnabled: boolean;
  launchAt?: number | null;
};

/** Effective opening instant: a stored override, or the compiled default. */
export function resolvePublicLaunchAt(launchAt?: number | null): number {
  if (typeof launchAt === "number" && Number.isFinite(launchAt) && launchAt > 0) {
    return launchAt;
  }
  return PUBLIC_LAUNCH_AT;
}

/** True once the (effective) launch moment has arrived (inclusive). */
export function isPublicLaunchReached(now: number, launchAt: number = PUBLIC_LAUNCH_AT): boolean {
  return now >= launchAt;
}

/**
 * True when signed-out visitors should see Coming Soon.
 * Staff/admin bypass is applied separately by the public site gate.
 */
export function isComingSoonPubliclyActive(settings: PublicLaunchSettings, now: number): boolean {
  if (!settings.comingSoonEnabled) return false;
  return !isPublicLaunchReached(now, resolvePublicLaunchAt(settings.launchAt));
}

export function formatPublicLaunchAt(launchAt: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(launchAt);
}

function tzOffsetMs(utcInstant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcInstant));
  const value: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") value[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );
  return asUtc - utcInstant;
}

/** Interpret a calendar date and clock time as America/New_York (or another IANA zone). */
export function zonedDateTimeToUtcMs(date: string, time: string, timeZone = "America/New_York"): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = utcGuess - tzOffsetMs(utcGuess, timeZone);
  return utcGuess - tzOffsetMs(first, timeZone);
}

function etDateString(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function etWeekday(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(ms));
}

/** Next Monday 8:00 AM America/New_York that is strictly after `now`. */
export function nextMondayEightAmEt(now: number): { date: string; time: "08:00"; at: number } {
  const today = etDateString(now);
  const start = zonedDateTimeToUtcMs(today, "00:00");
  if (start == null) {
    throw new Error("Could not resolve today's date in America/New_York");
  }
  for (let day = 0; day <= 14; day += 1) {
    const date = etDateString(start + day * 86_400_000 + 12 * 3_600_000);
    const at = zonedDateTimeToUtcMs(date, "08:00");
    if (at != null && etWeekday(at) === "Mon" && at > now) {
      return { date, time: "08:00", at };
    }
  }
  throw new Error("Could not find a future Monday 8:00 AM in America/New_York");
}

export type PublicSiteModeView = {
  isGated: boolean;
  statusText: string;
  buttonLabel: string;
  confirmTitle: string;
  confirmLabel: string;
  confirmBody: string;
  destructive: boolean;
  requiresNewLaunchAt: boolean;
};

/** Admin card copy and actions from the effective public state, not the raw flag alone. */
export function publicSiteModeView(settings: PublicLaunchSettings, now: number): PublicSiteModeView {
  const isGated = isComingSoonPubliclyActive(settings, now);
  const launchAt = resolvePublicLaunchAt(settings.launchAt);
  const launchPassed = isPublicLaunchReached(now, launchAt);

  if (isGated) {
    return {
      isGated: true,
      statusText: "The public site shows the Coming Soon page. Member and staff pages still work.",
      buttonLabel: "Open site to public…",
      confirmTitle: "Open the site to the public?",
      confirmLabel: "Open site",
      confirmBody: "Visitors will see the full public site right away instead of the Coming Soon page.",
      destructive: false,
      requiresNewLaunchAt: false,
    };
  }

  const datePassedWhileEnabled = settings.comingSoonEnabled && launchPassed;
  return {
    isGated: false,
    statusText: datePassedWhileEnabled
      ? "The public site is open to everyone. The Coming Soon date has already passed, so visitors see the live site."
      : "The public site is open to everyone.",
    buttonLabel: "Return to Coming Soon…",
    confirmTitle: "Return the site to Coming Soon?",
    confirmLabel: "Switch to Coming Soon",
    confirmBody: launchPassed
      ? "Pick a new opening date and time in America/New_York. Visitors will see the Coming Soon page until then. Member and staff pages keep working."
      : "Visitors will see the Coming Soon page right away. Member and staff pages keep working.",
    destructive: true,
    requiresNewLaunchAt: launchPassed,
  };
}
