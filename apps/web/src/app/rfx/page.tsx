import { redirect } from "next/navigation";

export default function LegacyRfxPage() {
  redirect("/exchange?view=opportunities");
}
