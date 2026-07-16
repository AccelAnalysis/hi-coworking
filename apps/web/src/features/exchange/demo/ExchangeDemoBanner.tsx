import { FlaskConical } from "lucide-react";

export function ExchangeDemoBanner() {
  return (
    <div
      className="flex shrink-0 items-center justify-center gap-2 border-b border-violet-300 bg-violet-100 px-3 py-2 text-xs font-bold text-violet-950"
      role="status"
      data-testid="exchange-demo-banner"
    >
      <FlaskConical className="h-4 w-4" aria-hidden="true" />
      Development demo data — actions stay in this browser session and never write to Firebase.
    </div>
  );
}
