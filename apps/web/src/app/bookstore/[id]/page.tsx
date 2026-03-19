import { BookDetailClient } from "./BookDetailClient";
import { STATIC_BOOKSTORE_IDS } from "../staticBookIds";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ id: string }> {
  const ids = STATIC_BOOKSTORE_IDS.length > 0 ? STATIC_BOOKSTORE_IDS : ["placeholder"];
  return ids.map((id: string) => ({ id }));
}

export default function BookDetailPage({ params }: { params: { id: string } }) {
  void params.id;
  return <BookDetailClient />;
}
