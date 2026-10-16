import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Judges and pitchers | Power NOW",
  robots: { index: false, follow: false },
};

export default function JudgesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
