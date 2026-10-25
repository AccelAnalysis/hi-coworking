/** Customer-facing view of the admin "Published setups" catalog (space_getPublishedCatalog). */

export type PublishedSetup = {
  id: string;
  name: string;
  serviceType: "DESK" | "CONFERENCE";
  resourceId: string;
  layoutPath: string;
  capacity: number;
  description: string;
  arrangement: string;
  addOnIds: string[];
};

export type PublishedAddOn = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  serviceTypes: string[];
};

export type PublishedCatalog = { setups: PublishedSetup[]; addOns: PublishedAddOn[] };

export function bookingServiceType(intent: string | null | undefined): "DESK" | "CONFERENCE" {
  return intent === "MEETING" ? "CONFERENCE" : "DESK";
}

/**
 * The setup published for this resource and service, with the add-ons that
 * apply to it. When several setups share a resource, the first by name wins
 * so the choice is stable.
 */
export function setupForResource(
  catalog: PublishedCatalog | null,
  resourceId: string | undefined,
  serviceType: "DESK" | "CONFERENCE",
): { setup: PublishedSetup; addOns: PublishedAddOn[] } | null {
  if (!catalog || !resourceId) return null;
  const setup = catalog.setups
    .filter((item) => item.resourceId === resourceId && item.serviceType === serviceType)
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!setup) return null;
  const addOns = setup.addOnIds
    .map((id) => catalog.addOns.find((addOn) => addOn.id === id))
    .filter((addOn): addOn is PublishedAddOn => Boolean(addOn) && addOn!.serviceTypes.includes(serviceType));
  return { setup, addOns };
}

export function addOnPriceLabel(priceCents: number) {
  if (!priceCents) return "No extra charge";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(priceCents / 100);
}
