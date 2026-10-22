import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { StripeProvider } from "./stripeProvider";
import { getCheckoutTier, getTierById } from "./stripeConfig";
import { hasActiveMembership } from "./membership";

/** One durable checkout attempt per user. Retries reuse both ledger ID and Stripe key. */
export async function createMembershipCheckout(
  provider: StripeProvider,
  input: { uid: string; email: string; tierId: string; successUrl: string; cancelUrl: string },
) {
  if (!getTierById(input.tierId)) throw new HttpsError("not-found", "Unknown membership tier.");
  const tier = getCheckoutTier(input.tierId, provider.mode);
  const db = admin.firestore();
  const userRef = db.collection("users").doc(input.uid);
  const attemptRef = db.collection("membershipCheckouts").doc(input.uid);
  // Expiration must be confirmed at Stripe, not guessed from a local clock.
  const previous = (await attemptRef.get()).data();
  if (previous && (previous.stripeMode || "live") !== provider.mode) {
    throw new HttpsError("failed-precondition", "Existing checkout belongs to a different Stripe mode; reconcile it before proceeding.");
  }
  if (previous?.sessionId) {
    const session = await provider.retrieveCheckoutSession(previous.sessionId);
    if (session.status === "open") {
      if (previous.tierId !== input.tierId) throw new HttpsError("failed-precondition", "Finish or cancel your existing membership checkout before choosing another plan.");
      return { sessionId: session.id, url: session.url, paymentId: previous.paymentId };
    }
    let terminalSubscription = false;
    if (session.status === "complete") {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (subscriptionId) {
        const subscription = await provider.retrieveSubscription(subscriptionId);
        terminalSubscription = ["canceled", "incomplete_expired"].includes(subscription.status);
      }
      if (!terminalSubscription) throw new HttpsError("failed-precondition", "Your membership checkout is complete. Please wait for activation or manage your existing membership.");
    }
    if (session.status === "expired" || terminalSubscription) {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(attemptRef)).data();
        if (current?.sessionId === session.id) tx.delete(attemptRef);
      });
    }
  }
  const user = (await userRef.get()).data();
  if (!user) throw new HttpsError("failed-precondition", "Complete your profile before buying a membership.");
  const existingId = user.features?.stripeSubscriptionId;
  if (existingId) {
    const subscription = await provider.retrieveSubscription(existingId);
    if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
      throw new HttpsError("already-exists", "You already have a membership subscription. Manage it instead of purchasing another.");
    }
  }
  const paymentRef = db.collection("payments").doc();
  const attempt = await db.runTransaction(async (tx) => {
    const [userSnap, attemptSnap] = await Promise.all([tx.get(userRef), tx.get(attemptRef)]);
    const latestUser = userSnap.data();
    if (latestUser?.features?.stripeSubscriptionId !== existingId || (!existingId && hasActiveMembership(latestUser))) {
      throw new HttpsError("already-exists", "You already have a membership. Refresh to manage it.");
    }
    if (attemptSnap.exists) {
      const current = attemptSnap.data()!;
      if ((current.stripeMode || "live") !== provider.mode || current.tierId !== input.tierId) throw new HttpsError("failed-precondition", "Another membership checkout is already in progress.");
      return current;
    }
    const createdAt = Date.now();
    const next = { ...input, stripeMode: provider.mode, paymentId: paymentRef.id, createdAt };
    tx.set(attemptRef, next);
    tx.set(paymentRef, {
      id: paymentRef.id, uid: input.uid, provider: "stripe", stripeMode: provider.mode, amount: tier.amountCents,
      currency: tier.currency, purpose: "membership", purposeRefId: tier.id,
      status: "pending", createdAt,
    });
    return next;
  });
  // Never reuse an uncertain Stripe idempotency key after its 24-hour retention.
  // Leave the durable attempt for operator reconciliation instead of risking a second subscription.
  if (Date.now() - attempt.createdAt > 23 * 60 * 60 * 1000) {
    throw new HttpsError("failed-precondition", "Your earlier checkout needs reconciliation. Please contact support before retrying.");
  }
  const session = await provider.createCheckoutSession({
    uid: input.uid, amount: tier.amountCents, currency: tier.currency,
    purpose: "membership", purposeRefId: tier.id,
    successUrl: attempt.successUrl, cancelUrl: attempt.cancelUrl,
    metadata: { email: attempt.email, stripePriceId: tier.stripePriceId,
      paymentId: attempt.paymentId, checkoutAttemptId: attempt.paymentId, plan: tier.id },
  });
  await attemptRef.update({ sessionId: session.sessionId, url: session.url });
  await db.collection("payments").doc(attempt.paymentId).update({ "providerRefs.stripeCheckoutSessionId": session.sessionId });
  return { sessionId: session.sessionId, url: session.url, paymentId: attempt.paymentId };
}
