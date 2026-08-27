import { redirect } from "next/navigation";

export default function LegacyMyHiPage() {
  redirect("/account/bookings");
}
