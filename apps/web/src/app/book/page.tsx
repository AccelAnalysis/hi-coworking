"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CalendarDays, Check, Clock3, Loader2, MapPin, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";

const getAvailability = httpsCallable<
  { start: number; end: number },
  {
    start: number;
    end: number;
    options: Array<{ resourceId: string; name: string; type: "SEAT" | "MODE"; available: boolean }>;
  }
>(functions, "booking_getAvailability");

type Quote = {
  resourceId: string;
  resourceName: string;
  resourceType: "SEAT" | "MODE";
  durationHours: number;
  membershipName: string | null;
  includedHoursRemaining: number;
  includedHoursApplied: number;
  billableHours: number;
  hourlyRateCents: number;
  totalCents: number;
  currency: string;
};

const createQuote = httpsCallable<
  { resourceId: string; start: number; end: number },
  Quote
>(functions, "booking_createQuote");

const beginCheckout = httpsCallable<
  {
    resourceId: string;
    start: number;
    end: number;
    successUrl: string;
    cancelUrl: string;
    guest?: { name: string; email: string; phone?: string };
  },
  | { kind: "confirmed"; bookingId: string; quote: Quote }
  | { kind: "checkout"; holdId: string; holdSecret: string; expiresAt: number; paymentId: string; checkoutUrl: string; quote: Quote }
>(functions, "booking_beginCheckout");

type AvailabilityOption = {
  resourceId: string;
  name: string;
  type: "SEAT" | "MODE";
  available: boolean;
};

const DURATIONS = [1, 1.5, 2, 3, 4, 6, 8];

function localDateValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startTimes() {
  const values: string[] = [];
  for (let hour = 8; hour < 20; hour += 1) {
    values.push(`${String(hour).padStart(2, "0")}:00`);
    values.push(`${String(hour).padStart(2, "0")}:30`);
  }
  return values;
}

