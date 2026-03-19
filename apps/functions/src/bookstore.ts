import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { createPayment } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";

// MIRROR of @hi/shared types — kept inline because @hi/shared is ESM-only.
interface BookDoc {
  id: string;
  title: string;
  priceCents?: number;
  currency?: string;
  availabilityMode: "browse_only" | "digital" | "physical";
  salesChannel: "owned" | "affiliate";
  variants?: Array<{
    id: string;
    name: string;
    priceCents: number;
    type: "physical" | "digital" | "service";
  }>;
}

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

function getDb() {
  return admin.firestore();
}

/**
 * Create a Stripe Checkout Session for Book Purchase.
 */
export const bookstore_createCheckoutSession = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    if (!request.auth) {
      // Allow guest checkout for bookstore?
      // Policy in BookDoc says 'requireLoginToPurchase'. We should check that.
      // But for now, let's allow guests if the book doesn't require login.
      // We'll handle this logic below after fetching the book.
    }

    const { bookId, variantId, quantity = 1, successUrl, cancelUrl } = request.data;
    
    if (!bookId || !successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "bookId, successUrl, and cancelUrl are required");
    }

    const uid = request.auth?.uid || "guest"; // Placeholder for guest
    const db = getDb();

    // 1. Get Book
    const bookSnap = await db.collection("books").doc(bookId).get();
    if (!bookSnap.exists) {
      throw new HttpsError("not-found", "Book not found");
    }
    const book = bookSnap.data() as any; // Cast loosely first

    if (!book.published) {
      throw new HttpsError("failed-precondition", "Book is not published");
    }

    if (book.requireLoginToPurchase && !request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to purchase this book");
    }

    // Determine Price & Item
    let amountCents = book.priceCents || 0;
    let description = `Purchase: ${book.title}`;
    let productType = book.availabilityMode;

    if (variantId) {
      // Find specific variant
      const variant = book.variants?.find((v: any) => v.id === variantId);
      if (!variant) {
        throw new HttpsError("not-found", "Variant not found");
      }
      amountCents = variant.priceCents;
      description = `${variant.name} - ${book.title}`;
      productType = variant.type; // "physical" | "digital"
    }

    if (amountCents <= 0) {
      throw new HttpsError("invalid-argument", "Price must be greater than 0 for checkout");
    }

    const totalAmount = amountCents * quantity;

    // 2. Create Pending Payment
    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: totalAmount,
      currency: book.currency || "usd",
      purpose: "bookstore",
      purposeRefId: bookId,
      status: "pending",
      providerRefs: { 
        variantId: variantId || "standard", 
        quantity: String(quantity),
        productType
      }
    });

    // 3. Create Checkout Session
    const provider = new StripeProvider(
      stripeSecretKey.value(),
      stripeWebhookSecret.value()
    );

    const session = await provider.createCheckoutSession({
      uid,
      amount: totalAmount,
      currency: book.currency || "usd",
      purpose: "bookstore",
      purposeRefId: bookId,
      successUrl,
      cancelUrl,
      mode: "payment",
      lineItemLabel: description,
      metadata: {
        bookId,
        variantId: variantId || "",
        quantity: String(quantity),
        paymentId: payment.id,
        productType
      }
    });

    return {
      sessionId: session.sessionId,
      url: session.url,
      paymentId: payment.id
    };
  }
);
