import type { Metadata, Viewport } from "next";

const APPLE_TOUCH_ICON = "/brand/hi-coworking/apple-touch-icon-180.png";

export const metadata: Metadata = {
  title: { absolute: "Front desk · Hi Coworking" },
  description: "Member check-in and check-out at the front desk.",
  robots: { index: false, follow: false },
  manifest: "/kiosk/front-desk.webmanifest",
  appleWebApp: { capable: true, title: "Front desk", statusBarStyle: "black-translucent" },
  icons: { apple: [{ url: APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }] },
  other: { "apple-mobile-web-app-capable": "yes", "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101D4B",
};

/** No AppShell and no site navigation: the iPad stays on this screen. */
export default function FrontDeskKioskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
