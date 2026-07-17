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
exports.exchange_adminAdjustCredits = void 0;
exports.grantFoundingInvoiceCredits = grantFoundingInvoiceCredits;
exports.getUsableOrganizationCreditBalance = getUsableOrganizationCreditBalance;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const model_1 = require("./model");
function getDb() { return admin.firestore(); }
async function grantFoundingInvoiceCredits(input) {
    const now = input.effectiveAt || Date.now();
    const grantRef = getDb().collection("organizationCreditLots").doc(`stripe_invoice_${input.invoiceId}`);
    const ledgerRef = getDb().collection("organizationCreditLedger").doc(`stripe_invoice_${input.invoiceId}`);
    return getDb().runTransaction(async (tx) => {
        const existing = await tx.get(grantRef);
        if (existing.exists)
            return false;
        const expiresAt = now + model_1.CREDIT_EXPIRY_MS;
        tx.create(grantRef, {
            id: grantRef.id,
            organizationId: input.organizationId,
            amount: model_1.FOUNDING_MONTHLY_CREDITS,
            remainingAmount: model_1.FOUNDING_MONTHLY_CREDITS,
            effectiveAt: now,
            expiresAt,
            sourceType: "stripe_invoice",
            sourceId: input.invoiceId,
            stripeInvoiceId: input.invoiceId,
            stripeEventId: input.eventId,
            reversed: false,
            createdAt: Date.now(),
        });
        tx.create(ledgerRef, {
            id: ledgerRef.id,
            organizationId: input.organizationId,
            amount: model_1.FOUNDING_MONTHLY_CREDITS,
            entryType: "grant",
            effectiveAt: now,
            expiresAt,
            sourceType: "stripe_invoice",
            sourceId: input.invoiceId,
            stripeInvoiceId: input.invoiceId,
            stripeEventId: input.eventId,
            description: "Founding Membership monthly credit grant",
            actor: "stripe_webhook",
            createdAt: Date.now(),
        });
        return true;
    });
}
async function getUsableOrganizationCreditBalance(organizationId, now = Date.now()) {
    const snap = await getDb().collection("organizationCreditLots")
        .where("organizationId", "==", organizationId)
        .where("expiresAt", ">", now)
        .get();
    return (0, model_1.calculateUsableCreditBalance)(snap.docs.map((doc) => {
        const data = doc.data();
        return {
            amount: Number(data.amount || 0),
            remainingAmount: Number(data.remainingAmount ?? data.amount ?? 0),
            expiresAt: Number(data.expiresAt || 0),
            reversed: data.reversed === true,
        };
    }), now);
}
async function spendOrganizationCredits(input) {
    const now = Date.now();
    const query = getDb().collection("organizationCreditLots")
        .where("organizationId", "==", input.organizationId)
        .where("expiresAt", ">", now)
        .orderBy("expiresAt", "asc");
    const ledgerRef = getDb().collection("organizationCreditLedger").doc();
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(query);
        const eligible = snap.docs.filter((doc) => doc.data().reversed !== true).map((doc) => ({
            id: doc.id,
            remainingAmount: Number(doc.data().remainingAmount || 0),
            expiresAt: Number(doc.data().expiresAt || 0),
        }));
        const plan = (0, model_1.planFifoCreditSpend)(eligible, input.amount);
        for (const allocation of plan) {
            const lot = snap.docs.find((doc) => doc.id === allocation.id);
            if (!lot)
                throw new Error("Credit lot disappeared during transaction");
            tx.update(lot.ref, { remainingAmount: admin.firestore.FieldValue.increment(-allocation.spend), updatedAt: now });
        }
        tx.create(ledgerRef, {
            id: ledgerRef.id,
            organizationId: input.organizationId,
            amount: -input.amount,
            entryType: input.sourceType === "administrative_adjustment" ? "administrative_adjustment" : "spend",
            effectiveAt: now,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            description: input.description,
            actor: input.actor,
            allocations: plan,
            createdAt: now,
        });
    });
}
exports.exchange_adminAdjustCredits = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in required.");
    if (!["admin", "master"].includes(String(request.auth.token.role || ""))) {
        throw new https_1.HttpsError("permission-denied", "Platform administrator required.");
    }
    const actorUid = request.auth.uid;
    const organizationId = typeof request.data?.organizationId === "string" ? request.data.organizationId.trim() : "";
    const amount = Number(request.data?.amount);
    const description = typeof request.data?.description === "string" ? request.data.description.trim().slice(0, 500) : "";
    if (!organizationId || !Number.isInteger(amount) || amount === 0 || !description) {
        throw new https_1.HttpsError("invalid-argument", "organizationId, non-zero integer amount, and description are required.");
    }
    if (amount < 0) {
        await spendOrganizationCredits({ organizationId, amount: Math.abs(amount), sourceType: "administrative_adjustment", sourceId: `admin:${actorUid}:${Date.now()}`, description, actor: actorUid });
    }
    else {
        const now = Date.now();
        const lotRef = getDb().collection("organizationCreditLots").doc();
        const ledgerRef = getDb().collection("organizationCreditLedger").doc(lotRef.id);
        await getDb().runTransaction(async (tx) => {
            tx.create(lotRef, { id: lotRef.id, organizationId, amount, remainingAmount: amount, effectiveAt: now, expiresAt: now + model_1.CREDIT_EXPIRY_MS, sourceType: "administrative_adjustment", sourceId: lotRef.id, reversed: false, createdAt: now });
            tx.create(ledgerRef, { id: ledgerRef.id, organizationId, amount, entryType: "administrative_adjustment", effectiveAt: now, expiresAt: now + model_1.CREDIT_EXPIRY_MS, sourceType: "administrative_adjustment", sourceId: lotRef.id, description, actor: actorUid, createdAt: now });
        });
    }
    return { success: true, balance: await getUsableOrganizationCreditBalance(organizationId) };
});
