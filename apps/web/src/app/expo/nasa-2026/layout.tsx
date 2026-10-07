import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "NASA Expo lead capture · Accel Analysis",
  description: "Booth lead capture for Accel Analysis at the NASA Business Vendor Expo on October 20, 2026.",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Expo Leads",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c1b2a",
};

export default function NasaExpoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
