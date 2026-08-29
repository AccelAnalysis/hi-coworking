"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export function BookDetailClient() {
  const params = useParams();
  const router = useRouter();
  const bookId = String(params.id || "");

  useEffect(() => {
    if (bookId) {
      router.replace(`/bookstore/item?id=${encodeURIComponent(bookId)}`);
    } else {
      router.replace("/bookstore");
    }
  }, [bookId, router]);

  return (
    <AppShell>
      <div className="flex min-h-[55vh] items-center justify-center" role="status" aria-live="polite">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          Opening book…
        </div>
      </div>
    </AppShell>
  );
}
