/**
 * Public URLs that used to render RFx Exchange / platform product UI.
 * Hosting redirects and route stubs both send visitors to a Hi Coworking page.
 * The previous screen implementations stay under src/quarantine and are not routed.
 */

export const PUBLIC_HI_HOME = "/";
export const MEMBER_HI_HOME = "/account/bookings";
export const ADMIN_HI_HOME = "/admin/dashboard";

export const PUBLIC_RFX_QUARANTINE_PREFIXES = [
  "/rfx",
  "/platform",
  "/exchange",
  "/directory",
  "/referrals",
  "/org",
] as const;

export const MEMBER_RFX_QUARANTINE_PREFIXES = [
  "/dashboard",
  "/profile",
] as const;

export const ADMIN_RFX_QUARANTINE_PREFIXES = [
  "/admin/rfx",
  "/admin/territories",
  "/admin/verification",
  "/admin/orgs",
  "/admin/analytics",
] as const;

const QUARANTINED_PREFIXES = [
  ...PUBLIC_RFX_QUARANTINE_PREFIXES,
  ...MEMBER_RFX_QUARANTINE_PREFIXES,
  ...ADMIN_RFX_QUARANTINE_PREFIXES,
];

export function quarantineDestination(pathname: string): string | null {
  const path = pathname.split("?")[0]?.split("#")[0] || "/";
  const matches = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

  if (ADMIN_RFX_QUARANTINE_PREFIXES.some(matches)) return ADMIN_HI_HOME;
  if (MEMBER_RFX_QUARANTINE_PREFIXES.some(matches)) return MEMBER_HI_HOME;
  if (PUBLIC_RFX_QUARANTINE_PREFIXES.some(matches)) return PUBLIC_HI_HOME;
  return null;
}

export function isQuarantinedRfxPath(pathname: string): boolean {
  const path = pathname.split("?")[0]?.split("#")[0] || "/";
  return QUARANTINED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
