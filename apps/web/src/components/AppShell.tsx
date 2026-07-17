"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  Compass,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/authContext";
import { subscribeToUnreadCount } from "@/lib/firestore";
import { cn } from "@/lib/utils";

export type AppShellVariant = "site" | "workspace";

interface AppShellProps {
  children: React.ReactNode;
  fullWidth?: boolean;
  variant?: AppShellVariant;
}

interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
}

export function AppShell({ children, fullWidth = false, variant = "site" }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, role, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const isExchangeWorkspace = variant === "workspace" || pathname === "/exchange";

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToUnreadCount(user.uid, setUnreadCount);
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(event.target as Node)) setAvatarOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setAvatarOpen(false);
  }, [pathname]);

  const isAdmin = role === "admin" || role === "master";
  const isStaff = role === "staff" || isAdmin;

  const publicLinks: NavItem[] = [
    { href: "/exchange", label: "Exchange" },
    { href: "/exchange/founding", label: "Founding Membership" },
    { href: "/spaces", label: "Spaces" },
    { href: "/events", label: "Events" },
    { href: "/bookstore", label: "Bookstore" },
    { href: "/about", label: "About" },
  ];

  const memberLinks: NavItem[] = [
    { href: "/exchange", label: "Exchange", icon: Compass },
    { href: "/exchange/onboarding", label: "Connect Organization", icon: Building2 },
    { href: "/directory", label: "Directory", icon: Users },
    { href: "/referrals", label: "Referrals", icon: Gift },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/book", label: "Book Space", icon: Calendar },
  ];

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const textLinkClass = (href: string) => cn(
    "text-sm font-semibold transition-colors",
    isActive(href) ? "text-white" : "text-slate-300 hover:text-white",
  );

  return (
    <div className={cn("min-h-dvh bg-slate-50", isExchangeWorkspace && "flex h-dvh flex-col overflow-hidden")}>
      <nav className="sticky top-0 z-50 shrink-0 bg-slate-950 text-white shadow-lg">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-7">
            <Link href={user ? "/exchange" : "/"} className="flex shrink-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl rounded-bl-none bg-white text-sm font-bold text-slate-950">Hi</div>
              <span className="hidden text-lg font-bold tracking-tight sm:block">Coworking</span>
            </Link>
            <div className="hidden items-center gap-5 xl:flex">
              {publicLinks.map((item) => <Link key={item.href} href={item.href} className={textLinkClass(item.href)}>{item.label}</Link>)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!loading && user && (
              <>
                <div className="hidden items-center gap-4 lg:flex">
                  <Link href="/exchange" className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold", isActive("/exchange") && !pathname.startsWith("/exchange/founding") && !pathname.startsWith("/exchange/onboarding") ? "bg-white text-slate-950" : "bg-indigo-500 text-white hover:bg-indigo-400")}>
                    <Compass className="h-4 w-4" /> Exchange map
                  </Link>
                  <Link href="/exchange/onboarding" className={textLinkClass("/exchange/onboarding")}>Organization</Link>
                  {isStaff && <Link href="/staff" className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">Staff</Link>}
                  {isAdmin && <Link href="/admin/dashboard" className="text-sm font-semibold text-amber-300 hover:text-amber-200">Admin</Link>}
                </div>
                <Link href="/notifications" className="relative rounded-full p-2 text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Notifications">
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold">{unreadCount > 99 ? "99+" : unreadCount}</span>}
                </Link>
                <div className="relative hidden sm:block" ref={avatarRef}>
                  <button onClick={() => setAvatarOpen((open) => !open)} className="flex items-center gap-1 rounded-full p-1 hover:bg-slate-800" aria-expanded={avatarOpen}>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-bold">{user.displayName?.[0]?.toUpperCase() || <User className="h-4 w-4" />}</span>
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </button>
                  {avatarOpen && (
                    <div className="absolute right-0 mt-2 w-64 rounded-xl bg-white py-2 text-slate-900 shadow-2xl ring-1 ring-slate-200">
                      <div className="border-b border-slate-100 px-4 py-3"><p className="truncate text-sm font-bold">{user.displayName || "User"}</p><p className="truncate text-xs text-slate-500">{user.email}</p></div>
                      <Link href="/exchange" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"><Compass className="h-4 w-4 text-indigo-600" /> Exchange map</Link>
                      <Link href="/exchange/onboarding" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"><Building2 className="h-4 w-4 text-slate-400" /> Connect organization</Link>
                      <Link href="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"><Briefcase className="h-4 w-4 text-slate-400" /> Profile</Link>
                      <button onClick={handleSignOut} className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" /> Sign out</button>
                    </div>
                  )}
                </div>
                <button onClick={() => setDrawerOpen(true)} className="rounded-full p-2 text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden" aria-label="Open navigation"><Menu className="h-6 w-6" /></button>
              </>
            )}
            {!loading && !user && (
              <div className="flex items-center gap-2">
                <Link href="/login" className="px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white">Log in</Link>
                <Link href="/register" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-100">Sign up</Link>
                <button onClick={() => setDrawerOpen(true)} className="rounded-full p-2 text-slate-300 hover:bg-slate-800 sm:hidden" aria-label="Open navigation"><Menu className="h-6 w-6" /></button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />
          <aside className="absolute bottom-0 right-0 top-0 w-[min(88vw,340px)] overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between"><strong className="text-lg text-slate-950">Navigate</strong><button onClick={() => setDrawerOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            {user && <Link href="/exchange" className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white"><Compass className="h-5 w-5" /> Open Exchange map</Link>}
            <div className="space-y-1">
              {(user ? memberLinks : publicLinks).map((item) => {
                const Icon = item.icon ?? BookOpen;
                return <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold", isActive(item.href) ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50")}><Icon className="h-4 w-4 text-slate-400" />{item.label}</Link>;
              })}
              {user && <button onClick={handleSignOut} className="mt-4 flex w-full items-center gap-3 border-t border-slate-200 px-3 py-4 text-sm font-semibold text-red-600"><LogOut className="h-4 w-4" /> Sign out</button>}
            </div>
          </aside>
        </div>
      )}

      <main className={cn(
        "w-full flex-1",
        isExchangeWorkspace ? "min-h-0 overflow-auto bg-slate-100" : fullWidth ? "bg-slate-50" : "mx-auto max-w-7xl px-6 py-8",
      )}>
        {children}
      </main>

      {!isExchangeWorkspace && (
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div><strong className="text-slate-800">Hi-Coworking</strong><span className="ml-2">The Exchange connects organizations, opportunities, referrals, and resources.</span></div>
            <div className="flex flex-wrap gap-4"><Link href="/exchange" className="hover:text-slate-900">Exchange</Link><Link href="/exchange/founding" className="hover:text-slate-900">Founding Membership</Link><Link href="/privacy" className="hover:text-slate-900">Privacy</Link><Link href="/terms" className="hover:text-slate-900">Terms</Link></div>
          </div>
        </footer>
      )}
    </div>
  );
}
