import { POWER_NOW_SEND_ERROR } from "@/lib/powerNowLead";
import type { PowerNowFieldErrors } from "@/lib/powerNowLead";
import { decideLeadSubmitOutcome, EXPO_LEAD_ENDPOINT } from "@/lib/expoLeadQueue";

export const POWER_NOW_QUEUED_MESSAGE = "Saved — will sync";

export type PowerNowSubmission = {
  form: "power-now";
  path: "pitch" | "watch" | "contribute";
  fullName: string;
  email: string;
  phone: string;
  businessName: string;
  company: string;
  city: string;
  businessStage: string;
  businessStageOther: string;
  businessDescription: string;
  pitchTopic: string;
  progress: string;
  heardAbout: string;
  heardAboutOther: string;
  offerType: string;
  offerDescription: string;
  approximateValue: string;
  website: string;
  consent: { email: boolean; sms: boolean; phone: boolean };
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  referrerPath: string;
  submittedAt: string;
  clientSubmissionId: string;
  expo_hp: string;
  pnStartedAt?: string;
  recaptchaToken?: string;
};

export type QueuedPowerNow = {
  clientSubmissionId: string;
  payload: PowerNowSubmission;
  status: "pending" | "needs_attention";
  attempts: number;
  lastError: string | null;
  queuedAt: string;
  lastAttemptAt: string | null;
};

const DB_NAME = "accel-power-now-interest";
const DB_VERSION = 1;
const STORE = "outbox";

const listeners = new Set<() => void>();
const memory = new Map<string, QueuedPowerNow>();
let memoryMode = false;
let flushing = false;

export function powerNowQueueInMemory(): boolean {
  return memoryMode || typeof indexedDB === "undefined";
}

export function subscribePowerNowQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function enqueuePowerNow(payload: PowerNowSubmission, lastError: string | null = null): Promise<void> {
  const existing = await readLead(payload.clientSubmissionId);
  const record: QueuedPowerNow = {
    clientSubmissionId: payload.clientSubmissionId,
    payload,
    status: "pending",
    attempts: existing?.attempts ?? 0,
    lastError,
    queuedAt: existing?.queuedAt ?? new Date().toISOString(),
    lastAttemptAt: existing?.lastAttemptAt ?? null,
  };
  await writeLead(record);
  emit();
}

export async function listPowerNowQueue(): Promise<QueuedPowerNow[]> {
  const records = await readAll();
  return records.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function flushPowerNowQueue(options?: { force?: boolean }): Promise<{
  syncedIds: string[];
  leads: QueuedPowerNow[];
}> {
  if (flushing) return { syncedIds: [], leads: await listPowerNowQueue() };
  flushing = true;
  const syncedIds: string[] = [];
  try {
    const leads = await listPowerNowQueue();
    for (const lead of leads) {
      if (lead.status !== "pending") continue;
      if (!options?.force && lead.attempts > 0 && !readyToRetry(lead)) continue;
      const outcome = await postPowerNow(lead.payload);
      if (outcome.decision === "saved") {
        syncedIds.push(lead.clientSubmissionId);
        await deleteLead(lead.clientSubmissionId);
        continue;
      }
      await writeLead({
        ...lead,
        attempts: lead.attempts + 1,
        lastError: outcome.error,
        lastAttemptAt: new Date().toISOString(),
        status: outcome.decision === "queue" ? "pending" : "needs_attention",
      });
    }
  } finally {
    flushing = false;
    emit();
  }
  return { syncedIds, leads: await listPowerNowQueue() };
}

export async function postPowerNow(payload: PowerNowSubmission): Promise<{
  decision: "saved" | "queue" | "rejected";
  error: string | null;
  fields?: PowerNowFieldErrors;
}> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!online) return { decision: "queue", error: "Offline" };

  try {
    const response = await fetch(EXPO_LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: "timeout" in AbortSignal ? AbortSignal.timeout(20_000) : undefined,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json().catch(() => null) as { ok?: boolean; error?: string; fields?: PowerNowFieldErrors } | null
      : null;
    if (response.ok && body?.ok === true) return { decision: "saved", error: null };
    if (response.ok) return { decision: "rejected", error: POWER_NOW_SEND_ERROR };
    const decision = decideLeadSubmitOutcome({
      online: true,
      networkError: false,
      httpStatus: response.status,
    });
    if (decision === "rejected" || response.status === 429) {
      return { decision: "rejected", error: body?.error || POWER_NOW_SEND_ERROR, fields: body?.fields };
    }
    return { decision: "queue", error: body?.error || POWER_NOW_SEND_ERROR };
  } catch {
    return { decision: "queue", error: POWER_NOW_SEND_ERROR };
  }
}

function readyToRetry(lead: QueuedPowerNow): boolean {
  const waitMs = Math.min(5 * 60 * 1000, 2_000 * 2 ** Math.max(0, lead.attempts - 1));
  const lastAttempt = Date.parse(lead.lastAttemptAt ?? lead.queuedAt);
  if (Number.isNaN(lastAttempt)) return true;
  return Date.now() - lastAttempt >= waitMs;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientSubmissionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (memoryMode) throw new Error("memory");
  try {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  } catch (error) {
    memoryMode = true;
    throw error;
  }
}

async function readAll(): Promise<QueuedPowerNow[]> {
  if (memoryMode) return [...memory.values()];
  try {
    const records = await withStore<QueuedPowerNow[]>("readonly", (store) => store.getAll());
    return records ?? [];
  } catch {
    memoryMode = true;
    return [...memory.values()];
  }
}

async function readLead(id: string): Promise<QueuedPowerNow | null> {
  const records = await readAll();
  return records.find((record) => record.clientSubmissionId === id) ?? null;
}

async function writeLead(record: QueuedPowerNow): Promise<void> {
  memory.set(record.clientSubmissionId, record);
  if (memoryMode) return;
  try {
    await withStore("readwrite", (store) => store.put(record));
  } catch {
    memoryMode = true;
  }
}

async function deleteLead(id: string): Promise<void> {
  memory.delete(id);
  if (memoryMode) return;
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch {
    memoryMode = true;
  }
}
