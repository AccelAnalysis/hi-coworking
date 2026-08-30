"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import {
  subscribeToPublicSiteSettings,
  type PublicSiteSettingsDoc,
} from "@/lib/firestore";
import { ComingSoonExperience } from "@/components/ComingSoonExperience";
import { LaunchCountdown, PUBLIC_LAUNCH_AT } from "@/components/LaunchCountdown";

const DEFAULT_SETTINGS: PublicSiteSettingsDoc = {
  id: "public",
  comingSoonEnabled: false,
  updatedAt: 0,
};

function ComingSoonTopbar() {
  return (
    <nav
      className="sticky top-0 z-[100] border-b border-slate-200/60 bg-white/75 shadow-[0_8px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/70"
      aria-label="Primary navigation"
    >
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 py-2.5 md:min-h-[4.5rem] md:px-12">
        <a href="#launch-countdown-title" className="inline-flex min-w-0 items-center gap-2 text-slate-900 no-underline">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl rounded-bl-none bg-slate-900 text-sm font-bold text-white">
            Hi
          </span>
          <span className="whitespace-nowrap text-base font-bold tracking-tight md:text-xl">Coworking</span>
        </a>

        <div className="ml-auto hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          <a href="#concept" className="transition-colors hover:text-slate-900">Concept</a>
          <a href="#impact" className="transition-colors hover:text-slate-900">Local Impact</a>
          <a href="#ecosystem" className="transition-colors hover:text-slate-900">Ecosystem</a>
          <a href="#access" className="transition-colors hover:text-slate-900">Early Access</a>
        </div>

        <a
          href="#access"
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white no-underline transition-colors hover:bg-slate-800 md:min-h-10 md:px-4 md:text-sm"
        >
          Get Early Access
        </a>
      </div>
    </nav>
  );
}

export function PublicSiteGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { loading: authLoading, role } = useAuth();
  const [settings, setSettings] = useState<PublicSiteSettingsDoc>(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [launchReached, setLaunchReached] = useState(() => Date.now() >= PUBLIC_LAUNCH_AT);

  useEffect(() => {
    const unsub = subscribeToPublicSiteSettings((next) => {
      setSettings(next);
      setSettingsLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (launchReached) return;

    let timer: number | undefined;

    const checkLaunchTime = () => {
      const remaining = PUBLIC_LAUNCH_AT - Date.now();
      if (remaining <= 0) {
        setLaunchReached(true);
        return;
      }

      timer = window.setTimeout(checkLaunchTime, Math.min(remaining, 60_000));
    };

    checkLaunchTime();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [launchReached]);

  // Allow /platform route to bypass Coming Soon mode.
  // Disabling comingSoonEnabled still permits an earlier soft opening, while
  // the October 1 launch time guarantees the gate expires automatically.
  const isAllowedRoute = pathname === "/platform";
  const bypassComingSoon = role === "staff" || role === "admin" || role === "master" || isAllowedRoute;
  const showComingSoon = settings.comingSoonEnabled && !bypassComingSoon && !launchReached;

  if (authLoading || settingsLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (showComingSoon) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <ComingSoonTopbar />
        <LaunchCountdown />
        <div className="[&_nav]:hidden">
          <ComingSoonExperience />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
