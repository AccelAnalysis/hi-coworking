"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import {
  beginEventRegistration,
  eventAvailableSeats,
  joinEventWaitlistV2,
  type EventPublic,
} from "@/lib/eventsV2";

function money(cents: number, currency = "usd") {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function EventRegistrationPanel({ event }: { event: EventPublic }) {
  const { user, userDoc } = useAuth();
  const activeMember = userDoc?.membershipStatus === "active" && Boolean(userDoc.plan);
  const available = eventAvailableSeats(event);
  const ticketOptions = useMemo(() => (
    (event.ticketTypes || []).filter((ticket) => (
      ticket.targetAudience !== "vip"
      && (ticket.targetAudience !== "member" || activeMember)
    ))
  ), [event.ticketTypes, activeMember]);
  const [ticketTypeId, setTicketTypeId] = useState(ticketOptions[0]?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);

  const selectedTicket = ticketOptions.find((ticket) => ticket.id === ticketTypeId);
  const publicPrice = selectedTicket?.priceCents ?? event.price ?? 0;
  const effectivePrice = !selectedTicket && activeMember && typeof event.memberPriceCents === "number"
    ? Math.min(publicPrice, event.memberPriceCents)
    : publicPrice;
  const soldOut = available !== null && available < quantity;
  const eventClosed = event.status !== "published" || event.startTime <= Date.now();

  async function register() {
    setMessage(null);
    setBusy(true);
    try {
      const result = await beginEventRegistration({
        eventId: event.id,
        ticketTypeId: ticketTypeId || undefined,
        quantity,
        ...(!user ? { guest: { name: name.trim(), email: email.trim() } } : {}),
        successUrl: `${window.location.origin}/events/complete?event=${encodeURIComponent(event.slug || event.id)}`,
        cancelUrl: window.location.href,
      });
      if (result.data.kind === "full") {
        setMessage("That spot was just taken. You can join the waitlist instead.");
        return;
      }
      if (result.data.kind === "confirmed") {
        setConfirmed(true);
        return;
      }
      sessionStorage.setItem("hi:eventCheckout", JSON.stringify({
        holdId: result.data.holdId,
        holdSecret: result.data.holdSecret,
        eventId: event.id,
        eventSlug: event.slug || event.id,
        expiresAt: result.data.expiresAt,
      }));
      window.location.assign(result.data.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not complete registration. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist() {
    setMessage(null);
    setBusy(true);
    try {
      await joinEventWaitlistV2({
        eventId: event.id,
        ticketTypeId: ticketTypeId || undefined,
        quantity,
        ...(!user ? { guest: { name: name.trim(), email: email.trim() } } : {}),
      });
      setWaitlisted(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not add you to the waitlist.");
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <div className="rounded-3xl bg-emerald-50 p-6 text-emerald-950">
        <CheckCircle2 className="h-7 w-7" />
        <h2 className="mt-3 text-xl font-semibold">You&apos;re registered.</h2>
        <p className="mt-1 text-sm text-emerald-800">We&apos;ll send your confirmation and event details by email.</p>
      </div>
    );
  }

  if (waitlisted) {
    return (
      <div className="rounded-3xl bg-sky-50 p-6 text-sky-950">
        <Users className="h-7 w-7" />
        <h2 className="mt-3 text-xl font-semibold">You&apos;re on the waitlist.</h2>
        <p className="mt-1 text-sm text-sky-800">If a spot opens, we&apos;ll reserve it temporarily and email you a claim link.</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Registration</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{money(effectivePrice, event.currency)}</h2>
          {activeMember && effectivePrice < publicPrice && (
            <p className="mt-1 text-sm text-slate-500">
              Member price · public price <span className="line-through">{money(publicPrice, event.currency)}</span>
            </p>
          )}
        </div>
        {available !== null && (
          <p className={`text-sm font-medium ${available === 0 ? "text-rose-600" : "text-slate-500"}`}>
            {available === 0 ? "Full" : `${available} spot${available === 1 ? "" : "s"} left`}
          </p>
        )}
      </div>

      {ticketOptions.length > 0 && (
        <label className="mt-5 block text-sm font-medium text-slate-700">
          Ticket
          <select
            value={ticketTypeId}
            onChange={(event) => setTicketTypeId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
          >
            {ticketOptions.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.name} · {money(ticket.priceCents, event.currency)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block text-sm font-medium text-slate-700">
        Tickets
        <select
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>

      {!user && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
            />
          </label>
        </div>
      )}

      {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}

      <button
        type="button"
        onClick={soldOut ? joinWaitlist : register}
        disabled={busy || eventClosed || (!user && (!name.trim() || !email.trim()))}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {eventClosed ? "Registration closed" : soldOut ? "Join waitlist" : effectivePrice === 0 ? "RSVP" : "Continue to payment"}
      </button>

      {!user && (
        <p className="mt-3 text-center text-xs text-slate-500">
          No account required. We&apos;ll email you a secure link to manage your registration.
        </p>
      )}
    </div>
  );
}
