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
exports.upsertMembershipPeriod = upsertMembershipPeriod;
exports.getActiveMembershipPeriod = getActiveMembershipPeriod;
exports.calculateSeatBookingCharge = calculateSeatBookingCharge;
exports.calculateSeatBookingChargeInTransaction = calculateSeatBookingChargeInTransaction;
exports.consumeSeatMinutesForConfirmedBooking = consumeSeatMinutesForConfirmedBooking;
exports.reserveSeatMinutesForBooking = reserveSeatMinutesForBooking;
exports.consumeReservedSeatMinutesForBooking = consumeReservedSeatMinutesForBooking;
exports.releaseReservedSeatMinutesForBooking = releaseReservedSeatMinutesForBooking;
const admin = __importStar(require("firebase-admin"));
const stripeConfig_1 = require("../payments/stripeConfig");
function getDb() {
    return admin.firestore();
}
function getPeriodId(periodStart, periodEnd) {
    return `period_${periodStart}_${periodEnd}`;
}
function getAvailableSeatMinutes(period) {
    return Math.max(0, period.includedSeatMinutes - period.usedSeatMinutes - period.reservedSeatMinutes);
}
function calculateCents(minutes, hourlyRateCents) {
    return Math.round((minutes / 60) * hourlyRateCents);
}
async function upsertMembershipPeriod(input) {
    const db = getDb();
    const tier = (0, stripeConfig_1.getTierById)(input.plan);
    const includedSeatMinutes = (tier?.includedHoursPerMonth || 0) * 60;
    const id = getPeriodId(input.periodStart, input.periodEnd);
    const ref = db
        .collection("users")
        .doc(input.uid)
        .collection("membershipPeriods")
        .doc(id);
    const now = Date.now();
    return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? snap.data() : {};
        const doc = {
            id,
            uid: input.uid,
            plan: input.plan,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            includedSeatMinutes,
            usedSeatMinutes: existing.usedSeatMinutes || 0,
            reservedSeatMinutes: existing.reservedSeatMinutes || 0,
            overageSeatMinutes: existing.overageSeatMinutes || 0,
            createdAt: existing.createdAt || now,
            updatedAt: now,
        };
        if (input.stripeSubscriptionId !== undefined) {
            doc.stripeSubscriptionId = input.stripeSubscriptionId;
        }
        tx.set(ref, doc, { merge: true });
        return doc;
    });
}
async function getActiveMembershipPeriod(uid, atMillis = Date.now()) {
    if (!uid)
        return null;
    const userRef = getDb().collection("users").doc(uid);
    const userSnap = await userRef.get();
    const user = userSnap.data();
    if (!user ||
        user.membershipStatus !== "active" ||
        typeof user.billingPeriodStart !== "number" ||
        typeof user.billingPeriodEnd !== "number" ||
        atMillis < user.billingPeriodStart ||
        atMillis >= user.billingPeriodEnd) {
        return null;
    }
    const periodId = getPeriodId(user.billingPeriodStart, user.billingPeriodEnd);
    const periodSnap = await userRef.collection("membershipPeriods").doc(periodId).get();
    return periodSnap.exists ? periodSnap.data() : null;
}
async function calculateSeatBookingCharge(input) {
    const period = await getActiveMembershipPeriod(input.uid, input.atMillis);
    return calculateChargeFromPeriod(input, period);
}
async function calculateSeatBookingChargeInTransaction(tx, input) {
    const userRef = getDb().collection("users").doc(input.uid);
    const userSnap = await tx.get(userRef);
    const user = userSnap.data();
    let period = null;
    const atMillis = input.atMillis || Date.now();
    if (user?.membershipStatus === "active" &&
        typeof user.billingPeriodStart === "number" &&
        typeof user.billingPeriodEnd === "number" &&
        atMillis >= user.billingPeriodStart &&
        atMillis < user.billingPeriodEnd) {
        const periodId = getPeriodId(user.billingPeriodStart, user.billingPeriodEnd);
        const periodSnap = await tx.get(userRef.collection("membershipPeriods").doc(periodId));
        if (periodSnap.exists) {
            period = periodSnap.data();
        }
    }
    return calculateChargeFromPeriod(input, period);
}
function calculateChargeFromPeriod(input, period) {
    const durationMinutes = Math.max(0, Math.ceil(input.durationMinutes));
    if (input.resourceType === "MODE") {
        const totalPriceCents = calculateCents(durationMinutes, input.resourceRateHourlyCents);
        return {
            durationMinutes,
            includedSeatMinutesApplied: 0,
            overageSeatMinutes: 0,
            seatRateCents: 0,
            roomOrModeRateCents: input.resourceRateHourlyCents,
            totalPriceCents,
            paymentStatus: totalPriceCents > 0 ? "pending" : "paid",
        };
    }
    const tier = input.plan ? (0, stripeConfig_1.getTierById)(input.plan) : undefined;
    const seatRateCents = tier ? tier.extraHourlyRateCents : input.resourceRateHourlyCents;
    const availableSeatMinutes = period ? getAvailableSeatMinutes(period) : 0;
    const includedSeatMinutesApplied = period
        ? Math.min(durationMinutes, availableSeatMinutes)
        : 0;
    const overageSeatMinutes = durationMinutes - includedSeatMinutesApplied;
    const totalPriceCents = calculateCents(overageSeatMinutes, seatRateCents);
    return {
        durationMinutes,
        includedSeatMinutesApplied,
        overageSeatMinutes,
        seatRateCents,
        roomOrModeRateCents: 0,
        totalPriceCents,
        membershipPeriodId: period?.id,
        paymentStatus: totalPriceCents > 0 ? "pending" : "paid",
    };
}
function consumeSeatMinutesForConfirmedBooking(tx, uid, charge) {
    if (!charge.membershipPeriodId ||
        (charge.includedSeatMinutesApplied <= 0 && charge.overageSeatMinutes <= 0)) {
        return;
    }
    const ref = getDb()
        .collection("users")
        .doc(uid)
        .collection("membershipPeriods")
        .doc(charge.membershipPeriodId);
    tx.update(ref, {
        usedSeatMinutes: admin.firestore.FieldValue.increment(charge.includedSeatMinutesApplied),
        overageSeatMinutes: admin.firestore.FieldValue.increment(charge.overageSeatMinutes),
        updatedAt: Date.now(),
    });
}
function reserveSeatMinutesForBooking(tx, uid, membershipPeriodId, minutes) {
    if (!membershipPeriodId || minutes <= 0)
        return;
    tx.update(getDb().collection("users").doc(uid).collection("membershipPeriods").doc(membershipPeriodId), {
        reservedSeatMinutes: admin.firestore.FieldValue.increment(minutes),
        updatedAt: Date.now(),
    });
}
function consumeReservedSeatMinutesForBooking(tx, uid, membershipPeriodId, minutes) {
    if (!membershipPeriodId || minutes <= 0)
        return;
    tx.update(getDb().collection("users").doc(uid).collection("membershipPeriods").doc(membershipPeriodId), {
        reservedSeatMinutes: admin.firestore.FieldValue.increment(-minutes),
        usedSeatMinutes: admin.firestore.FieldValue.increment(minutes),
        updatedAt: Date.now(),
    });
}
function releaseReservedSeatMinutesForBooking(tx, uid, membershipPeriodId, minutes) {
    if (!membershipPeriodId || minutes <= 0)
        return;
    tx.update(getDb().collection("users").doc(uid).collection("membershipPeriods").doc(membershipPeriodId), {
        reservedSeatMinutes: admin.firestore.FieldValue.increment(-minutes),
        updatedAt: Date.now(),
    });
}
