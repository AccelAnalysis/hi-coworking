import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scoring | Power NOW",
  robots: { index: false, follow: false },
};

export default function ScoreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