function toWindow(dateValue: string, timeValue: string, durationHours: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const start = new Date(year, month - 1, day, hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return { start: start.getTime(), end: end.getTime(), startDate: start, endDate: end };
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function BookPage() {
  const { user, loading: authLoading } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [dateValue, setDateValue] = useState(() => localDateValue(today));
  const [timeValue, setTimeValue] = useState("09:00");
  const [duration, setDuration] = useState(2);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const bookingWindow = useMemo(() => toWindow(dateValue, timeValue, duration), [dateValue, timeValue, duration]);
  const validEnd = bookingWindow.endDate.getHours() < 20 || (bookingWindow.endDate.getHours() === 20 && bookingWindow.endDate.getMinutes() === 0);

  useEffect(() => {
    setSelectedResourceId(null);
    setQuote(null);
  }, [dateValue, timeValue, duration]);

  async function checkAvailability() {
    if (!validEnd) {
      setError("That duration runs past 8:00 PM. Choose an earlier time or shorter stay.");
      return;
    }
    setLoadingAvailability(true);
    setError(null);
    setSelectedResourceId(null);
    setQuote(null);
    try {
      const result = await getAvailability({ start: bookingWindow.start, end: bookingWindow.end });
      setOptions(result.data.options);
    } catch (err) {
      console.error(err);
      setOptions([]);
      setError("We could not check live availability. Please try again.");
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function chooseOption(option: AvailabilityOption) {
    if (!option.available) return;
    setSelectedResourceId(option.resourceId);
    setLoadingQuote(true);
    setQuote(null);
    setError(null);
    try {
      const result = await createQuote({
        resourceId: option.resourceId,
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      setQuote(result.data);
    } catch (err) {
      console.error(err);
      setSelectedResourceId(null);
      setError("That option just became unavailable. Check availability again.");
      await checkAvailability();
    } finally {
      setLoadingQuote(false);
    }
  }

  async function checkout() {
    if (!selectedResourceId || !quote) return;
    if (!user && (!guestName.trim() || !guestEmail.trim())) {
      setError("Enter your name and email to continue as a guest.");
      return;
    }
    setCheckingOut(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await beginCheckout({
        resourceId: selectedResourceId,
        start: bookingWindow.start,
        end: bookingWindow.end,
        successUrl: `${origin}/book/complete`,
        cancelUrl: `${origin}/book?checkout=cancelled`,
        ...(!user
          ? { guest: { name: guestName.trim(), email: guestEmail.trim(), phone: guestPhone.trim() } }
          : {}),
      });

      if (result.data.kind === "confirmed") {
        window.location.assign(`/book/complete?bookingId=${encodeURIComponent(result.data.bookingId)}`);
        return;
      }

      window.localStorage.setItem(
        "hi-coworking-booking-hold",
        JSON.stringify({
          holdId: result.data.holdId,
          holdSecret: result.data.holdSecret,
          expiresAt: result.data.expiresAt,
        }),
      );
      window.location.assign(result.data.checkoutUrl);
    } catch (err) {
      console.error(err);
      setError("We could not start checkout. Your card has not been charged. Please check availability and try again.");
      setCheckingOut(false);
    }
  }

  const availableCount = options.filter((option) => option.available).length;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-slate-500">Book a Space</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">When would you like to work?</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">Choose your time first. We will only show desks and setups that are actually available for the full stay.</p>
        </div>

        <section className="mt-8 grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3 sm:p-5">
          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Date</span>
            <input
              type="date"
              min={localDateValue(today)}
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
            />
          </label>

          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 flex items-center gap-2"><Clock3 className="h-4 w-4" /> Start</span>
            <select
              value={timeValue}
              onChange={(event) => setTimeValue(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
            >
              {startTimes().map((value) => (
                <option key={value} value={value}>{new Date(`2000-01-01T${value}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 flex items-center gap-2"><Clock3 className="h-4 w-4" /> Duration</span>
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
            >
              {DURATIONS.map((value) => <option key={value} value={value}>{value} {value === 1 ? "hour" : "hours"}</option>)}
            </select>
          </label>
        </section>

        <button
          type="button"
          onClick={checkAvailability}
          disabled={loadingAvailability || !validEnd}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {loadingAvailability ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          Check availability
        </button>

        {error ? <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div> : null}

        {options.length > 0 ? (
          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-500">Available now</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">Choose your space</h2>
              </div>
              <p className="text-sm text-slate-500">{availableCount} option{availableCount === 1 ? "" : "s"} for the full stay</p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {options.map((option) => {
                const selected = option.resourceId === selectedResourceId;
                return (
                  <button
                    key={option.resourceId}
                    type="button"
                    disabled={!option.available}
                    onClick={() => chooseOption(option)}
                    className={`min-h-28 rounded-2xl p-5 text-left transition ${selected ? "bg-slate-950 text-white" : option.available ? "bg-white ring-1 ring-slate-200 hover:ring-slate-400" : "bg-slate-100 text-slate-400"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                          {option.type === "MODE" ? <Users className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                          {option.name}
                        </div>
                        <p className={`mt-2 text-sm ${selected ? "text-slate-300" : "text-slate-500"}`}>
                          {option.available ? `${bookingWindow.startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${bookingWindow.endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} available` : "Unavailable for this stay"}
                        </p>
                      </div>
                      {selected ? <Check className="h-5 w-5" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-4 text-sm text-slate-500">Prefer to see the layout? <Link href="/spaces" className="font-medium text-slate-900 underline underline-offset-4">View the space</Link>. The floorplan is optional for booking.</p>
          </section>
        ) : null}

        {selectedResourceId ? (
          <section className="mt-10 border-t border-slate-200 pt-8">
            <p className="text-sm font-medium text-slate-500">Your booking</p>
            {loadingQuote ? (
              <div className="mt-4 flex items-center gap-2 text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Calculating your price…</div>
            ) : quote ? (
              <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_320px]">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-950">{quote.resourceName}</h2>
                  <p className="mt-2 text-slate-600">{bookingWindow.startDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · {bookingWindow.startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{bookingWindow.endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>

                  {!user ? (
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Name" autoComplete="name" className="rounded-xl border border-slate-200 px-4 py-3" />
                      <input value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" className="rounded-xl border border-slate-200 px-4 py-3" />
                      <input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="Phone (optional)" type="tel" autoComplete="tel" className="rounded-xl border border-slate-200 px-4 py-3 sm:col-span-2" />
                      <p className="text-sm text-slate-500 sm:col-span-2">No account is required before checkout. We will use these details for your booking and access instructions.</p>
                    </div>
                  ) : null}
                </div>

                <aside className="rounded-2xl bg-slate-50 p-5">
                  <div className="flex items-center justify-between gap-4 text-sm"><span>{quote.durationHours} hours</span><span>{quote.includedHoursApplied > 0 ? `${quote.includedHoursApplied} included` : money(quote.totalCents)}</span></div>
                  {quote.membershipName ? <p className="mt-3 text-sm text-slate-600">{quote.membershipName}</p> : null}
                  {quote.includedHoursApplied > 0 ? (
                    <p className="mt-2 text-sm text-slate-600">{Math.max(0, quote.includedHoursRemaining - quote.includedHoursApplied)} included hours remain after this booking.</p>
                  ) : null}
                  {quote.billableHours > 0 && quote.includedHoursApplied > 0 ? (
                    <p className="mt-2 text-sm text-slate-600">{quote.billableHours} additional hours × {money(quote.hourlyRateCents)}</p>
                  ) : null}
                  <div className="mt-5 flex items-baseline justify-between border-t border-slate-200 pt-4"><span className="font-medium">Total</span><span className="text-2xl font-semibold text-slate-950">{money(quote.totalCents)}</span></div>
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={checkingOut || authLoading}
                    className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {checkingOut ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                    {quote.totalCents === 0 ? "Confirm booking" : "Continue to payment"}
                  </button>
                  <p className="mt-3 text-center text-xs leading-5 text-slate-500">Your space is held for 15 minutes when checkout begins. A booking is not confirmed until payment or included hours are accepted.</p>
                </aside>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
