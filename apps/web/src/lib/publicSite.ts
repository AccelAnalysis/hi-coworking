/**
 * Customer-facing Hi Coworking pages. Product routes (RFx Exchange and the
 * old platform) are not listed here and are not part of the Next.js build.
 */

export const PUBLIC_SITE_ORIGIN = "https://hi-coworking.com";

export const HOME_TITLE = "Hi Coworking";

export const HOME_DESCRIPTION =
  "Big ideas. Intimate space. A micro-coworking space designed for focus, flexibility, and real local use.";

export const PUBLIC_HI_PAGES = [
  "/",
  "/spaces",
  "/pricing",
  "/events",
  "/bookstore",
  "/about",
  "/contact",
  "/book",
  "/privacy",
  "/terms",
  "/sms-terms",
] as const;

export function publicPageUrl(path: (typeof PUBLIC_HI_PAGES)[number]): string {
  return path === "/" ? `${PUBLIC_SITE_ORIGIN}/` : `${PUBLIC_SITE_ORIGIN}${path}`;
}
