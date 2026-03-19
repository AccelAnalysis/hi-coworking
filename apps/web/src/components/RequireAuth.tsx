"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { Loader2 } from "lucide-react";
import type { UserRole, MembershipStatus } from "@hi/shared";

// Role hierarchy: master > admin > staff > member (& externalVendor, econPartner)
const ROLE_HIERARCHY: Record<string, number> = {
  master: 100,
  admin: 80,
  staff: 60,
  member: 40,
  externalVendor: 30,
  econPartner: 30,
};

function hasMinimumRole(userRole: UserRole | null, requiredRole: UserRole): boolean {
  if (!userRole) return false;
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

interface RequireAuthProps {
  children: React.ReactNode;
  /** Minimum role required (checked via custom claims) */
  requiredRole?: UserRole;
  /** Required membership status (checked via Firestore user doc entitlements) */
  requiredMembershipStatus?: MembershipStatus[];
}

export function RequireAuth({ children, requiredRole, requiredMembershipStatus }: RequireAuthProps) {
  const { user, loading, role, userDoc } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    if (requiredRole && !hasMinimumRole(role, requiredRole)) {
      router.push("/dashboard");
      return;
    }

    if (requiredMembershipStatus && requiredMembershipStatus.length > 0) {
      const status = userDoc?.membershipStatus ?? "none";
      if (!requiredMembershipStatus.includes(status)) {
        router.push("/dashboard");
        return;
      }
    }
  }, [user, loading, router, role, userDoc, requiredRole, requiredMembershipStatus]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
