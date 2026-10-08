import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FormsHostGuard } from "@/components/FormsHostGuard";
import { AuthProvider } from "@/lib/authContext";
import { formsHostGuardScript } from "@/lib/formsHostGuard";
import { HOME_DESCRIPTION, HOME_TITLE, PUBLIC_SITE_ORIGIN } from "@/lib/publicSite";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-dvh`}
      >
        <Script id="forms-host-guard" strategy="beforeInteractive">
          {formsHostGuardScript()}
        </Script>
        <FormsHostGuard />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
