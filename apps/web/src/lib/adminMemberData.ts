export type TimestampLike =
  | number
  | string
  | Date
  | {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    }
  | null
  | undefined;

export type AdminMemberRecord = {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  membershipStatus: string;
  plan?: string;
  expiresAt: number | null;
  accountCreditCents: number;
  createdAt: number | null;
  updatedAt: number | null;
};

export type AdminBookingRecord = {
  id: string;
  userId: string;
  userName: string;
  resourceId: string;
  resourceName: string;
  start: number | null;
  end: number | null;
  status: string;
  totalCents: number;
  subtotalCents: number;
  totalPrice: number;
  paymentMethod: string;
  includedHoursApplied: number | null;
  createdAt: number | null;
};

export type AdminPaymentRecord = {
  id: string;
  uid: string;
  provider: string;
  amount: number;
  currency: string;
  purpose: string;
  purposeRefId: string;
  status: string;
  createdAt: number | null;
  updatedAt: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

export function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function safeNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function toMillis(value: TimestampLike | unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Firestore/Unix seconds occasionally appear in older exports. Millisecond
    // timestamps for modern dates are well above this threshold.
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") {
      return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (value && typeof value === "object") {
    const timestamp = value as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof timestamp.toMillis === "function") {
      try {
        const millis = timestamp.toMillis();
        return Number.isFinite(millis) ? millis : null;
      } catch {
        return null;
      }
    }
    const seconds = safeNumber(timestamp.seconds ?? timestamp._seconds, Number.NaN);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }

  return null;
}

export function normalizeMember(rawValue: unknown, documentId: string): AdminMemberRecord {
  const raw = asRecord(rawValue);
  return {
    uid: safeText(raw.uid, documentId) || documentId,
    email: safeText(raw.email),
    displayName: safeText(raw.displayName),
    role: safeText(raw.role, "member"),
    membershipStatus: safeText(raw.membershipStatus, "none"),
    plan: safeText(raw.plan) || undefined,
    expiresAt: toMillis(raw.expiresAt),
    accountCreditCents: Math.max(0, Math.round(safeNumber(raw.accountCreditCents, 0))),
    createdAt: toMillis(raw.createdAt),
    updatedAt: toMillis(raw.updatedAt),
  };
}

export function normalizeBooking(rawValue: unknown, documentId: string): AdminBookingRecord {
  const raw = asRecord(rawValue);
  const applied = safeNumber(raw.includedHoursApplied, Number.NaN);
  return {
    id: safeText(raw.id, documentId) || documentId,
    userId: safeText(raw.userId),
    userName: safeText(raw.userName),
    resourceId: safeText(raw.resourceId),
    resourceName: safeText(raw.resourceName),
    start: toMillis(raw.start),
    end: toMillis(raw.end),
    status: safeText(raw.status, "UNKNOWN").toUpperCase(),
    totalCents: Math.max(0, Math.round(safeNumber(raw.totalCents, 0))),
    subtotalCents: Math.max(0, Math.round(safeNumber(raw.subtotalCents, 0))),
    totalPrice: Math.max(0, safeNumber(raw.totalPrice, 0)),
    paymentMethod: safeText(raw.paymentMethod),
    includedHoursApplied: Number.isFinite(applied) ? Math.max(0, applied) : null,
    createdAt: toMillis(raw.createdAt),
  };
}

export function normalizePayment(rawValue: unknown, documentId: string): AdminPaymentRecord {
  const raw = asRecord(rawValue);
  return {
    id: safeText(raw.id, documentId) || documentId,
    uid: safeText(raw.uid),
    provider: safeText(raw.provider, "unknown"),
    amount: Math.max(0, Math.round(safeNumber(raw.amount, 0))),
    currency: safeText(raw.currency, "USD"),
    purpose: safeText(raw.purpose, "other"),
    purposeRefId: safeText(raw.purposeRefId),
    status: safeText(raw.status, "unknown"),
    createdAt: toMillis(raw.createdAt),
    updatedAt: toMillis(raw.updatedAt),
  };
}
