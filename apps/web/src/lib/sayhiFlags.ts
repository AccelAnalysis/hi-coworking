/**
 * Build-time switches for the SayHi member flow (approved by Jonathan,
 * Oct 30, 2026). Next.js inlines NEXT_PUBLIC_* values at build time, so a
 * production build without these variables ships every switch OFF and the
 * gated code paths are dead code there.
 *
 * - NEXT_PUBLIC_SAYHI_FLOW: the new public flow pages and Hi Navy branding
 *   (home actions, plans and pricing, account step, header mark). Off in
 *   production until Jonathan clears the launch; on in the private preview.
 * - NEXT_PUBLIC_VIRTUAL_ADDRESS: the virtual address option, its pop-up and
 *   the Form 1583 page. Off until USPS CMRA registration and staffing are in
 *   place. The server has its own switch (VIRTUAL_ADDRESS_ENABLED).
 * - NEXT_PUBLIC_SAYHI_PREVIEW_DEMO: sample data so the private preview can be
 *   clicked through without a real account. Never set in production.
 */

function on(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export const SAYHI_FLOW = on(process.env.NEXT_PUBLIC_SAYHI_FLOW);
export const VIRTUAL_ADDRESS = SAYHI_FLOW && on(process.env.NEXT_PUBLIC_VIRTUAL_ADDRESS);
export const SAYHI_PREVIEW_DEMO = on(process.env.NEXT_PUBLIC_SAYHI_PREVIEW_DEMO);

export type SayHiFlags = { flow: boolean; virtualAddress: boolean; demo: boolean };

/** Pure resolver, used by tests to check the defaults. */
export function resolveSayHiFlags(env: Record<string, string | undefined>): SayHiFlags {
  const flow = on(env.NEXT_PUBLIC_SAYHI_FLOW);
  return {
    flow,
    virtualAddress: flow && on(env.NEXT_PUBLIC_VIRTUAL_ADDRESS),
    demo: on(env.NEXT_PUBLIC_SAYHI_PREVIEW_DEMO),
  };
}
