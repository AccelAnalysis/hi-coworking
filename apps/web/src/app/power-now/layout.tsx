import type { Metadata, Viewport } from "next";
import "./power-now.css";

export const metadata: Metadata = {
  title: "Power NOW Pitch Competition presented by Accel Analysis",
  description:
    "Join the list to pitch your business, watch a pitch night, or contribute to the prize pack.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

/**
 * Draft interest page. Stays noindex and out of any sitemap until Jonathan
 * approves making it public. This app has no sitemap route.
 */
export default function PowerNowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pn"
      style={{
        ["--pn-display" as string]: '"Playfair Display", Georgia, "Times New Roman", serif',
        ["--pn-body" as string]: '"Open Sans", Arial, Helvetica, sans-serif',
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&family=Playfair+Display:wght@700&display=swap"
      />
      {children}
    </div>
  );
}
