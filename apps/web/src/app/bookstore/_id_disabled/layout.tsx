import type { ReactNode } from "react";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ id: string }> {
  return [];
}

export default function BookDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
