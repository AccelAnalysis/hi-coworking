import { AlertCircle, RotateCcw } from "lucide-react";
import { refundNoticeCopy, type LastRefund } from "@/lib/refundCopy";

export type { LastRefund };

/**
 * The member's latest membership refund, inside the dark Membership card on
 * SayHi. role="status" so a screen reader hears it politely when the user
 * doc loads; the icon is decorative and the title carries the meaning, so
 * nothing relies on color alone.
 */
export function MembershipRefundNotice({
  refund,
  now,
}: {
  refund: LastRefund | null | undefined;
  now: number;
}) {
  const copy = refundNoticeCopy(refund, now);
  if (!copy) return null;
  const Icon = copy.tone === "warning" ? AlertCircle : RotateCcw;
  return (
    <div
      role="status"
      className="mt-4 flex gap-3 rounded-xl border border-white/20 bg-white/5 p-3"
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 h-4 w-4 shrink-0 ${copy.tone === "warning" ? "text-amber-200" : "text-slate-200"}`}
      />
      <div>
        <p className={`text-sm font-semibold ${copy.tone === "warning" ? "text-amber-200" : "text-white"}`}>
          {copy.title}
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-200">{copy.body}</p>
      </div>
    </div>
  );
}
