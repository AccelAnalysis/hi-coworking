import * as logger from "firebase-functions/logger";
import { finalizeEventV2CheckoutFromWebhook } from "./eventV2";

export async function maybeFinalizeEventV2Checkout(input: {
  checkoutType?: string;
  holdId?: string;
  paymentId?: string;
}) {
  if (input.checkoutType !== "event_v2_ticket" || !input.holdId) return false;
  try {
    await finalizeEventV2CheckoutFromWebhook({ holdId: input.holdId, paymentId: input.paymentId });
    return true;
  } catch (error) {
    logger.error("Events v2 checkout finalization failed", {
      holdId: input.holdId,
      paymentId: input.paymentId,
      error,
    });
    throw error;
  }
}
