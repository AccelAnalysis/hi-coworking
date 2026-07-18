"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Bell,
  BookOpenText,
  Building2,
  ChartNoAxesCombined,
  Coins,
  Handshake,
  LayoutDashboard,
  MapPinned,
  Menu,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeView } from "../state/exchangeWorkspaceTypes";

const PRIMARY_ITEMS: Array<{
  view: ExchangeView;
  label: string;
  icon: typeof MapPinned;
}> = [
  { view: "intelligence", label: "Intelligence", icon: ChartNoAxesCombined },
  { view: "referrals", label: "Referrals", icon: Handshake },
  { view: "opportunities", label: "Opportunities", icon: MapPinned },
  { view: "resources", label: "Resources", icon: BookOpenText },
];

const MENU_LINKS = [
  { href: "/exchange/onboarding", label: "Organization", icon: Building2 },
  { href: "/exchange/founding", label: "Founding Membership", icon: ChartNoAxesCombined },
  { href: "/exchange/wallet", label: "Membership & Credits", icon: Coins },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile & saved items", icon: User },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
] as const;

export function ExchangeMobileNavigation({
  view,
  menuOpen,
  onChange,
  onMenuOpen,
  onMenuClose,
}: {
  view: ExchangeView;
  menuOpen: boolean;
  onChange: (view: ExchangeView) => void;
  onMenuOpen: () => void;
  onMenuClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMenuClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, onMenuClose]);

  return (
    <>
      <nav
        className="absolute inset-x-0 bottom-0 z-50 grid h-[4.75rem] grid-cols-5 border-t border-slate-200 bg-white px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] shadow-[0_-10px_30px_rgba(15,23,42,0.12)] lg:hidden"
        aria-label="Primary Exchange navigation"
      >
        {PRIMARY_ITEMS.slice(0, 4).map(({ view: candidate, label, icon: Icon }) => {
          const active = view === candidate && !menuOpen;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => onChange(candidate)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500",
                active ? "text-blue-700" : "text-slate-500 hover:text-slate-900",
              )}
            >
              <span className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition",
                candidate === "opportunities" && active && "bg-blue-700 text-white shadow-lg shadow-blue-700/30",
              )}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="max-w-full truncate">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMenuOpen}
          aria-expanded={menuOpen}
          aria-controls="exchange-mobile-menu"
          className={cn(
            "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500",
            menuOpen ? "text-blue-700" : "text-slate-500 hover:text-slate-900",
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>Menu</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className="absolute inset-0 z-[70] lg:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            onClick={onMenuClose}
            aria-label="Close Exchange menu"
          />
          <section
            id="exchange-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exchange-mobile-menu-title"
            className="absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-y-auto rounded-t-[2rem] bg-white pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-700">Hi Exchange</p>
                <h2 id="exchange-mobile-menu-title" className="mt-1 text-xl font-black text-slate-950">Menu</h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onMenuClose}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-2 p-4">
              {MENU_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={onMenuClose}
                  className="flex min-h-14 items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 shadow-sm outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
