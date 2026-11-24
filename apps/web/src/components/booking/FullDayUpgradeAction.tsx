"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2, Sun } from "lucide-react";
import { formatUsdCents } from "@hi/shared";
import { functions } from "@/lib/firebase";
import { callableErrorMessage } from "@/lib/callableError";

type UpgradeQuote = {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
  paidCents: number;
  targetCents: number;
  deltaCents: number;
  incrementalIncludedHours: number;
};

const previewUpgrade = httpsCallable<{ bookingId: string }, UpgradeQuote>(functions, "booking_previewUpgrade");
const beginUpgrade = httpsCallable<
  { bookingId: string; successUrl: string; cancelUrl: string },
  { kind: "applied" | "checkout"; checkoutUrl?: string; upgradeId?: string; upgradeSecret?: string; quote?: UpgradeQuote }
>(functions, "booking_beginUpgrade");

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function FullDayUpgradeAction({
  bookingId,
  resourceId,
  start,
  end,
}: {
  bookingId: string;
  resourceId: string;
  start: number;
  end: number;
}) {
  const [quote, setQuote] = useState<UpgradeQuote | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHidden(false);
    void previewUpgrade({ bookingId })
      .then((result) => {
        if (!cancelled) setQuote(result.data);
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, resourceId, start, end]);

  if (hidden || loading || !quote) return null;

  const priceLabel = quote.deltaCents === 0
    ? "$0 with included hours"
    : `+${formatUsdCents(quote.deltaCents)}`;

  async function confirm() {
    setWorking(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await beginUpgrade({
        bookingId,
        successUrl: `${origin}/my-hi?upgrade=success`,
        cancelUrl: `${origin}/my-hi?upgrade=cancelled`,
      });
      if (result.data.kind === "applied") {
        window.location.reload();
        return;
      }
      if (result.data.upgradeId && result.data.upgradeSecret) {
        window.sessionStorage.setItem(
          "hi-coworking-booking-upgrade",
          JSON.stringify({
            upgradeId: result.data.upgradeId,
            upgradeSecret: result.data.upgradeSecret,
          }),
        );
      }
      if (result.data.checkoutUrl) {
        window.location.assign(result.data.checkoutUrl);
        return;
      }
      throw new Error("Missing checkout URL");
    } catch (caught) {
      setError(callableErrorMessage(caught, "The upgrade could not be started. Your card has not been charged."));
      setWorking(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-[#C5CADB] bg-[#EEF0F6] p-4" data-testid="full-day-upgrade">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#101D4B]">
        <Sun className="h-4 w-4" aria-hidden="true" />
        Upgrade to Full Day
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Extend this visit to 8:00 AM–5:00 PM
        ({timeLabel(quote.toStart)}–{timeLabel(quote.toEnd)}). {priceLabel}.
      </p>
      {error ? <p className="mt-2 text-sm text-rose-800" role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={working}
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#101D4B] px-5 text-sm font-semibold text-white hover:bg-[#3A4675] disabled:opacity-50"
      >
        {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {quote.deltaCents === 0 ? "Upgrade now at no charge" : `Upgrade for ${priceLabel}`}
      </button>
    </div>
  );
}
