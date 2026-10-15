import { describe, expect, it } from "vitest";
import {
  POWER_NOW_CRITERIA_PART_B,
  POWER_NOW_FIT_PLACEHOLDER,
  PowerNowInputError,
  addPowerNowHost,
  addPowerNowJudge,
  assertContinueUrl,
  buildFitConversationNote,
  listPitchInterestFounders,
  powerNowScoreDocId,
  prepareSignInLink,
  removePowerNowJudge,
  requestFirebaseEmailSignIn,
  saveFitConversation,
  seedPowerNowPlaceholders,
  setSelectedPitcher,
  signInAllowed,
  validateFitAnswers,
  type AuthStore,
  type DocRecord,
  type DocStore,
} from "../../apps/functions/src/expo/powerNowForms";

const PERSON = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";

function memoryStore(): DocStore & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    async get(path) {
      const data = docs.get(path);
      return data ? { ...data } : null;
    },
    async set(path, data) {
      docs.set(path, { ...data });
    },
    async delete(path) {
      docs.delete(path);
    },
    async queryByEmail(collectionName, email) {
      const prefix = `${collectionName}/`;
      const rows: DocRecord[] = [];
      for (const [path, data] of docs) {
        if (path.startsWith(prefix) && data.email === email) {
          rows.push({ id: path.slice(prefix.length), data: { ...data } });
        }
      }
      return rows;
    },
  };
}

function memoryAuth(): AuthStore & { users: Map<string, { uid: string; claims: Record<string, unknown> }> } {
  const users = new Map<string, { uid: string; claims: Record<string, unknown> }>();
  let sequence = 0;
  return {
    users,
    async getByEmail(email) {
      for (const user of users.values()) {
        if (user.claims.email === email) return { uid: user.uid, claims: { ...user.claims } };
      }
      return null;
    },
    async create(email) {
      sequence += 1;
      const uid = `uid-${sequence}`;
      users.set(uid, { uid, claims: { email } });
      return { uid };
    },
    async setClaims(uid, claims) {
      const current = users.get(uid);
      if (!current) throw new Error("missing user");
      current.claims = { ...claims, email: current.claims.email };
    },
  };
}

