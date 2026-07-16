import { redirect } from "next/navigation";

export default function LegacyDirectoryPage() {
  redirect("/exchange?view=businesses");
}
