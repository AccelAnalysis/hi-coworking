"use client";

import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "./firebase";

function savedRfxId(uid: string, rfxId: string): string {
  return `${uid}_rfx_${rfxId}`;
}

const LEGACY_SAVED_RFX_LIMIT = 500;
const SAFE_RFX_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

export function parseLegacySavedRfx(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(
      parsed.filter((value): value is string =>
        typeof value === "string" && SAFE_RFX_ID.test(value),
      ),
    )].slice(0, LEGACY_SAVED_RFX_LIMIT);
  } catch {
    return [];
  }
}

async function listSavedRfx(uid: string): Promise<string[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "savedExchangeItems"),
      where("uid", "==", uid),
      where("entityType", "==", "rfx"),
    ),
  );
  return snapshot.docs
    .map((item) => item.data().entityId)
    .filter((entityId): entityId is string => typeof entityId === "string");
}

export async function saveRfx(uid: string, rfxId: string): Promise<void> {
  const id = savedRfxId(uid, rfxId);
  await setDoc(doc(db, "savedExchangeItems", id), {
    id,
    uid,
    entityType: "rfx",
    entityId: rfxId,
    createdAt: Date.now(),
  });
}

export async function unsaveRfx(uid: string, rfxId: string): Promise<void> {
  await deleteDoc(doc(db, "savedExchangeItems", savedRfxId(uid, rfxId)));
}

export async function loadSavedRfxWithLegacyImport(uid: string): Promise<string[]> {
  const existing = await listSavedRfx(uid);
  const saved = new Set(existing);
  const markerKey = `saved_exchange_imported_v1_${uid}`;
  if (localStorage.getItem(markerKey) === "true") return [...saved];

  const legacyKey = `saved_rfx_${uid}`;
  const raw = localStorage.getItem(legacyKey);
  const legacyIds = parseLegacySavedRfx(raw);

  const imports = legacyIds
    .filter((rfxId) => !saved.has(rfxId))
    .map(async (rfxId) => {
      await saveRfx(uid, rfxId);
      saved.add(rfxId);
    });
  // Deterministic document IDs make retries idempotent. A failed write is
  // intentionally propagated so the completion marker is not set and a later
  // load can retry the incomplete import.
  await Promise.all(imports);
  localStorage.setItem(markerKey, "true");
  return [...saved];
}
