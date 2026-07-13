import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-hi-coworking";

let admin: typeof import("firebase-admin");
let backfillRfxResponseAccess: typeof import(
  "../../apps/functions/src/scripts/backfillRfxResponseAccess"
).backfillRfxResponseAccess;

async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is required");
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Failed to clear Firestore emulator: ${response.status}`);
}

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
  admin = await import("firebase-admin");
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  ({ backfillRfxResponseAccess } = await import(
    "../../apps/functions/src/scripts/backfillRfxResponseAccess"
  ));
});

beforeEach(clearFirestore);

describe("RFx response access marker backfill", () => {
  it("classifies exact, resolvable, invalid, and duplicate records without writes", async () => {
    const db = admin.firestore();
    await Promise.all([
      db.collection("rfxResponses").doc("a-already").set({
        id: "a-already",
        rfxId: "rfx-already",
        respondentUid: "already-user",
        uploadedDocuments: [],
        submittedAt: 10,
      }),
      db.collection("rfxResponses").doc("b-duplicate-one").set({
        id: "b-duplicate-one",
        rfxId: "rfx-duplicate",
        respondentUid: "duplicate-user",
        uploadedDocuments: [],
        submittedAt: 20,
      }),
      db.collection("rfxResponses").doc("b-duplicate-two").set({
        id: "b-duplicate-two",
        rfxId: "rfx-duplicate",
        respondentUid: "duplicate-user",
        uploadedDocuments: [],
        submittedAt: 21,
      }),
      db.collection("rfxResponses").doc("c-legacy-url").set({
        id: "c-legacy-url",
        rfxId: "rfx-legacy",
        respondentUid: "legacy-user",
        proposalUrl: "https://firebasestorage.example.test/bearer-token",
        uploadedDocuments: [{
          url: "https://firebasestorage.example.test/document-token",
          fileName: "legacy.pdf",
        }],
        submittedAt: 30,
      }),
      db.collection("rfxResponses").doc("d-resolved").set({
        id: "d-resolved",
        rfxId: "rfx-resolved",
        respondentUid: "resolved-user",
        proposalStoragePath: "rfxResponses/rfx-resolved/resolved-user/proposal.pdf",
        uploadedDocuments: [],
        submittedAt: 40,
      }),
      db.doc("rfxResponseAccess/rfx-already/respondents/already-user").set({
        id: "already-user",
        rfxId: "rfx-already",
        respondentUid: "already-user",
        responseId: "a-already",
        attachmentStoragePaths: [],
        submittedAt: 10,
      }),
    ]);

    const report = await backfillRfxResponseAccess({
      projectId: PROJECT_ID,
      pageSize: 1,
    });
    expect(report).toMatchObject({
      dryRun: true,
      totalScanned: 5,
      alreadyValid: 1,
      resolved: 1,
      invalid: 1,
      ambiguous: 2,
      updatesApplied: 0,
      failed: 0,
      complete: true,
      nextAfterId: null,
    });
    expect(report.reasonCounts).toMatchObject({
      legacy_proposal_url_without_storage_path: 1,
      legacy_document_url_without_storage_path: 1,
    });
    expect(report.reviewRequired.map((item) => item.responseId)).toEqual([
      "b-duplicate-one",
      "b-duplicate-two",
      "c-legacy-url",
    ]);
    expect((await db.doc(
      "rfxResponseAccess/rfx-resolved/respondents/resolved-user",
    ).get()).exists).toBe(false);
  });

  it("reconciles authoritative fields, preserves unrelated metadata, and is idempotent", async () => {
    const db = admin.firestore();
    await Promise.all([
      db.collection("rfxResponses").doc("individual-response").set({
        id: "individual-response",
        rfxId: "individual-rfx",
        respondentUid: "individual-user",
        proposalStoragePath: "rfxProposals/individual-rfx/individual-user/proposal.pdf",
        uploadedDocuments: [{
          storagePath: "rfxDocuments/individual-rfx/individual-user/safety/safety.pdf",
        }],
        submittedAt: admin.firestore.Timestamp.fromMillis(100),
      }),
      db.collection("rfxResponses").doc("org-response").set({
        id: "org-response",
        rfxId: "org-rfx",
        respondentUid: "org-submitter",
        respondentOrgId: "respondent-org",
        uploadedDocuments: [],
        submittedAt: 200,
      }),
      db.doc("rfxResponseAccess/individual-rfx/respondents/individual-user").set({
        id: "individual-user",
        rfxId: "individual-rfx",
        respondentUid: "individual-user",
        responseId: "stale-response",
        respondentOrgId: "stale-org-authority",
        attachmentStoragePaths: [
          "rfxResponses/individual-rfx/individual-user/unreferenced.pdf",
        ],
        legacyNote: "preserve this non-authoritative metadata",
      }),
    ]);

    const applied = await backfillRfxResponseAccess({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
      pageSize: 1,
    });
    expect(applied).toMatchObject({
      dryRun: false,
      totalScanned: 2,
      resolved: 2,
      alreadyValid: 0,
      invalid: 0,
      ambiguous: 0,
      updatesApplied: 2,
      failed: 0,
    });

    const individual = (await db.doc(
      "rfxResponseAccess/individual-rfx/respondents/individual-user",
    ).get()).data();
    expect(individual).toMatchObject({
      id: "individual-user",
      rfxId: "individual-rfx",
      respondentUid: "individual-user",
      responseId: "individual-response",
      attachmentStoragePaths: [
        "rfxDocuments/individual-rfx/individual-user/safety/safety.pdf",
        "rfxProposals/individual-rfx/individual-user/proposal.pdf",
      ],
      submittedAt: 100,
      legacyNote: "preserve this non-authoritative metadata",
    });
    expect(individual).not.toHaveProperty("respondentOrgId");
    expect((await db.doc(
      "rfxResponseAccess/org-rfx/respondents/org-submitter",
    ).get()).data()).toMatchObject({
      id: "org-submitter",
      rfxId: "org-rfx",
      respondentUid: "org-submitter",
      respondentOrgId: "respondent-org",
      responseId: "org-response",
      attachmentStoragePaths: [],
      submittedAt: 200,
    });
    expect((await db.collection("exchangeAudit")
      .where("action", "==", "rfx_response_access_reconciled")
      .get()).size).toBe(2);

    const replay = await backfillRfxResponseAccess({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(replay).toMatchObject({
      alreadyValid: 2,
      resolved: 0,
      updatesApplied: 0,
      failed: 0,
    });
  });

  it("uses a deterministic document-ID cursor and reports whether more work remains", async () => {
    const db = admin.firestore();
    await Promise.all(["a", "b", "c"].map((id) => (
      db.collection("rfxResponses").doc(id).set({
        id,
        rfxId: `rfx-${id}`,
        respondentUid: `user-${id}`,
        uploadedDocuments: [],
        submittedAt: 1,
      })
    )));

    const first = await backfillRfxResponseAccess({
      projectId: PROJECT_ID,
      limit: 2,
      pageSize: 1,
    });
    expect(first).toMatchObject({
      totalScanned: 2,
      resolved: 2,
      complete: false,
      nextAfterId: "b",
    });

    const second = await backfillRfxResponseAccess({
      projectId: PROJECT_ID,
      afterId: first.nextAfterId ?? undefined,
      limit: 2,
      pageSize: 1,
    });
    expect(second).toMatchObject({
      afterId: "b",
      totalScanned: 1,
      resolved: 1,
      complete: true,
      nextAfterId: null,
    });
  });

  it("never writes an ambiguous marker key", async () => {
    const db = admin.firestore();
    await Promise.all(["one", "two"].map((suffix) => (
      db.collection("rfxResponses").doc(`duplicate-${suffix}`).set({
        id: `duplicate-${suffix}`,
        rfxId: "duplicate-rfx",
        respondentUid: "duplicate-user",
        uploadedDocuments: [],
        submittedAt: 1,
      })
    )));
    await db.doc("rfxResponseAccess/duplicate-rfx/respondents/duplicate-user").set({
      existing: "must remain untouched",
    });

    const report = await backfillRfxResponseAccess({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: PROJECT_ID,
    });
    expect(report).toMatchObject({
      ambiguous: 2,
      resolved: 0,
      updatesApplied: 0,
      failed: 0,
    });
    expect((await db.doc(
      "rfxResponseAccess/duplicate-rfx/respondents/duplicate-user",
    ).get()).data()).toEqual({ existing: "must remain untouched" });
  });

  it("requires exact project identity confirmation before apply mode", async () => {
    await expect(backfillRfxResponseAccess({ apply: true }))
      .rejects.toThrow("--apply requires an explicit --project");
    await expect(backfillRfxResponseAccess({
      apply: true,
      projectId: PROJECT_ID,
      confirmProject: "wrong-project",
    })).rejects.toThrow(`--confirm-project=${PROJECT_ID}`);
  });
});
