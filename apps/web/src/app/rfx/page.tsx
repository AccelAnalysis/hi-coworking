import type { Metadata } from "next";
import { PUBLIC_HI_HOME } from "@/lib/rfxQuarantine";
import { QuarantinePage, quarantineMetadata } from "@/lib/quarantineRoute";

export const metadata: Metadata = quarantineMetadata;

export default function Page() {
  return <QuarantinePage href={PUBLIC_HI_HOME} />;
}
