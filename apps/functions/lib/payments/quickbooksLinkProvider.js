"use strict";
/**
 * QuickBooks Payment Link Provider Adapter (PR-11)
 *
 * Implements PaymentProvider for QuickBooks Payment Links.
 * Unlike Stripe, QB payment links are simple redirect URLs with no webhook.
 * Payment confirmation is done manually by an admin ("mark paid").
 *
 * Flow:
 * 1. Admin configures a QB payment link URL on the product
 * 2. User clicks "Pay with QuickBooks" → redirected to QB link
 * 3. After paying, user returns to the app
 * 4. Admin verifies payment in QB and clicks "Mark Paid" in the admin UI
 */
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
exports.QuickBooksLinkProvider = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() { return admin.firestore(); }
class QuickBooksLinkProvider {
    constructor() {
        this.name = "quickbooks_link";
    }
    /**
     * Create a "checkout session" by looking up the QB payment link URL
     * from the products collection and returning it.
     * The metadata.productId must reference a product with quickbooksPaymentLinkUrl set.
     */
    async createCheckoutSession(input) {
        const productId = input.metadata?.productId;
        if (!productId) {
            throw new Error("productId is required in metadata for QuickBooks Link payments");
        }
        // Fetch the product to get the QB payment link
        const productSnap = await getDb().collection("products").doc(productId).get();
        if (!productSnap.exists) {
            throw new Error(`Product ${productId} not found`);
        }
        const product = productSnap.data();
        const qbUrl = product?.quickbooksPaymentLinkUrl;
        if (!qbUrl) {
            throw new Error(`Product ${productId} does not have a QuickBooks payment link configured`);
        }
        // Generate a unique session ID for tracking
        const sessionId = `qbl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        logger.info("QuickBooks Link checkout created", {
            sessionId,
            productId,
            uid: input.uid,
        });
        return {
            sessionId,
            url: qbUrl,
            provider: "quickbooks_link",
        };
    }
    /**
     * QB Payment Links do not have webhooks.
     * This method is a no-op and always returns "unknown".
     */
    async handleWebhook(_rawBody, _headers) {
        return {
            eventId: `qbl_noop_${Date.now()}`,
            action: "unknown",
        };
    }
    /**
     * Manual reconciliation only for QB Payment Links.
     * Returns the current status from the payment doc (no external API to query).
     * Actual reconciliation is done by admin "mark paid" action.
     */
    async reconcileStatus(providerRefs) {
        const paymentId = providerRefs.paymentId;
        if (!paymentId) {
            return "pending";
        }
        const snap = await getDb().collection("payments").doc(paymentId).get();
        if (!snap.exists) {
            return "pending";
        }
        return snap.data()?.status || "pending";
    }
}
exports.QuickBooksLinkProvider = QuickBooksLinkProvider;
