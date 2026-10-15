import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  PowerNowInputError,
  addPowerNowJudge,
  listPitchInterestFounders,
  lockPowerNowNight,
  prepareSignInLink,
  removePowerNowJudge,
  requestFirebaseEmailSignIn,
  saveFitConversation,
  savePowerNowNight,
  seedPowerNowPlaceholders,
  setSelectedPitcher,
  type AuthStore,
  type DocStore,
} from "./powerNowForms";

if (admin.apps.length === 0) admin.initializeApp();

/** Secret Manager secret ATTIO_API_KEY on hi-coworking-plat. Never returned to the client. */
const attioApiKey = defineSecret("ATTIO_API_KEY");

function requireAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const role = String(request.auth.token.role || "");
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

function readAttioApiKey(): string {
  const fromEnv = process.env.ATTIO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    return attioApiKey.value()?.trim() || "";
  } catch {
    return "";
  }
}

function asError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof PowerNowInputError) throw new HttpsError("invalid-argument", error.message);
  const message = error instanceof Error ? error.message : "unknown";
  logger.error("Power NOW request failed", { message });
  throw new HttpsError("internal", "That request could not be completed.");
}

function docStore(): DocStore {
  const db = admin.firestore();
  return {
    async get(path) {
      const snap = await db.doc(path).get();
      return snap.exists ? snap.data() as Record<string, unknown> : null;
    },
    async set(path, data) {
      await db.doc(path).set(data);
    },
    async delete(path) {
      await db.doc(path).delete();
    },
    async queryByEmail(collectionName, email) {
      const snap = await db.collection(collectionName).where("email", "==", email).limit(5).get();
      return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

function authStore(): AuthStore {
  const auth = admin.auth();
  return {
    async getByEmail(email) {
      try {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid, claims: user.customClaims ?? {} };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "auth/user-not-found") return null;
        throw error;
      }
    },
    async create(email) {
      const user = await auth.createUser({ email, emailVerified: false });
      return { uid: user.uid };
    },
    async setClaims(uid, claims) {
      await auth.setCustomUserClaims(uid, claims);
    },
  };
}

async function webApiKey(): Promise<string> {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return "demo-api-key";
  const response = await fetch("https://hi-coworking-plat.web.app/__/firebase/init.json");
  if (!response.ok) throw new PowerNowInputError("Passwordless sign-in is not available right now.");
  const json = await response.json() as { apiKey?: string; projectId?: string };
  if (json.projectId !== "hi-coworking-plat" || !json.apiKey) {
    throw new PowerNowInputError("Passwordless sign-in is not available right now.");
  }
  return json.apiKey;
}

export const powerNow_listPitchFounders = onCall({ secrets: [attioApiKey] }, async (request) => {
  requireAdmin(request);
  try {
    const founders = await listPitchInterestFounders(fetch, readAttioApiKey());
    return { founders };
  } catch (error) {
    asError(error);
  }
});

export const powerNow_saveFitNote = onCall({ secrets: [attioApiKey] }, async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as {
    personId?: unknown;
    founderName?: unknown;
    company?: unknown;
    answers?: unknown;
  };
  try {
    return await saveFitConversation({
      fetchImpl: fetch,
      apiKey: readAttioApiKey(),
      store: docStore(),
      personId: String(data.personId ?? ""),
      founderName: String(data.founderName ?? ""),
      company: String(data.company ?? ""),
      answers: data.answers && typeof data.answers === "object" ? data.answers as Record<string, unknown> : {},
    });
  } catch (error) {
    asError(error);
  }
});

export const powerNow_seedPlaceholders = onCall(async (request) => {
  requireAdmin(request);
  try {
    return await seedPowerNowPlaceholders(docStore());
  } catch (error) {
    asError(error);
  }
});

export const powerNow_addJudge = onCall(async (request) => {
  const uid = requireAdmin(request);
  const data = (request.data ?? {}) as { email?: unknown };
  try {
    return await addPowerNowJudge(docStore(), authStore(), data.email, uid);
  } catch (error) {
    asError(error);
  }
});

export const powerNow_removeJudge = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as { uid?: unknown };
  try {
    return await removePowerNowJudge(docStore(), authStore(), data.uid);
  } catch (error) {
    asError(error);
  }
});

export const powerNow_saveNight = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as { nightId?: unknown; label?: unknown };
  try {
    return await savePowerNowNight(docStore(), data.nightId, data.label);
  } catch (error) {
    asError(error);
  }
});

export const powerNow_lockNight = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as { nightId?: unknown; locked?: unknown };
  try {
    return await lockPowerNowNight(docStore(), data.nightId, data.locked === true);
  } catch (error) {
    asError(error);
  }
});

export const powerNow_setSelectedPitcher = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as {
    nightId?: unknown;
    pitcherId?: unknown;
    name?: unknown;
    email?: unknown;
    company?: unknown;
    attioPersonId?: unknown;
    selected?: unknown;
  };
  try {
    return await setSelectedPitcher(docStore(), authStore(), data);
  } catch (error) {
    asError(error);
  }
});

export const powerNow_sendSignInLink = onCall(async (request) => {
  const data = (request.data ?? {}) as { email?: unknown; origin?: unknown; path?: unknown };
  try {
    const prepared = await prepareSignInLink(docStore(), data);
    if (!prepared) return { ok: true };
    const apiKey = await webApiKey();
    await requestFirebaseEmailSignIn(
      fetch,
      apiKey,
      prepared.email,
      prepared.continueUrl,
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
    );
    logger.info("Power NOW sign-in email requested", { audience: prepared.audience });
    return { ok: true };
  } catch (error) {
    asError(error);
  }
});
