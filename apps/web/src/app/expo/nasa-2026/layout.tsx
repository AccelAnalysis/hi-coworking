import type { Metadata, Viewport } from "next";
import { NASA_EXPO_EVENT } from "@/lib/expoNasaLead";

export const metadata: Metadata = {
  title: "Follow up · Accel Analysis",
  description: "Tell Accel Analysis how we should follow up with you.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F2F6FF",
};

export default function ExpoAliasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <meta httpEquiv="refresh" content={`1;url=/intake?event=${NASA_EXPO_EVENT}`} />
      {children}
    </>
  );
}
