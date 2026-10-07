import type { Metadata, Viewport } from "next";
import { JessicaKiosk } from "@/booth/JessicaKiosk";

export const metadata: Metadata = {
  title: { absolute: "Jessica · Accel Analysis NASA Expo" },
  description: "Booth voice kiosk for Accel Analysis. Contact details are entered on the iPad, not here.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c1210",
};

/**
 * TV kiosk beside the NASA Expo iPad form.
 * The form page at /expo/nasa-2026 is owned by another branch; this route only adds /kiosk.
 */
export default function JessicaKioskPage() {
  return <JessicaKiosk />;
}
