import { BookDetailClient } from "./BookDetailClient";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ id: string }> {
  return [];
}

export default function BookDetailPage() {
  return <BookDetailClient />;
}
