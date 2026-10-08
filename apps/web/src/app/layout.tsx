import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FormsHostGuard } from "@/components/FormsHostGuard";
import { AuthProvider } from "@/lib/authContext";
import { formsHostGuardScript } from "@/lib/formsHostGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hi Coworking",
  description: "Big ideas. Intimate space. A micro-coworking space designed for focus, flexibility, and real local use.",
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
