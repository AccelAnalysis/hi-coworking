import type { Metadata, Viewport } from "next";
import { AccelBrandFrame } from "@/components/AccelBrandFrame";

export const metadata: Metadata = {
  title: "Follow up · Accel Analysis",
  description: "Tell Accel Analysis how we should follow up with you.",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Accel Analysis",
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
