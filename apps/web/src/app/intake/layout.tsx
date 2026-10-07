import type { Metadata, Viewport } from "next";
import { AccelBrandFrame } from "@/components/AccelBrandFrame";

export const metadata: Metadata = {
  title: "Lead intake · Accel Analysis",
  description: "Tell Accel Analysis how to follow up. Put AI to work without overwhelming your team.",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Accel Intake",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F2F6FF",
};

export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return <AccelBrandFrame>{children}</AccelBrandFrame>;
}
