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
        <LaunchCountdown />
        <ComingSoonExperience />
      </div>
    );
  }

  return <>{children}</>;
}
