/**
 * Per-resource "offered" flags stored at siteSettings/resources.
 * Admins can turn a bookable space on or off without a deploy.
 * Missing keys use the catalog default; the Private Office starts off.
 */

import { PRIVATE_OFFICE_RESOURCE_ID } from "./seatCatalog";

export const RESOURCE_OFFERING_SETTINGS_ID = "resources";

export type ResourceOfferingMap = Record<string, boolean>;

export type OfferableResource = {
  id: string;
  name: string;
  description: string;
  defaultOffered: boolean;
};

export const OFFERABLE_RESOURCES: readonly OfferableResource[] = [
  { id: "seat-1", name: "Desk 1 (D1)", description: "Shared conference-table seat", defaultOffered: true },
  { id: "seat-2", name: "Desk 2 (D2)", description: "Shared conference-table seat", defaultOffered: true },
  { id: "seat-3", name: "Desk 3 (D3)", description: "Window sit-stand desk", defaultOffered: true },
  { id: "seat-4", name: "Desk 4 (D4)", description: "Window sit-stand desk", defaultOffered: true },
  { id: "seat-5", name: "Desk 5 (D5)", description: "Window sit-stand, curved monitor, and dock", defaultOffered: true },
  { id: "seat-6", name: "Desk 6 (D6)", description: "Window sit-stand, curved monitor, and dock", defaultOffered: true },
  {
    id: PRIVATE_OFFICE_RESOURCE_ID,
    name: "Private Office",
    description: "Right-hand room for signings, notary, and closed-door work",
    defaultOffered: false,
  },
  { id: "mode-conference", name: "Conference Room", description: "Weekday 4-hour slots and evening or weekend requests", defaultOffered: true },
] as const;

export const RESOURCE_NOT_OFFERED_MESSAGE = "This space is not currently offered.";

export function parseResourceOffering(data: unknown): ResourceOfferingMap {
  if (!data || typeof data !== "object") return {};
  const offered = (data as { offered?: unknown }).offered;
  if (!offered || typeof offered !== "object") return {};
  const result: ResourceOfferingMap = {};
  for (const [key, value] of Object.entries(offered as Record<string, unknown>)) {
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

export function defaultOfferedFor(resourceId: string): boolean {
  const catalog = OFFERABLE_RESOURCES.find((item) => item.id === resourceId);
  if (catalog) return catalog.defaultOffered;
  return resourceId !== PRIVATE_OFFICE_RESOURCE_ID;
}

export function isResourceOffered(
  resourceId: string,
  offered?: ResourceOfferingMap | null,
): boolean {
  if (offered && Object.prototype.hasOwnProperty.call(offered, resourceId)) {
    return offered[resourceId] === true;
  }
  return defaultOfferedFor(resourceId);
}
