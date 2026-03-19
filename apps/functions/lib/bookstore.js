"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookstore_createCheckoutSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const ledger_1 = require("./payments/ledger");
const stripeProvider_1 = require("./payments/stripeProvider");
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
function getDb() {
    return admin.firestore();
}
/**
 * Create a Stripe Checkout Session for Book Purchase.
 */
exports.bookstore_createCheckoutSession = (0, https_1.onCall)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (request) => {
    if (!request.auth) {
        // Allow guest checkout for bookstore?
        // Policy in BookDoc says 'requireLoginToPurchase'. We should check that.
        // But for now, let's allow guests if the book doesn't require login.
        // We'll handle this logic below after fetching the book.
    }
    const { bookId, variantId, quantity = 1, successUrl, cancelUrl } = request.data;
    if (!bookId || !successUrl || !cancelUrl) {
        throw new https_1.HttpsError("invalid-argument", "bookId, successUrl, and cancelUrl are required");
    }
    const uid = request.auth?.uid || "guest"; // Placeholder for guest
    const db = getDb();
    // 1. Get Book
    const bookSnap = await db.collection("books").doc(bookId).get();
    if (!bookSnap.exists) {
        throw new https_1.HttpsError("not-found", "Book not found");
    }
    const book = bookSnap.data(); // Cast loosely first
    if (!book.published) {
        throw new https_1.HttpsError("failed-precondition", "Book is not published");
    }
    if (book.requireLoginToPurchase && !request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in to purchase this book");
    }
    // Determine Price & Item
    let amountCents = book.priceCents || 0;
    let description = `Purchase: ${book.title}`;
    let productType = book.availabilityMode;
    if (variantId) {
        // Find specific variant
        const variant = book.variants?.find((v) => v.id === variantId);
        if (!variant) {
            throw new https_1.HttpsError("not-found", "Variant not found");
        }
        amountCents = variant.priceCents;
        description = `${variant.name} - ${book.title}`;
        productType = variant.type; // "physical" | "digital"
    }
    if (amountCents <= 0) {
        throw new https_1.HttpsError("invalid-argument", "Price must be greater than 0 for checkout");
    }
    const totalAmount = amountCents * quantity;
    // 2. Create Pending Payment
    const payment = await (0, ledger_1.createPayment)({
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
    const provider = new stripeProvider_1.StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
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
});
