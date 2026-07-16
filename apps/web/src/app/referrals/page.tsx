import { redirect } from "next/navigation";

export default function LegacyReferralsPage() {
  redirect("/exchange?view=referrals");
}
