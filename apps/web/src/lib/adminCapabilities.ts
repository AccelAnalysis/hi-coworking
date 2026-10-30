/**
 * Admin tools whose backend is not deployed yet (audit P1-3).
 *
 * Flip a flag to true in the same PR that deploys the matching functions.
 * The dashboard labels these tiles "Not live yet" and the tool's page shows
 * the note, so an admin isn't left guessing why an action fails.
 */
export type AdminCapability = "doorAccess" | "eventCampaigns" | "frontDesk";

export const ADMIN_CAPABILITIES: Record<AdminCapability, { live: boolean; note: string }> = {
  doorAccess: {
    live: false,
    note: "Door access isn't switched on yet. You can view doors and codes, but unlock, resend and revoke won't work until the door access functions are deployed.",
  },
  eventCampaigns: {
    live: false,
    note: "Campaign sending isn't switched on yet. You can draft campaigns, but queuing sends won't work until it's deployed.",
  },
  frontDesk: {
    live: false,
    note: "The front-desk kiosk isn't switched on yet. Visits, alerts and devices will appear here once the front-desk kiosk functions and rules are deployed.",
  },
};

export function isCapabilityLive(capability: AdminCapability): boolean {
  return ADMIN_CAPABILITIES[capability].live;
}
