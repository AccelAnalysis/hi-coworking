import {
  CREDIT_COSTS,
  MEMBERSHIP_TIERS,
  type UserDoc,
  type MembershipTierDef,
} from "@hi/shared";

export type MonetizableAction =
  | "rfx_publish"
  | "rfx_push_invite" // Cost is per batch or unit
  | "rfx_view_details"
  | "referral_send"
  | "referral_accept"
  | "referral_unlock_policy";

export interface ActionCheckResult {
  allowed: boolean;
  usingCredits: boolean;
  cost: number;
  reason?: string;
  remainingLimit?: number;
}

export function getTierDef(planId?: string): MembershipTierDef | undefined {
  if (!planId) return undefined;
  return MEMBERSHIP_TIERS.find((t) => t.id === planId);
}

/**
 * Check if a user can perform an action based on their plan limits and credit balance.
 * Returns detailed result including if credits will be used and the cost.
 */
export function checkMonetizationLimit(
  userDoc: UserDoc | null,
  action: MonetizableAction,
  usageContext?: { currentCount: number; quantity?: number }
): ActionCheckResult {
  if (!userDoc) {
    return { allowed: false, usingCredits: false, cost: 0, reason: "Not logged in" };
  }

  const tier = getTierDef(userDoc.plan);
  // Default to Virtual/Free limits if no plan, or strict 0?
  // If no tier found, assume strictly limited or fallback to Virtual if we treat "none" as "guest"
  // For now, if no tier, fail.
  if (!tier && userDoc.role !== "admin" && userDoc.role !== "master") {
     // Admin override?
     // Let's assume admins bypass limits? Or just fail.
     return { allowed: false, usingCredits: false, cost: 0, reason: "No active membership" };
  }
  
  // Admins always allowed
  if (userDoc.role === "admin" || userDoc.role === "master") {
    return { allowed: true, usingCredits: false, cost: 0 };
  }

  // Safe tier fallback (shouldn't happen if check above passes)
  const limits = tier?.limits || {
    rfxActivePosts: 0,
    rfxInvitePushes: 0,
    referralsSentPerMonth: 0,
    referralsReceivedPerMonth: 0,
    referralPolicyUnlocksPerMonth: 0,
    referralActiveOpen: 0,
  };

  const currentUsage = usageContext?.currentCount || 0;
  const quantity = usageContext?.quantity || 1; // For things like "push 10 invites"

  switch (action) {
    case "rfx_publish": {
      // Limit is on ACTIVE posts.
      // If user has fewer active posts than limit, it's free/included.
      // If user is at or over limit, they must pay credits.
      if (currentUsage < limits.rfxActivePosts) {
        return { allowed: true, usingCredits: false, cost: 0, remainingLimit: limits.rfxActivePosts - currentUsage };
      }
      // If over limit, check credits
      const cost = CREDIT_COSTS.RFX_PUBLISH;
      const hasCredits = (userDoc.credits || 0) >= cost;
      return {
        allowed: hasCredits,
        usingCredits: true,
        cost,
        reason: hasCredits ? undefined : "Insufficient credits",
      };
    }

    case "rfx_push_invite": {
      // Limit is monthly pushes.
      // If current usage + qty <= limit, free.
      // Else pay credits.
      // NOTE: This implementation assumes simple "all free or all paid" or "split"?
      // Let's keep it simple: if you have free quota left, use it. If request > remaining, fail or split?
      // For simplicity: if request fits in remaining, free. If not, pay for the WHOLE thing? Or just the excess?
      // "Included: 25 invites". If I send 30, do I pay for 5?
      // Let's assume pay for excess.
      // Cost is 1 credit per 10 invites.
      
      const remainingFree = Math.max(0, limits.rfxInvitePushes - currentUsage);
      const excess = Math.max(0, quantity - remainingFree);
      
      if (excess === 0) {
        return { allowed: true, usingCredits: false, cost: 0, remainingLimit: remainingFree - quantity };
      }
      
      // Calculate cost for excess
      // 1 credit per 10 invites (ceil)
      const cost = Math.ceil(excess / 10) * CREDIT_COSTS.RFX_PUSH_INVITES_10;
      const hasCredits = (userDoc.credits || 0) >= cost;
      
      return {
        allowed: hasCredits,
        usingCredits: true,
        cost,
        reason: hasCredits ? undefined : "Insufficient credits",
      };
    }

    case "referral_send": {
      // Monthly limit
      if (currentUsage < limits.referralsSentPerMonth) {
        return { allowed: true, usingCredits: false, cost: 0, remainingLimit: limits.referralsSentPerMonth - currentUsage };
      }
      const cost = CREDIT_COSTS.REFERRAL_SEND_EXTRA;
      const hasCredits = (userDoc.credits || 0) >= cost;
      return {
        allowed: hasCredits,
        usingCredits: true,
        cost,
        reason: hasCredits ? undefined : "Insufficient credits",
      };
    }
    
    // Add other cases as needed...
    default:
      return { allowed: true, usingCredits: false, cost: 0 };
  }
}
