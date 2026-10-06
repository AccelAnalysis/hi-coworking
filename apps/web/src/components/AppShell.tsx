"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Calendar,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authContext";
import { subscribeToUnreadCount } from "@/lib/firestore";

const publicLinks = [
  { href: "/spaces", label: "Spaces" },
  { href: "/pricing", label: "Pricing" },
  { href: "/events", label: "Events" },
  { href: "/bookstore", label: "Bookstore" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function AppShell({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, role, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeToUnreadCount(user.uid, setUnreadCount);
  }, [user]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (
        avatarRef.current
        && !avatarRef.current.contains(event.target as Node)
      ) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setAvatarOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    setAvatarOpen(false);
    setDrawerOpen(false);
    await signOut();
    router.refresh();
    router.push("/login");
  }

  const isAdmin = role === "admin" || role === "master";
  const isStaff = role === "staff" || isAdmin;

  function PublicNavLink({
    href,
    label,
    mobile = false,
  }: {
    href: string;
    label: string;
    mobile?: boolean;
  }) {
    return (
      <Link
        href={href}
        className={cn(
          mobile
            ? "block py-2 text-sm font-medium transition-colors"
            : "text-sm font-medium transition hover:text-indigo-300",
          pathname === href
            ? mobile
              ? "text-indigo-600"
              : "text-indigo-300"
            : mobile
              ? "text-slate-700 hover:text-indigo-600"
              : "text-slate-300",
        )}
      >
        {label}
      </Link>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <nav className="sticky top-0 z-50 bg-slate-900 text-white shadow-lg">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl rounded-bl-none bg-white text-sm font-bold text-slate-900 shadow-lg shadow-white/10">
                Hi
              </div>
              <span className="text-xl font-bold tracking-tight">Coworking</span>
            </Link>

            <div className="hidden gap-5 lg:flex">
              {publicLinks.map((item) => (
                <PublicNavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!loading && (
              user ? (
                <>
                  <Link
                    href="/notifications"
                    className="relative p-1.5 text-slate-400 transition hover:text-white"
                    title="Notifications"
                    aria-label="Notifications"
                  >
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </Link>

                  <div className="relative" ref={avatarRef}>
                    <button
                      type="button"
                      onClick={() => setAvatarOpen((open) => !open)}
                      className="flex items-center gap-1.5 rounded-full p-1 transition hover:bg-slate-800"
                      aria-expanded={avatarOpen}
                      aria-label="Open account menu"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white ring-2 ring-slate-600">
                        {user.displayName
                          ? user.displayName[0].toUpperCase()
                          : <User className="h-4 w-4" />}
                      </div>
                      <ChevronDown
                        className={cn(
                          "hidden h-3.5 w-3.5 text-slate-400 transition-transform sm:block",
                          avatarOpen && "rotate-180",
                        )}
                      />
                    </button>

                    {avatarOpen && (
                      <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl bg-white py-1 text-slate-900 shadow-xl ring-1 ring-slate-200">
                        <div className="border-b border-slate-100 px-4 py-3">
                          <p className="truncate text-sm font-bold">
                            {user.displayName || "Account"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {user.email}
                          </p>
                        </div>

                        <Link
                          href="/account/bookings"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50"
                        >
                          <Calendar className="h-4 w-4 text-slate-400" />
                          Bookings
                        </Link>
                        <Link
                          href="/notifications"
                          className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50"
                        >
                          <Bell className="h-4 w-4 text-slate-400" />
                          Notifications
                          {unreadCount > 0 && (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                              {unreadCount}
                            </span>
                          )}
                        </Link>

                        {isStaff && (
                          <Link
                            href="/staff"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-emerald-700 transition-colors hover:bg-emerald-50"
                          >
                            <User className="h-4 w-4 text-emerald-500" />
                            Staff
                          </Link>
                        )}
                        {isAdmin && (
                          <Link
                            href="/admin/dashboard"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-amber-700 transition-colors hover:bg-amber-50"
                          >
                            <LayoutDashboard className="h-4 w-4 text-amber-500" />
                            Admin
                          </Link>
                        )}

                        <div className="my-1 border-t border-slate-100" />
                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign out
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="p-1.5 text-slate-400 transition hover:text-white lg:hidden"
                    aria-label="Open menu"
                  >
                    <Menu className="h-6 w-6" />
                  </button>
                </>
              ) : (
                <>
                  <div className="hidden items-center gap-3 sm:flex">
                    <Link
                      href="/login"
                      className="text-sm font-medium text-slate-300 transition hover:text-white"
                    >
                      Log in
                    </Link>
                    <Link
                      href="/register"
                      className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-slate-100"
                    >
                      Sign up
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="p-1.5 text-slate-400 transition hover:text-white sm:hidden"
                    aria-label="Open menu"
                  >
                    <Menu className="h-6 w-6" />
                  </button>
                </>
              )
            )}
          </div>
        </div>
      </nav>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          />
          <div className="fixed bottom-0 right-0 top-0 z-50 w-72 overflow-y-auto bg-white shadow-2xl lg:hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <Link
                href="/"
                className="flex items-center gap-2"
                onClick={() => setDrawerOpen(false)}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-xl rounded-bl-none bg-slate-900 text-xs font-bold text-white">
                  Hi
                </div>
                <span className="text-lg font-bold text-slate-900">Coworking</span>
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-4">
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Explore
                </p>
                {publicLinks.map((item) => (
                  <PublicNavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    mobile
                  />
                ))}
              </div>

              {user ? (
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Account
                  </p>
                  <Link
                    href="/account/bookings"
                    className="flex items-center gap-3 py-2 text-sm font-medium text-slate-700 hover:text-indigo-600"
                  >
                    <Calendar className="h-4 w-4 text-slate-400" />
                    Bookings
                  </Link>
                  <Link
                    href="/notifications"
                    className="flex items-center gap-3 py-2 text-sm font-medium text-slate-700 hover:text-indigo-600"
                  >
                    <Bell className="h-4 w-4 text-slate-400" />
                    Notifications
                  </Link>
                  {isStaff && (
                    <Link
                      href="/staff"
                      className="flex items-center gap-3 py-2 text-sm font-medium text-emerald-700"
                    >
                      <User className="h-4 w-4 text-emerald-500" />
                      Staff
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      href="/admin/dashboard"
                      className="flex items-center gap-3 py-2 text-sm font-medium text-amber-700"
                    >
                      <LayoutDashboard className="h-4 w-4 text-amber-500" />
                      Admin
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-3 py-2 text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <Link
                    href="/login"
                    className="block w-full rounded-xl border border-slate-200 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/register"
                    className="block w-full rounded-xl bg-slate-900 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <main
        className={cn(
          "w-full flex-1",
          !fullWidth && "mx-auto max-w-7xl px-6 py-8",
          fullWidth && "bg-slate-50",
        )}
      >
        {children}
      </main>

      <footer className="mt-auto border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-8 grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <Link href="/" className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-xl rounded-bl-none bg-slate-900 text-xs font-bold text-white">
                  Hi
                </div>
                <span className="text-lg font-bold text-slate-900">Coworking</span>
              </Link>
              <p className="text-sm leading-relaxed text-slate-500">
                Big ideas. Intimate space.
                <br />
                A micro-coworking space built for focus, flexibility, and real local use.
              </p>
            </div>

            <div>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-900">
                Explore
              </h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/spaces" className="text-slate-500 hover:text-slate-900">Spaces</Link></li>
                <li><Link href="/book" className="text-slate-500 hover:text-slate-900">Book a Space</Link></li>
                <li><Link href="/pricing" className="text-slate-500 hover:text-slate-900">Pricing</Link></li>
                <li><Link href="/events" className="text-slate-500 hover:text-slate-900">Events</Link></li>
                <li><Link href="/bookstore" className="text-slate-500 hover:text-slate-900">Bookstore</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-900">
                Company
              </h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/about" className="text-slate-500 hover:text-slate-900">About</Link></li>
                <li><Link href="/contact" className="text-slate-500 hover:text-slate-900">Contact</Link></li>
                {isStaff && (
                  <li><Link href="/staff" className="text-slate-500 hover:text-slate-900">Staff</Link></li>
                )}
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-900">
                Legal
              </h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/terms" className="text-slate-500 hover:text-slate-900">Terms of Service</Link></li>
                <li><Link href="/privacy" className="text-slate-500 hover:text-slate-900">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-6 sm:flex-row">
            <p className="text-xs text-slate-400">
              &copy; {new Date().getFullYear()} Hi Coworking. All rights reserved.
            </p>
            <p className="text-xs text-slate-400">Carrollton, VA</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
