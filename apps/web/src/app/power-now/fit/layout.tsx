import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fit conversation | Power NOW",
  robots: { index: false, follow: false },
};

export default function FitLayout({ children }: { children: React.ReactNode }) {
  return children;
}
