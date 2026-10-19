import type { ExpoLeadPayload } from "../../../functions/src/expo/nasaLeadModel";

export const EXPO_LEAD_ENDPOINT = "/api/expo/nasa-lead";
export const EXPO_OFFLINE_SAVED_MESSAGE = "Thanks, we've got it";

const VISITOR_ERROR_BY_MESSAGE: Record<string, string> = {
  "This booth form cannot be submitted from that site.": "This page can't send from here. Please try again.",
  "That lead is too large.": "That's too long to send. Please shorten it and try again.",
  "Lead capture is not configured.": "We couldn't send this just now. Please try again.",
  "Attio could not save this lead yet.": "We couldn't send this just now. Please try again.",
  "More than one Attio person matches this phone. Add an email so the booth does not merge the wrong people.":
    "Add your email so we follow up with the right person.",
  "Method not allowed": "We couldn't send this. Please try again.",
  Offline: "The connection dropped. We'll try again.",
  "The network dropped before Attio confirmed the lead.": "The connection dropped before this sent.",
  "This lead could not be read. Enter it again.": "We couldn't read this. Please enter it again.",
  "Enter the visitor's full name.": "Enter your full name.",
  "Enter their organization.": "Enter your organization.",
  "Enter their role or title.": "Enter your role or title.",
  "Choose an organization type.": "Choose your organization type.",
  "Enter what they need, in their words.": "Tell us what you need, in your words.",
  "Timing should be a short note.": "Please keep timing to a short note.",
  "This lead is missing its booth id. Enter it again.": "Please try sending this again.",
  "Enter an email or a phone number.": "Enter your email or phone number.",
  "Text consent needs a phone number.": "Add your phone number to agree to texts.",
  "Phone consent needs a phone number.": "Add your phone number to agree to calls.",
  "Email consent needs an email address.": "Add your email to agree to email.",
  "Could not save this lead.": "We couldn't send this. Please try again.",
  "This lead needs a correction before it can sync.": "Please correct this before we can send it.",
  "This device could not store the lead. Keep the page open and try again.":
    "We couldn't save this just now. Keep this page open and try again.",
};

const INTERNAL_VISITOR_ERROR = /\b(attio|booth|leads?|sync(?:ing|ed)?|devices?|queues?|indexeddb)\b/i;

export function toVisitorError(message: string | null | undefined): string {
  const text = (message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Please try again.";
  const known = VISITOR_ERROR_BY_MESSAGE[text];
  if (known) return known;
  if (INTERNAL_VISITOR_ERROR.test(text)) return "We couldn't send this. Please try again.";
  return text;
}

const DB_NAME = "accel-nasa-expo-2026";
const DB_VERSION = 1;
const STORE = "outbox";

export type QueuedExpoLead = {
  clientSubmissionId: string;
  payload: ExpoLeadPayload;
  status: "pending" | "needs_attention";
  attempts: number;
  lastError: string | null;
  queuedAt: string;
  lastAttemptAt: string | null;
};

export type ExpoSubmitDecision = "saved" | "queue" | "rejected";

const listeners = new Set<() => void>();
const memory = new Map<string, QueuedExpoLead>();
let memoryMode = false;
let flushing = false;

export function decideLeadSubmitOutcome(input: {
  online: boolean;
  networkError: boolean;
  httpStatus: number | null;
}): ExpoSubmitDecision {
  if (!input.online || input.networkError || input.httpStatus == null) return "queue";
  if (input.httpStatus >= 200 && input.httpStatus < 300) return "saved";
  if (input.httpStatus === 400 || input.httpStatus === 403 || input.httpStatus === 409 || input.httpStatus === 413 || input.httpStatus === 422) {
    return "rejected";
  }
  return "queue";
}

export function expoQueueInMemory(): boolean {
  return memoryMode || typeof indexedDB === "undefined";
}

export function subscribeExpoQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function enqueueExpoLead(payload: ExpoLeadPayload, lastError: string | null = null): Promise<void> {
  const existing = await readLead(payload.clientSubmissionId);
  const record: QueuedExpoLead = {
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

export async function listExpoLeads(): Promise<QueuedExpoLead[]> {
  const records = await readAll();
  return records.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeExpoLead(clientSubmissionId: string): Promise<void> {
  await deleteLead(clientSubmissionId);
  emit();
}

export async function flushExpoLeads(options?: { force?: boolean }): Promise<{
  syncedIds: string[];
  leads: QueuedExpoLead[];
}> {
  if (flushing) {
    return { syncedIds: [], leads: await listExpoLeads() };
  }
  flushing = true;
  const syncedIds: string[] = [];
  try {
    const leads = await listExpoLeads();
    for (const lead of leads) {
      if (lead.status !== "pending") continue;
      if (!options?.force && lead.attempts > 0 && !readyToRetry(lead)) continue;
      const outcome = await postExpoLead(lead.payload);
      if (outcome.decision === "saved") {
        syncedIds.push(lead.clientSubmissionId);
        await deleteLead(lead.clientSubmissionId);
        continue;
      }
      const next: QueuedExpoLead = {
        ...lead,
        attempts: lead.attempts + 1,
        lastError: outcome.error,
        lastAttemptAt: new Date().toISOString(),
        status: outcome.decision === "queue" ? "pending" : "needs_attention",
      };
      await writeLead(next);
    }
  } finally {
    flushing = false;
    emit();
  }
  return { syncedIds, leads: await listExpoLeads() };
}

export async function postExpoLead(payload: ExpoLeadPayload): Promise<{
  decision: ExpoSubmitDecision;
  error: string | null;
}> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!online) {
    return { decision: "queue", error: "The connection dropped. We'll try again." };
  }

  try {
    const response = await fetch(EXPO_LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: "timeout" in AbortSignal ? AbortSignal.timeout(20_000) : undefined,
    });
    const decision = decideLeadSubmitOutcome({
      online: true,
      networkError: false,
      httpStatus: response.status,
    });
    if (decision === "saved") return { decision, error: null };
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return {
      decision,
      error: toVisitorError(body?.error || "We couldn't send this. Please try again."),
    };
  } catch {
    return { decision: "queue", error: "The connection dropped before this sent." };
  }
}

function readyToRetry(lead: QueuedExpoLead): boolean {
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientSubmissionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  if (memoryMode) {
    throw new Error("memory");
  }
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

async function readAll(): Promise<QueuedExpoLead[]> {
  if (memoryMode) return [...memory.values()];
  try {
    const records = await withStore<QueuedExpoLead[]>("readonly", (store) => store.getAll());
    return records ?? [];
  } catch {
    memoryMode = true;
    return [...memory.values()];
  }
}

async function readLead(id: string): Promise<QueuedExpoLead | null> {
  const records = await readAll();
  return records.find((record) => record.clientSubmissionId === id) ?? null;
}

async function writeLead(record: QueuedExpoLead): Promise<void> {
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
