import type { Metadata, Viewport } from "next";
import { BoothKioskGuard } from "@/components/BoothKiosk";
import { boothKioskMetadata } from "@/lib/boothKiosk";

export const metadata: Metadata = {
  title: "Follow up · Accel Analysis",
  description: "Tell Accel Analysis how we should follow up with you.",
  robots: { index: false, follow: false },
  ...boothKioskMetadata,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F2F6FF",
};

export default function ExpoAliasLayout({ children }: { children: React.ReactNode }) {
  return <BoothKioskGuard>{children}</BoothKioskGuard>;
}
