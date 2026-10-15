import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rubric | Power NOW",
  robots: { index: false, follow: false },
};

export default function RubricLayout({ children }: { children: React.ReactNode }) {
  return children;
}