describe("Power NOW forms", () => {
  it("builds one score id per night, pitcher, and judge", () => {
    expect(powerNowScoreDocId("2026-11-12", "founder-1", "judge-1")).toBe("2026-11-12_founder-1_judge-1");
  });

  it("keeps fit questions as placeholders and seeds the working rubric", () => {
    expect(POWER_NOW_FIT_PLACEHOLDER.placeholder).toBe(true);
    expect(POWER_NOW_FIT_PLACEHOLDER.items[0]?.prompt).toMatch(/^Placeholder question:/);
    expect(POWER_NOW_CRITERIA_PART_B.placeholder).toBe(false);
    expect(POWER_NOW_CRITERIA_PART_B.version).toBe("part-b-2026-10-15");
    expect(POWER_NOW_CRITERIA_PART_B.items.map((item) => item.weight)).toEqual([20, 20, 15, 15, 20, 10]);
    expect(POWER_NOW_CRITERIA_PART_B.items.every((item) => item.max === 5 && item.anchors.length === 3)).toBe(true);
    expect(POWER_NOW_CRITERIA_PART_B.items.map((item) => item.code)).toEqual(["J1", "J2", "J3", "J4", "J5", "J6"]);
  });

  it("seeds the working rubric once and replaces a placeholder rubric", async () => {
    const store = memoryStore();
    await seedPowerNowPlaceholders(store);
    const first = store.docs.get("powerNowCriteria/current");
    expect(first).toMatchObject({ placeholder: false, version: "part-b-2026-10-15" });
    await seedPowerNowPlaceholders(store);
    expect(store.docs.get("powerNowCriteria/current")).toEqual(first);
    expect(store.docs.get("powerNowFitQuestions/current")).toMatchObject({ placeholder: true });

    store.docs.set("powerNowCriteria/current", { placeholder: true, items: [], notice: "old" });
    await seedPowerNowPlaceholders(store);
    expect(store.docs.get("powerNowCriteria/current")).toMatchObject({ version: "part-b-2026-10-15", placeholder: false });

    store.docs.set("powerNowCriteria/current", { placeholder: false, version: "later-rubric", items: [{ id: "custom" }] });
    await seedPowerNowPlaceholders(store);
    expect(store.docs.get("powerNowCriteria/current")).toMatchObject({ version: "later-rubric" });
  });

  it("lists founders from the pitch competition list without returning the API key", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      expect(JSON.stringify(init?.headers)).toContain("Bearer test-key");
      expect(url).not.toContain("test-key");
      if (url.endsWith("/lists/pitch_competition/entries?limit=200")) {
        return json({ data: [{ parent_record_id: COMPANY, parent_object: "companies" }] });
      }
      if (url.endsWith(`/objects/companies/records/${COMPANY}`)) {
        return json({
          data: {
            id: { record_id: COMPANY },
            values: {
              name: [{ value: "Northwind" }],
              team: [{ target_object: "people", target_record_id: PERSON }],
            },
          },
        });
      }
      if (url.endsWith("/objects/people/records/query")) {
        const body = JSON.parse(String(init?.body));
        expect(body.filter.company.target_record_id).toBe(COMPANY);
        return json({ data: [] });
      }
      if (url.endsWith(`/objects/people/records/${PERSON}`)) {
        return json({
          data: {
            id: { record_id: PERSON },
            values: {
              name: [{ full_name: "Ada Lovelace" }],
              email_addresses: [{ email_address: "ada@example.com" }],
            },
          },
        });
      }
      return json({ data: [] }, 404);
    };

    const founders = await listPitchInterestFounders(fetchImpl, "test-key");
    expect(founders).toEqual([
      { personId: PERSON, name: "Ada Lovelace", email: "ada@example.com", company: "Northwind" },
    ]);
    expect(JSON.stringify(founders)).not.toContain("test-key");
    expect(calls.some((call) => call.includes("/lists/pitch_competition/entries"))).toBe(true);
  });

  it("saves a fit note from the Firestore question list", async () => {
    const store = memoryStore();
    await seedPowerNowPlaceholders(store);
    let note = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      note = String(init?.body);
      return json({ data: { id: { note_id: "note-1" } } });
    };
    const answers = Object.fromEntries(POWER_NOW_FIT_PLACEHOLDER.items.map((item) => [item.id, `Answer for ${item.id}`]));
    await saveFitConversation({
      fetchImpl,
      apiKey: "test-key",
      store,
      personId: PERSON,
      founderName: "Ada Lovelace",
      company: "Northwind",
      answers,
      now: new Date("2026-10-15T12:00:00.000Z"),
    });
    const body = JSON.parse(note) as { data: { parent_object: string; parent_record_id: string; content: string } };
    expect(body.data.parent_object).toBe("people");
    expect(body.data.parent_record_id).toBe(PERSON);
    expect(body.data.content).toContain("Placeholder question: what problem is this business solving?");
    expect(body.data.content).toContain("Answer for placeholder-problem");
    expect(body.data.content).toContain("placeholder");
    expect(note).not.toContain("test-key");
  });

  it("rejects a partial fit conversation", () => {
    expect(() => validateFitAnswers([{ id: "placeholder-problem", prompt: "Question" }], {})).toThrow(PowerNowInputError);
    const note = buildFitConversationNote({
      founderName: "Ada",
      company: "Northwind",
      placeholder: true,
      questions: [{ id: "placeholder-problem", prompt: "Question" }],
      answers: { "placeholder-problem": "A real problem." },
      savedAt: "2026-10-15T12:00:00.000Z",
    });
    expect(note).toContain("A real problem.");
  });

  it("gives judges and selected pitchers their own sign-in, and ignores everyone else", async () => {
    const store = memoryStore();
    const auth = memoryAuth();
    await addPowerNowJudge(store, auth, "Judge@Example.com", "admin-1");
    expect(auth.users.get("uid-1")?.claims.powerNowJudge).toBe(true);
    expect(signInAllowed("judge", [{ id: "uid-1", data: { active: true } }], [])).toBe(true);

    const judgeLink = await prepareSignInLink(store, {
      email: "judge@example.com",
      origin: "https://forms.accelanalysis.com",
      path: "/power-now/score",
    });
    expect(judgeLink?.audience).toBe("judge");
    expect(await prepareSignInLink(store, {
      email: "stranger@example.com",
      origin: "https://hi-coworking.com",
      path: "/power-now/score",
    })).toBeNull();

    await expect(setSelectedPitcher(store, auth, {
      nightId: "2026-11-12",
      pitcherId: "founder-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Northwind",
      selected: true,
    })).rejects.toBeInstanceOf(PowerNowInputError);
    expect(store.docs.get("powerNowNights/2026-11-12")).toBeUndefined();
    await store.set("powerNowNights/2026-11-12", { label: "November night", locked: false });
    await setSelectedPitcher(store, auth, {
      nightId: "2026-11-12",
      pitcherId: "founder-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Northwind",
      selected: true,
    });
    expect(store.docs.get("powerNowNights/2026-11-12/pitchers/founder-1")).toMatchObject({ selected: true, email: "ada@example.com" });
    const pitcherLink = await prepareSignInLink(store, {
      email: "ada@example.com",
      origin: "http://localhost:3000",
      path: "/power-now/rubric",
    });
    expect(pitcherLink?.audience).toBe("pitcher");
    expect(await prepareSignInLink(store, {
      email: "ada@example.com",
      origin: "https://hi-coworking.com",
      path: "/power-now/score",
    })).toBeNull();

    await addPowerNowHost(store, auth, "host@example.com", "admin-1");
    const hostLink = await prepareSignInLink(store, {
      email: "host@example.com",
      origin: "https://forms.accelanalysis.com",
      path: "/power-now/results",
    });
    expect(hostLink?.audience).toBe("host");
    expect(await prepareSignInLink(store, {
      email: "judge@example.com",
      origin: "https://forms.accelanalysis.com",
      path: "/power-now/results",
    })).toBeNull();

    await removePowerNowJudge(store, auth, "uid-1");
    expect(store.docs.get("powerNowJudges/uid-1")?.active).toBe(false);
    expect(await prepareSignInLink(store, {
      email: "judge@example.com",
      origin: "https://hi-coworking-plat.web.app",
      path: "/power-now/score",
    })).toBeNull();
  });

  it("refuses a sign-in link from an unknown host and hides the API key", async () => {
    expect(() => assertContinueUrl("https://evil.example", "/power-now/score")).toThrow(PowerNowInputError);
    expect(() => assertContinueUrl("https://hi-coworking.com", "/admin")).toThrow(PowerNowInputError);
    let requested = "";
    await expect(requestFirebaseEmailSignIn(async (input) => {
      requested = String(input);
      return new Response("no", { status: 400 });
    }, "super-secret-key", "ada@example.com", "https://hi-coworking.com/power-now/score")).rejects.toThrow(/could not be sent/);
    expect(requested).toContain("super-secret-key");
    try {
      await requestFirebaseEmailSignIn(async () => new Response("no", { status: 400 }), "super-secret-key", "ada@example.com", "https://hi-coworking.com/power-now/score");
    } catch (error) {
      expect(error).toBeInstanceOf(PowerNowInputError);
      expect((error as Error).message).not.toContain("super-secret-key");
    }
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
