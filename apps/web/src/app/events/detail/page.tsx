"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import { AddToCalendar } from "@/components/AddToCalendar";
import {
  getEvent,
  getUserRegistration,
} from "@/lib/firestore";
import {
  cancelEventRegistrationFn,
  createTicketCheckoutFn,
  createSponsorshipCheckoutFn,
  registerFreeEventFn,
  joinEventWaitlistFn,
} from "@/lib/functions";
import type { EventDoc, EventRegistrationDoc } from "@hi/shared";
import Link from "next/link";
import {
  Calendar,
  MapPin,
  Video,
  Users,
  Loader2,
  Clock,
  DollarSign,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Play,
  ExternalLink,
  LinkIcon,
  Shield,
} from "lucide-react";

export default function EventDetailPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
      <EventDetailContent />
    </Suspense>
  );
}

function EventDetailContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("id");
  const { user, userDoc } = useAuth();

  const [event, setEvent] = useState<EventDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [registration, setRegistration] = useState<EventRegistrationDoc | null>(null);
  const [registering, setRegistering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [sponsoring, setSponsoring] = useState(false);

  const fetchData = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [ev, reg] = await Promise.all([
        getEvent(eventId),
        user ? getUserRegistration(eventId, user.uid) : null,
      ]);
      setEvent(ev);
      setRegistration(reg);
      // Default to first ticket type if available
      if (ev?.ticketTypes && ev.ticketTypes.length > 0) {
        setSelectedTicketId(ev.ticketTypes[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch event:", err);
    } finally {
      setLoading(false);
    }
  }, [eventId, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRegister = async () => {
    if (!event || !user) return;

    // Determine effective price
    let priceCents = event.price || 0;
    let ticketTypeId: string | undefined = undefined;

    if (event.ticketTypes && event.ticketTypes.length > 0) {
      const selected = event.ticketTypes.find(t => t.id === selectedTicketId);
      if (selected) {
        priceCents = selected.priceCents;
        ticketTypeId = selected.id;
      }
    }

    // For paid events, redirect to payment
    if (priceCents > 0) {
      setRegistering(true);
      try {
        const result = await createTicketCheckoutFn({
          eventId: event.id,
          ticketTypeId,
          quantity: 1,
          successUrl: `${window.location.origin}/events/detail?id=${event.id}&registered=true`,
          cancelUrl: window.location.href,
        });
        window.location.href = result.data.url;
      } catch (err) {
        console.error("Payment failed:", err);
        setRegistering(false);
      }
      return;
    }

    // Free event — register via callable (server-authoritative)
    setRegistering(true);
    try {
      await registerFreeEventFn({
        eventId: event.id,
        displayName: userDoc?.displayName || user.displayName || "",
        email: userDoc?.email || user.email || "",
      });
      await fetchData();
    } catch (err) {
      console.error("Registration failed:", err);
    } finally {
      setRegistering(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!event || !user) return;
    setJoiningWaitlist(true);
    try {
      await joinEventWaitlistFn({
        eventId: event.id,
        displayName: userDoc?.displayName || user.displayName || "",
        email: userDoc?.email || user.email || "",
      });
      alert("You have been added to the waitlist.");
    } catch (err) {
      console.error("Waitlist join failed:", err);
    } finally {
      setJoiningWaitlist(false);
    }
  };

  const handleCancel = async () => {
    if (!event || !user) return;
    setCancelling(true);
    try {
      await cancelEventRegistrationFn({ eventId: event.id });
      await fetchData();
    } catch (err) {
      console.error("Cancellation failed:", err);
    } finally {
      setCancelling(false);
    }
  };

  const handleSponsor = async (tierId: string) => {
    if (!event || !user) return;
    setSponsoring(true);
    try {
      const result = await createSponsorshipCheckoutFn({
        eventId: event.id,
        sponsorshipTierId: tierId,
        successUrl: `${window.location.origin}/events/detail?id=${event.id}&sponsored=true`,
        cancelUrl: window.location.href,
      });
      window.location.href = result.data.url;
    } catch (err) {
      console.error("Sponsorship failed:", err);
      alert("Failed to initiate sponsorship. Please try again.");
      setSponsoring(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (!event) {
    return (
      <AppShell>
        <div className="text-center py-24">
          <h2 className="text-lg font-semibold text-slate-700">Event not found</h2>
          <Link href="/events" className="text-sm text-indigo-600 hover:text-indigo-700 mt-2 inline-block">
            Back to events
          </Link>
        </div>
      </AppShell>
    );
  }

  const isFree = !event.price || event.price === 0;
  const isFull = event.seatCap ? event.registrationCount >= event.seatCap : false;
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const isRegistered = !!registration;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to events
        </Link>

        {/* Event header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border inline-flex items-center gap-1 ${
              event.format === "in-person" ? "bg-blue-50 text-blue-700 border-blue-200" :
              event.format === "virtual" ? "bg-purple-50 text-purple-700 border-purple-200" :
              "bg-amber-50 text-amber-700 border-amber-200"
            }`}>
              {event.format === "in-person" ? <MapPin className="h-3 w-3" /> :
               event.format === "virtual" ? <Video className="h-3 w-3" /> :
               <Users className="h-3 w-3" />}
              {event.format}
            </span>
            {event.status === "cancelled" && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                Cancelled
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {event.title}
          </h1>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Date & Time
            </span>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {startDate.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <Clock className="h-3 w-3" />
              {startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
              {endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Price
            </span>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {isFree ? "Free" : `$${(event.price / 100).toFixed(2)} ${event.currency}`}
            </div>
            {event.seatCap && (
              <div className={`text-xs mt-0.5 ${isFull ? "text-red-500 font-medium" : "text-slate-500"}`}>
                {event.registrationCount}/{event.seatCap} seats filled
              </div>
            )}
          </div>

          {event.location && (
            <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <span className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Location
              </span>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {event.location}
              </div>
            </div>
          )}

          {event.virtualUrl && isRegistered && (
            <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <span className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1">
                <Video className="h-3 w-3" /> Virtual Link
              </span>
              <a
                href={event.virtualUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
              >
                Join Virtual Event <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-slate-900 mb-2">About This Event</h2>
          <div className="prose prose-sm prose-slate max-w-none">
            <p className="text-sm text-slate-600 whitespace-pre-wrap">
              {event.description}
            </p>
          </div>
        </div>

        <div className="mb-8">
          <AddToCalendar event={event} />
        </div>

        {/* Recording */}
        {event.recordingUrl && (
          <div className="mb-8 p-4 rounded-xl bg-indigo-50 border border-indigo-200">
            <div className="flex items-center gap-2">
              <Play className="h-5 w-5 text-indigo-600" />
              <div>
                <span className="text-sm font-bold text-indigo-900">Recording Available</span>
                <a
                  href={event.recordingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700 mt-0.5 inline-flex items-center gap-1"
                >
                  Watch recording <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Linked RFx */}
        {event.linkedRfxId && (
          <div className="mb-8 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5 text-amber-600" />
              <div>
                <span className="text-sm font-bold text-amber-900">Related RFx Opportunity</span>
                <Link
                  href={`/rfx/detail?id=${event.linkedRfxId}`}
                  className="block text-xs text-amber-700 hover:text-amber-800 mt-0.5"
                >
                  View RFx →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Registration CTA */}
        {event.status === "published" && (
          <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {!user ? (
              <div className="text-center">
                <p className="text-sm text-slate-600 mb-3">Log in to register for this event.</p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
                >
                  Log In to Register
                </Link>
              </div>
            ) : isRegistered ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span className="text-sm font-bold text-emerald-700">You&apos;re registered!</span>
                </div>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="px-4 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                  {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Cancel Registration
                </button>
              </div>
            ) : isFull ? (
              <div className="text-center">
                <p className="text-sm font-medium text-red-600">This event is full.</p>
                {user && (
                  <button
                    onClick={handleJoinWaitlist}
                    disabled={joiningWaitlist}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-60"
                  >
                    {joiningWaitlist ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                    Join Waitlist
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center">
                <button
                  onClick={handleRegister}
                  disabled={registering}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-60"
                >
                  {registering ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {isFree ? "Register (Free)" : `Register — $${(event.price / 100).toFixed(2)}`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Sponsorships */}
        {event.sponsorships && event.sponsorships.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-600" /> Sponsorship Opportunities
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {event.sponsorships.map((tier) => {
                const isSoldOut = tier.soldCount >= tier.slots;
                return (
                  <div key={tier.id} className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-slate-900">{tier.name}</h3>
                      <span className="font-bold text-slate-900">${(tier.priceCents / 100).toFixed(0)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mb-4">
                      {tier.soldCount} / {tier.slots} spots taken
                    </div>
                    
                    <div className="mt-auto">
                      {isSoldOut ? (
                        <button disabled className="w-full py-2 rounded-lg bg-slate-100 text-slate-400 text-sm font-medium cursor-not-allowed">
                          Sold Out
                        </button>
                      ) : !user ? (
                        <Link href="/login" className="block w-full text-center py-2 rounded-lg bg-indigo-50 text-indigo-600 text-sm font-medium hover:bg-indigo-100">
                          Log in to Sponsor
                        </Link>
                      ) : (
                        <button
                          onClick={() => handleSponsor(tier.id)}
                          disabled={sponsoring}
                          className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {sponsoring ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Sponsor Now"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
