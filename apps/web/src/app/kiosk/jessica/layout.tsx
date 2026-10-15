import type { Metadata, Viewport } from "next";
import { AccelBrandFrame } from "@/components/AccelBrandFrame";

export const metadata: Metadata = {
  title: { absolute: "Jessica · Accel Analysis" },
  description: "Accel Analysis voice assistant. Contact details are entered on the intake form, not here.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#00072E",
};

export default function JessicaKioskLayout({ children }: { children: React.ReactNode }) {
  return <AccelBrandFrame>{children}</AccelBrandFrame>;
}
