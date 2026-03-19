"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Calendar,
  LogOut,
  User,
  Users,
  Briefcase,
  ClipboardList,
  Bell,
  Menu,
  X,
  ChevronDown,
  Gift,
  Building2,
} from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useEffect, useState, useRef } from "react";
import { subscribeToUnreadCount } from "@/lib/firestore";

export function AppShell({ children, fullWidth = false }: { children: React.ReactNode; fullWidth?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, role, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUnreadCount(user.uid, setUnreadCount);
    return () => unsub();
  }, [user]);

  // Close avatar dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
    setAvatarOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    setAvatarOpen(false);
    setDrawerOpen(false);
    await signOut();
    router.refresh();
    router.push("/login");
  };

  const publicLinks = [
    { href: "/spaces", label: "Spaces" },
    { href: "/pricing", label: "Pricing" },
    { href: "/events", label: "Events" },
    { href: "/bookstore", label: "Bookstore" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ];

  const memberLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/book", label: "Book Space", icon: Calendar },
    { href: "/rfx", label: "RFx", icon: ClipboardList },
    { href: "/directory", label: "Directory", icon: Users },
    { href: "/referrals", label: "Referrals", icon: Gift },
  ];

  const staffLinks = [
    { href: "/staff", label: "Staff Portal", icon: User },
  ];

  const adminLinks = [
    { href: "/admin/dashboard", label: "Admin", icon: LayoutDashboard },
  ];

  // Claims-based role check (PR-02)
  const isAdmin = role === "admin" || role === "master";
  const isStaff = role === "staff" || isAdmin;

  const NavLink = ({ href, label, className }: { href: string; label: string; className?: string }) => (
    <Link
      href={href}
      className={cn(
        "hover:text-indigo-300 transition text-sm font-medium",
        pathname === href ? "text-indigo-300" : "text-slate-300",
        className
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-dvh flex flex-col">
      {/* ── Top Nav ── */}
      <nav className="bg-slate-900 text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center w-full px-4 h-16">
          {/* Left: Logo + public links */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 bg-white rounded-2xl rounded-bl-none flex items-center justify-center text-slate-900 text-sm font-bold shadow-lg shadow-white/10">Hi</div>
              <span className="font-bold text-xl tracking-tight">Coworking</span>
            </Link>

            <div className="hidden lg:flex gap-5">
              {publicLinks.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
              ))}
            </div>
          </div>

          {/* Right: auth-aware actions */}
          <div className="flex items-center gap-3">
            {!loading && (
              <>
                {user ? (
                  <>
                    {/* Desktop member links */}
                    <div className="hidden lg:flex items-center gap-4 text-sm font-medium border-r border-slate-700 pr-4 mr-1">
                      {memberLinks.map((item) => (
                        <NavLink key={item.href} href={item.href} label={item.label} />
                      ))}
                      {isStaff && staffLinks.map((item) => (
                        <NavLink key={item.href} href={item.href} label={item.label} className="text-emerald-400 hover:text-emerald-300" />
                      ))}
                      {isAdmin && adminLinks.map((item) => (
                        <NavLink key={item.href} href={item.href} label={item.label} className="text-amber-400 hover:text-amber-300" />
                      ))}
                    </div>

                    {/* Notification bell */}
                    <Link
                      href="/notifications"
                      className="relative text-slate-400 hover:text-white transition p-1.5"
                      title="Notifications"
                    >
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </Link>

                    {/* Avatar dropdown */}
                    <div className="relative" ref={avatarRef}>
                      <button
                        onClick={() => setAvatarOpen(!avatarOpen)}
                        className="flex items-center gap-1.5 p-1 rounded-full hover:bg-slate-800 transition"
                      >
                        <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white ring-2 ring-slate-600">
                          {user.displayName ? user.displayName[0].toUpperCase() : <User className="h-4 w-4" />}
                        </div>
                        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform hidden sm:block", avatarOpen && "rotate-180")} />
                      </button>

                      {avatarOpen && (
                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl ring-1 ring-slate-200 py-1 z-50 text-slate-900 animate-in fade-in slide-in-from-top-1 duration-150">
                          {/* User info */}
                          <div className="px-4 py-3 border-b border-slate-100">
                            <p className="text-sm font-bold truncate">{user.displayName || "User"}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                          </div>

                          <Link href="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors">
                            <Briefcase className="h-4 w-4 text-slate-400" /> Profile
                          </Link>
                          <Link href="/notifications" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors">
                            <Bell className="h-4 w-4 text-slate-400" /> Notifications
                            {unreadCount > 0 && (
                              <span className="ml-auto h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
                                {unreadCount}
                              </span>
                            )}
                          </Link>
                          <Link href="/referrals" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors">
                            <Gift className="h-4 w-4 text-slate-400" /> Referrals
                          </Link>
                          <Link href="/org/dashboard" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors">
                            <Building2 className="h-4 w-4 text-slate-400" /> Organization
                          </Link>

                          <div className="border-t border-slate-100 my-1" />

                          <button
                            onClick={handleSignOut}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 text-red-600 transition-colors w-full"
                          >
                            <LogOut className="h-4 w-4" /> Sign Out
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Mobile hamburger */}
                    <button
                      onClick={() => setDrawerOpen(true)}
                      className="lg:hidden p-1.5 text-slate-400 hover:text-white transition"
                      aria-label="Open menu"
                    >
                      <Menu className="h-6 w-6" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="hidden sm:flex items-center gap-3">
                      <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white transition">
                        Log in
                      </Link>
                      <Link href="/register" className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 transition">
                        Sign up
                      </Link>
                    </div>
                    {/* Mobile hamburger for logged-out */}
                    <button
                      onClick={() => setDrawerOpen(true)}
                      className="sm:hidden p-1.5 text-slate-400 hover:text-white transition"
                      aria-label="Open menu"
                    >
                      <Menu className="h-6 w-6" />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Mobile Drawer ── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer panel */}
          <div className="fixed top-0 right-0 bottom-0 w-72 bg-white z-50 shadow-2xl lg:hidden overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <Link href="/" className="flex items-center gap-2" onClick={() => setDrawerOpen(false)}>
                <div className="w-7 h-7 bg-slate-900 rounded-xl rounded-bl-none flex items-center justify-center text-white text-xs font-bold">Hi</div>
                <span className="font-bold text-lg text-slate-900">Coworking</span>
              </Link>
              <button onClick={() => setDrawerOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-6">
              {/* Public */}
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Explore</p>
                {publicLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block py-2 text-sm font-medium transition-colors",
                      pathname === item.href ? "text-indigo-600" : "text-slate-700 hover:text-indigo-600"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              {user && (
                <>
                  {/* Member */}
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Member</p>
                    {memberLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 py-2 text-sm font-medium transition-colors",
                          pathname === item.href ? "text-indigo-600" : "text-slate-700 hover:text-indigo-600"
                        )}
                      >
                        <item.icon className="h-4 w-4 text-slate-400" />
                        {item.label}
                      </Link>
                    ))}
                  </div>

                  {/* Staff / Admin */}
                  {isStaff && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        {isAdmin ? "Admin" : "Staff"}
                      </p>
                      {staffLinks.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="flex items-center gap-3 py-2 text-sm font-medium text-emerald-700 hover:text-emerald-800"
                        >
                          <item.icon className="h-4 w-4 text-emerald-500" />
                          {item.label}
                        </Link>
                      ))}
                      {isAdmin && adminLinks.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="flex items-center gap-3 py-2 text-sm font-medium text-amber-700 hover:text-amber-800"
                        >
                          <item.icon className="h-4 w-4 text-amber-500" />
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Account */}
                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Account</p>
                    <Link href="/profile" className="flex items-center gap-3 py-2 text-sm font-medium text-slate-700 hover:text-indigo-600">
                      <Briefcase className="h-4 w-4 text-slate-400" /> Profile
                    </Link>
                    <Link href="/notifications" className="flex items-center gap-3 py-2 text-sm font-medium text-slate-700 hover:text-indigo-600">
                      <Bell className="h-4 w-4 text-slate-400" /> Notifications
                      {unreadCount > 0 && (
                        <span className="ml-auto h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">{unreadCount}</span>
                      )}
                    </Link>
                    <Link href="/org/dashboard" className="flex items-center gap-3 py-2 text-sm font-medium text-slate-700 hover:text-indigo-600">
                      <Building2 className="h-4 w-4 text-slate-400" /> Organization
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 w-full"
                    >
                      <LogOut className="h-4 w-4" /> Sign Out
                    </button>
                  </div>
                </>
              )}

              {!user && (
                <div className="border-t border-slate-100 pt-4 space-y-2">
                  <Link href="/login" className="block w-full text-center py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Log in
                  </Link>
                  <Link href="/register" className="block w-full text-center py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <main className={cn("flex-1 w-full", !fullWidth && "max-w-7xl mx-auto px-6 py-8", fullWidth && "bg-slate-50")}>
        {children}
      </main>

      {/* ── Footer ── */}
      <footer className="bg-slate-50 border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <Link href="/" className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-slate-900 rounded-xl rounded-bl-none flex items-center justify-center text-white text-xs font-bold">Hi</div>
                <span className="font-bold text-lg text-slate-900">Coworking</span>
              </Link>
              <p className="text-sm text-slate-500 leading-relaxed">
                Big ideas. Intimate space.<br />
                A micro-coworking space built for focus, flexibility, and real local use.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/spaces" className="text-slate-500 hover:text-slate-900 transition-colors">Spaces</Link></li>
                <li><Link href="/pricing" className="text-slate-500 hover:text-slate-900 transition-colors">Pricing</Link></li>
                <li><Link href="/events" className="text-slate-500 hover:text-slate-900 transition-colors">Events</Link></li>
                <li><Link href="/directory" className="text-slate-500 hover:text-slate-900 transition-colors">Directory</Link></li>
                <li><Link href="/rfx" className="text-slate-500 hover:text-slate-900 transition-colors">RFx</Link></li>
                <li><Link href="/bookstore" className="text-slate-500 hover:text-slate-900 transition-colors">Bookstore</Link></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/about" className="text-slate-500 hover:text-slate-900 transition-colors">About</Link></li>
                <li><Link href="/platform" className="text-slate-500 hover:text-slate-900 transition-colors">Platform Overview</Link></li>
                <li><Link href="/pitchdeck" className="text-slate-500 hover:text-slate-900 transition-colors">Investor Pitch Deck</Link></li>
                <li><Link href="/contact" className="text-slate-500 hover:text-slate-900 transition-colors">Contact</Link></li>
                {(role === "staff" || role === "admin" || role === "master") && (
                  <li><Link href="/staff" className="text-slate-500 hover:text-slate-900 transition-colors">Staff</Link></li>
                )}
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/terms" className="text-slate-500 hover:text-slate-900 transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="text-slate-500 hover:text-slate-900 transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-xs text-slate-400">
              &copy; {new Date().getFullYear()} Hi Coworking. All rights reserved.
            </p>
            <p className="text-xs text-slate-400">
              Carrollton, VA
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
