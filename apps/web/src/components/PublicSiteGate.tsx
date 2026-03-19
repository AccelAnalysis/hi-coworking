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

  useEffect(() => {
    const unsub = subscribeToPublicSiteSettings((next) => {
      setSettings(next);
      setSettingsLoading(false);
    });

    return () => unsub();
  }, []);

  // Allow /platform and /pitchdeck routes to bypass Coming Soon mode
  const isAllowedRoute = pathname === "/platform" || pathname === "/pitchdeck";
  const bypassComingSoon = role === "staff" || role === "admin" || role === "master" || isAllowedRoute;
  const showComingSoon = settings.comingSoonEnabled && !bypassComingSoon;

  if (authLoading || settingsLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (showComingSoon) {
    return <ComingSoonExperience />;
  }

  return <>{children}</>;
}
