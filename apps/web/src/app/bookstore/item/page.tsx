import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import BookstoreItemPage from "./BookstoreItemClient";

function ItemFallback() {
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

export default function BookstoreItemRoute() {
  return (
    <Suspense fallback={<ItemFallback />}>
      <BookstoreItemPage />
    </Suspense>
  );
}
