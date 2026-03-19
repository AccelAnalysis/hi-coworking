"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { FloorplanCanvas } from "@/components/floorplan/FloorplanCanvas";
import { getFloors, getLocations, getShell, resolvePublishedLayout } from "@/lib/firestore";
import { functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import type { FloorDoc, LayoutVariant, LocationDoc, ShellDoc } from "@hi/shared";
import { RESOURCE_CATALOG, MEMBERSHIP_TIERS, GUEST_PRICING } from "@hi/shared";
import { Calendar, ChevronRight, Clock, Loader2, CheckCircle } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const callCreateBooking = httpsCallable<
  { resourceId: string; start: number; end: number },
  { success: boolean; bookingId: string }
>(functions, "createBooking");

type BookingStep = 1 | 2 | 3;

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

export default function BookPage() {
  const { user, userDoc, loading: authLoading } = useAuth();
  const router = useRouter();

  const [locations, setLocations] = useState<LocationDoc[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | undefined>(undefined);
  const [floors, setFloors] = useState<FloorDoc[]>([]);
  const [shellByFloor, setShellByFloor] = useState<Record<string, ShellDoc>>({});
  const [layoutByFloor, setLayoutByFloor] = useState<Record<string, LayoutVariant>>({});
  const [activeFloorId, setActiveFloorId] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [bookingStep, setBookingStep] = useState<BookingStep>(1);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: number; end: number } | undefined>(undefined);
  
  const [isLoadingFloorplans, setIsLoadingFloorplans] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);

  const loadFloorContext = async (locationId: string) => {
    const loadedFloors = await getFloors(locationId);
    setFloors(loadedFloors);
    setActiveFloorId(loadedFloors[0]?.id);

    const shellMap: Record<string, ShellDoc> = {};
    const layoutMap: Record<string, LayoutVariant> = {};

    await Promise.all(
      loadedFloors.map(async (floor) => {
        const [shell, layout] = await Promise.all([
          getShell(locationId, floor.id),
          resolvePublishedLayout(locationId, floor.id),
        ]);
        if (shell) shellMap[floor.id] = shell;
        if (layout) layoutMap[floor.id] = layout;
      })
    );

    setShellByFloor(shellMap);
    setLayoutByFloor(layoutMap);
  };

  useEffect(() => {
    async function load() {
      try {
        const loadedLocations = await getLocations();
        setLocations(loadedLocations);
        if (loadedLocations.length > 0) {
          const locationId = loadedLocations[0].id;
          setSelectedLocationId(locationId);
          await loadFloorContext(locationId);
        }
      } catch (err) {
        console.error("Failed to load booking floor context", err);
      } finally {
        setIsLoadingFloorplans(false);
      }
    }
    load();
  }, []);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? floors[0],
    [floors, activeFloorId]
  );

  const activeShell = useMemo(
    () => (activeFloor ? shellByFloor[activeFloor.id] : undefined),
    [activeFloor, shellByFloor]
  );

  const activeLayout = useMemo(
    () => (activeFloor ? layoutByFloor[activeFloor.id] : undefined),
    [activeFloor, layoutByFloor]
  );

  const selected = useMemo(
    () => activeLayout?.elements.find((e) => e.id === selectedId),
    [activeLayout, selectedId]
  );

  const selectedResource = useMemo(() => {
    const resourceId = selected?.resourceId;
    if (!resourceId) return undefined;
    return RESOURCE_CATALOG[resourceId];
  }, [selected?.resourceId]);

  const isReadyForConfirm = Boolean(selectedResource && selectedTimeRange);

  const startEnd = useMemo(() => {
    if (!selectedTimeRange) return undefined;
    const start = new Date(selectedDate);
    start.setHours(selectedTimeRange.start, 0, 0, 0);
    const end = new Date(selectedDate);
    end.setHours(selectedTimeRange.end, 0, 0, 0);
    return { start, end };
  }, [selectedDate, selectedTimeRange]);

  const memberTier = useMemo(() => {
    if (!userDoc?.plan || userDoc.membershipStatus !== "active") return undefined;
    return MEMBERSHIP_TIERS.find((t) => t.id === userDoc.plan);
  }, [userDoc]);

  const maxBookingDays = useMemo(() => {
    return memberTier ? memberTier.bookingWindowDays : GUEST_PRICING.bookingWindowDays;
  }, [memberTier]);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + maxBookingDays);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [maxBookingDays]);

  const hourlyRate = useMemo(() => {
    if (!selectedResource) return 0;
    if (selectedResource.type === "MODE") return selectedResource.guestRateHourly;
    if (memberTier) return memberTier.extraHourlyRateCents / 100;
    return selectedResource.guestRateHourly;
  }, [selectedResource, memberTier]);

  const total = useMemo(() => {
    if (!selectedResource || !selectedTimeRange) return 0;
    const hours = selectedTimeRange.end - selectedTimeRange.start;
    return hourlyRate * hours;
  }, [selectedResource, selectedTimeRange, hourlyRate]);

  const handleCreateBooking = async () => {
    if (!selectedResource || !startEnd || !user) {
      // If not logged in, we might want to redirect to login or show guest checkout
      // For MVP, let's require login for now or support guest placeholder
      if (!user) {
        router.push(`/login?redirect=/book`);
        return;
      }
      return;
    }

    setIsSubmitting(true);
    try {
      await callCreateBooking({
        resourceId: selectedResource.id,
        start: startEnd.start.getTime(),
        end: startEnd.end.getTime(),
      });
      setBookingSuccess(true);
    } catch (err: unknown) {
      console.error("Booking failed", err);
      const fbErr = err as { code?: string; message?: string };
      if (fbErr.code === "functions/failed-precondition") {
        alert("That slot is no longer available. Please choose a different time.");
      } else {
        alert("Failed to create booking. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoadingFloorplans) {
    return (
      <AppShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (bookingSuccess) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 animate-in fade-in zoom-in-95 duration-500">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Booking Confirmed!</h2>
          <p className="text-slate-500 max-w-md mb-8">
            Your space has been secured. You can view your upcoming bookings in your dashboard.
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setBookingSuccess(false);
                setBookingStep(1);
                setSelectedId(undefined);
                setSelectedTimeRange(undefined);
              }}
              className="px-6 py-3 rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition"
            >
              Book Another
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-6 py-3 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 transition shadow-lg shadow-slate-900/20"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div>
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">Member / Public</div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Book a space</h1>
            <div className="mt-1 text-sm text-slate-600">Choose a time, then click a bookable spot.</div>
          </div>

          <div className="mt-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Calendar className="h-4 w-4" />
              When
            </div>

            <div className="mt-3">
              <DatePicker
                selected={selectedDate}
                onChange={(date: Date | null) => {
                  if (date) {
                    setSelectedDate(date);
                    setSelectedTimeRange(undefined);
                    setSelectedId(undefined);
                    setBookingStep(1);
                  }
                }}
                minDate={minDate}
                maxDate={maxDate}
                inline
                calendarClassName="!border-slate-200 !rounded-xl !shadow-none !font-sans"
              />
              <p className="mt-2 text-xs text-slate-400">
                {memberTier
                  ? `${memberTier.name}: book up to ${maxBookingDays} days ahead`
                  : `Guest: book up to ${maxBookingDays} days ahead`}
              </p>
            </div>

            <div className="mt-6 flex items-center gap-2 text-sm font-bold text-slate-900">
              <Clock className="h-4 w-4" />
              Start time
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {HOURS.map((h) => (
                <button
                  key={h}
                  onClick={() => {
                    setSelectedTimeRange({ start: h, end: h + 1 });
                    setBookingStep(2);
                  }}
                  className={`rounded-lg px-3 py-3 text-sm font-medium border transition ${
                    selectedTimeRange?.start === h 
                      ? "border-slate-900 bg-slate-50 text-slate-900" 
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                  }`}
                >
                  {h}:00
                </button>
              ))}
            </div>
          </div>

          {bookingStep >= 2 ? (
            <div className="mt-4">
              {activeFloor && activeShell && activeLayout && selectedTimeRange ? (
                <FloorplanCanvas
                  floorplan={{
                    id: activeFloor.id,
                    name: activeFloor.name,
                    levelIndex: activeFloor.levelIndex,
                    canvasWidth: activeFloor.canvasWidth,
                    canvasHeight: activeFloor.canvasHeight,
                    backgroundImageDataUrl: activeFloor.background?.downloadUrl,
                    elements: [],
                  }}
                  shellElements={activeShell.elements}
                  layoutElements={activeLayout.elements}
                  mode="SELECT"
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setBookingStep(3);
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {floors.length === 0 ? (
            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-6 text-sm text-slate-500 text-center">
              {userDoc?.role === "admin" || userDoc?.role === "master"
                ? <>No floorplan has been created yet. <a href="/admin/builder" className="underline text-slate-700 hover:text-slate-900">Visit the Space Builder</a> to create one.</>
                : "Spaces are not available at the moment. Please check back soon."}
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="text-sm font-bold text-slate-900">Location</div>
            <select
              value={selectedLocationId}
              onChange={(e) => {
                const locationId = e.target.value;
                setSelectedLocationId(locationId);
                setSelectedId(undefined);
                void loadFloorContext(locationId);
              }}
              className="mt-3 w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="text-sm font-bold text-slate-900">Floor</div>
            <div className="mt-3 space-y-2">
              {floors.map((f) => {
                const active = f.id === activeFloor?.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setActiveFloorId(f.id);
                      setSelectedId(undefined);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                      active ? "bg-slate-100 text-slate-900 ring-1 ring-slate-300" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 border-t-4 border-t-slate-900">
            <div className="text-lg font-bold text-slate-900 mb-4">Summary</div>
            <div className="space-y-4 text-sm">
              {startEnd ? (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Time</div>
                  <div className="text-slate-900 font-medium mt-1">
                    {startEnd.start.toLocaleDateString()} {startEnd.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                    {startEnd.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
              ) : null}

              {selectedResource ? (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Space</div>
                  <div className="text-slate-900 font-bold mt-1 text-lg">{selectedResource.name}</div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-200 pt-2">
                    <span>{memberTier ? `${memberTier.name} rate` : "Guest rate"}</span>
                    <span>${hourlyRate}/hr</span>
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 italic text-center py-4">Pick a time, then click a seat/mode.</div>
              )}

              {isReadyForConfirm ? (
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-lg font-bold text-slate-900">Total</div>
                    <div className="text-lg font-bold text-slate-900">${total}</div>
                  </div>
                  <button
                    disabled={isSubmitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-70 disabled:cursor-not-allowed"
                    onClick={handleCreateBooking}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Confirming...
                      </>
                    ) : (
                      <>
                        Confirm & Pay
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
