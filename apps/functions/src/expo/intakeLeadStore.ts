/**
 * Booth and Power NOW leads live in Firestore collection intakeLeads.
 * The document id is clientSubmissionId, so a retry from the iPad queue
 * does not create a second lead. Attio is off unless ATTIO_INTAKE_ENABLED
 * is the string true. An Attio failure must not fail the submission.
 */

import * as admin from "firebase-admin";
import { defineString } from "firebase-functions/params";
import type { NormalizedExpoLead } from "./nasaLeadModel";
import type { NormalizedPowerNow } from "./powerNowModel";

export const INTAKE_LEADS_COLLECTION = "intakeLeads";

export const attioIntakeEnabledParam = defineString("ATTIO_INTAKE_ENABLED", {
  default: "false",
  description: "Set to true to also copy a saved intake lead to Attio. Any other value, including false or empty, does not call Attio.",
});

const DOC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function attioIntakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATTIO_INTAKE_ENABLED?.trim().toLowerCase() === "true";
}

export type IntakeLeadKind = "expo" | "power-now";

export type IntakeLeadDocument = {
  kind: IntakeLeadKind;
  storedAt: string;
  clientSubmissionId: string;
  submittedAt: string;
  consent: Array<{
    key: string;
    optIn: boolean;
    version: string;
    wording: string | null;
    capturedAtEt: string;
    source: string;
    phone?: string | null;
  }>;
  event: string | null;
  interests: Record<string, boolean>;
} & Record<string, unknown>;

export type IntakeLeadStore = {
  save(record: IntakeLeadDocument): Promise<{ created: boolean }>;
};

type LeadDb = {
  collection(name: string): {
    doc(id: string): {
      create(data: IntakeLeadDocument): Promise<unknown>;
    };
  };
};

export function buildExpoIntakeLead(lead: NormalizedExpoLead, storedAt: string): IntakeLeadDocument {
  return {
    kind: "expo",
    storedAt,
    ...lead,
  };
}

export function buildPowerNowIntakeLead(lead: NormalizedPowerNow, storedAt: string): IntakeLeadDocument {
  return {
    kind: "power-now",
    storedAt,
    event: null,
    ...lead,
    interests: {
      pitch: lead.path === "pitch",
      watch: lead.path === "watch",
      contribute: lead.path === "contribute",
    },
  };
}

export function createMemoryIntakeLeadStore(): IntakeLeadStore & {
  clear(): void;
  peek(id: string): IntakeLeadDocument | null;
} {
  const docs = new Map<string, IntakeLeadDocument>();
  return {
    async save(record) {
      const id = leadDocId(record.clientSubmissionId);
      const existing = docs.get(id);
      if (existing) return { created: false };
      docs.set(id, { ...record, clientSubmissionId: id });
      return { created: true };
    },
    clear() {
      docs.clear();
    },
    peek(id) {
      return docs.get(id.trim().toLowerCase()) ?? null;
    },
  };
}

const memoryStore = createMemoryIntakeLeadStore();

export function resetIntakeLeadMemoryForTests(): void {
  memoryStore.clear();
}

export function readIntakeLeadForTests(id: string): IntakeLeadDocument | null {
  return memoryStore.peek(id);
}

export function defaultIntakeLeadStore(): IntakeLeadStore {
  if (process.env.VITEST) return memoryStore;
  return createFirestoreIntakeLeadStore();
}

export function createFirestoreIntakeLeadStore(db?: LeadDb): IntakeLeadStore {
  const database = () => db ?? adminFirestore();
  return {
    async save(record) {
      const id = leadDocId(record.clientSubmissionId);
      const data = JSON.parse(JSON.stringify({ ...record, clientSubmissionId: id })) as IntakeLeadDocument;
      const ref = database().collection(INTAKE_LEADS_COLLECTION).doc(id);
      try {
        await ref.create(data);
        return { created: true };
      } catch (error) {
        if (isAlreadyExists(error)) return { created: false };
        throw error;
      }
    },
  };
}

export async function saveIntakeLead(
  store: IntakeLeadStore,
  record: IntakeLeadDocument,
): Promise<{ ok: true; created: boolean } | { ok: false }> {
  try {
    const saved = await store.save(record);
    return { ok: true, created: saved.created };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";
    console.error(`Intake lead store failed. code: ${code}`);
    return { ok: false };
  }
}

function leadDocId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!DOC_ID.test(trimmed)) throw new Error("Invalid intake lead id");
  return trimmed;
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

function adminFirestore(): LeadDb {
  if (admin.apps.length === 0) admin.initializeApp();
  return admin.firestore();
}
