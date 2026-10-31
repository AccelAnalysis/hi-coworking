/**
 * SayHi flow helpers shared by Plans and pricing and Create your account.
 * Flag-gated by the callers (NEXT_PUBLIC_SAYHI_FLOW / NEXT_PUBLIC_VIRTUAL_ADDRESS).
 */
import { httpsCallable } from "firebase/functions";
import { MEMBERSHIP_TIERS } from "@hi/shared";
import { functions } from "@/lib/firebase";
import { VIRTUAL_ADDRESS } from "@/lib/sayhiFlags";

const VA_CHOICE_KEY = "hi-sayhi-virtual-address";

export const saveAccountDetailsCallable = httpsCallable<{ company: string; phone: string }, { ok: boolean }>(
  functions,
  "members_saveAccountDetails",
);

export async function saveAccountDetails(input: { company: string; phone: string }) {
  await saveAccountDetailsCallable(input);
}

const createCheckout = httpsCallable<
  { tierId: string; successUrl: string; cancelUrl: string; virtualAddress?: boolean },
  { sessionId: string; url: string; paymentId: string }
>(functions, "stripe_createCheckoutSession");

/** The plan picked on Plans and pricing, carried to Create your account as ?plan=. */
export function readPlanChoice(search: string): string | null {
  const plan = new URLSearchParams(search).get("plan");
  return plan && MEMBERSHIP_TIERS.some((tier) => tier.id === plan) ? plan : null;
}

export function rememberVirtualAddressChoice(chosen: boolean) {
  try {
    window.sessionStorage.setItem(VA_CHOICE_KEY, chosen ? "1" : "0");
  } catch {
    /* private mode: the choice is just not remembered */
  }
}

export function virtualAddressChoice(): boolean | null {
  try {
    const value = window.sessionStorage.getItem(VA_CHOICE_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

export async function startMembershipCheckout(tierId: string): Promise<string | null> {
  const origin = window.location.origin;
  const result = await createCheckout({
    tierId,
    successUrl: `${origin}/my-hi?payment=success&plan=${encodeURIComponent(tierId)}`,
    cancelUrl: `${origin}/pricing?payment=cancelled`,
    ...(VIRTUAL_ADDRESS && virtualAddressChoice() === true ? { virtualAddress: true } : {}),
  });
  return result.data.url || null;
}
