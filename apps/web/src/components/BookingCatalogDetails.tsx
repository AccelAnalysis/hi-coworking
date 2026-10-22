import type { Booking } from "@hi/shared";

export type BookingCatalogSnapshot = Pick<Booking, "setup" | "addOns" | "attendeeCount">;
/** Purchased snapshots only: never consult mutable catalog prices after checkout. */
export function BookingCatalogDetails({ booking }: { booking: BookingCatalogSnapshot }) {
  if (!booking.setup && !booking.addOns?.length) return null;
  return <section aria-label="Purchased setup and add-ons" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-700">
    {booking.setup && <p><strong>Booked setup:</strong> {booking.setup.name} · {booking.attendeeCount ?? 1} {booking.attendeeCount === 1 ? "person" : "people"} · capacity {booking.setup.capacity}</p>}
    {!!booking.addOns?.length && <ul className="mt-2 space-y-1">{booking.addOns.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{item.name} · once per booking</span><span>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.priceCents / 100)}</span></li>)}</ul>}
    <p className="mt-2 text-xs text-slate-500">Saved at booking confirmation. Current catalog changes do not alter these purchased details.</p>
  </section>;
}
