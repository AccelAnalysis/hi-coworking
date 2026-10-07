import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Lead intake · Accel Analysis",
  description: "Accel Analysis lead intake.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F2F6FF",
};

export default function ExpoAliasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
