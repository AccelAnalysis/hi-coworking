import type { Metadata } from "next";
import { QuarantinedPublicRoute } from "@/components/QuarantinedPublicRoute";

export const quarantineMetadata: Metadata = {
  title: "Hi Coworking",
  description: "Big ideas. Intimate space. A micro-coworking space designed for focus, flexibility, and real local use.",
  robots: { index: false, follow: false },
};

export function QuarantinePage({ href }: { href: string }) {
  return <QuarantinedPublicRoute href={href} />;
}
