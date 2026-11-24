/**
 * Build-time switch for the customer seat map picker (approved by Jonathan,
 * 21 November 2026). Next.js inlines NEXT_PUBLIC_* values at build time, so a
 * production build without this variable ships the switch OFF and the current
 * booking flow is unchanged.
 *
 * - NEXT_PUBLIC_SEAT_MAP_PICKER: accessible SVG seat picker over the published
 *   Admin floor layout, with the desk card list as the alternative view.
 *   Off until Jonathan turns it on. Independent of desk block-rate work.
 */
function on(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export const SEAT_MAP_PICKER = on(process.env.NEXT_PUBLIC_SEAT_MAP_PICKER);

/** Pure resolver, used by tests to check the default. */
export function resolveSeatMapPickerFlag(env: Record<string, string | undefined>): boolean {
  return on(env.NEXT_PUBLIC_SEAT_MAP_PICKER);
}
