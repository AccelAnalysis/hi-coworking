import type { Metadata } from "next";
import { MEMBER_HI_HOME } from "@/lib/rfxQuarantine";
import { QuarantinePage, quarantineMetadata } from "@/lib/quarantineRoute";

export const metadata: Metadata = quarantineMetadata;

export default function Page() {
  return <QuarantinePage href={MEMBER_HI_HOME} />;
}
