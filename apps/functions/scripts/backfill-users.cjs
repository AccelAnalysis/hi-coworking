#!/usr/bin/env node

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "hi-coworking-plat";
const APPLY = process.env.APPLY === "true";
const VALID_ROLES = new Set(["member", "staff", "admin", "master"]);

function parseUidSet(value) {
  return new Set(
    (value || "")
      .split(",")
      .map((uid) => uid.trim())
      .filter(Boolean)
  );
}

function determineRole(uid, existingRole, masterUids, adminUids) {
  if (masterUids.has(uid)) return "master";
  if (adminUids.has(uid)) return "admin";
  if (VALID_ROLES.has(existingRole)) return existingRole;
  return "member";
}

function formatClaims(claims) {
  return JSON.stringify(claims || {});
}

async function listAllUsers() {
  const users = [];
  let pageToken;

  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  return users;
}

async function main() {
  const masterUids = parseUidSet(process.env.MASTER_UIDS);
  const adminUids = parseUidSet(process.env.ADMIN_UIDS);

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });

  const db = admin.firestore();
  const auth = admin.auth();
  const users = await listAllUsers();
  const summary = {
    total: users.length,
    docsToCreate: 0,
    docsToUpdate: 0,
    claimsToUpdate: 0,
    unchanged: 0,
  };

  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`MASTER_UIDS: ${masterUids.size}`);
  console.log(`ADMIN_UIDS: ${adminUids.size}`);
  console.log(`Total users found: ${users.length}`);

  for (const authUser of users) {
    const userRef = db.collection("users").doc(authUser.uid);
    const userSnap = await userRef.get();
    const existing = userSnap.exists ? userSnap.data() || {} : null;
    const now = Date.now();
    const role = determineRole(authUser.uid, existing?.role, masterUids, adminUids);
    const currentClaims = authUser.customClaims || {};
    const nextClaims = { ...currentClaims, role };
    const claimsNeedUpdate = currentClaims.role !== role;

    let docAction = "none";
    let docPayload;

    if (!existing) {
      docAction = "create";
      docPayload = {
        uid: authUser.uid,
        email: authUser.email || "",
        displayName: authUser.displayName || "",
        role,
        membershipStatus: "none",
        createdAt: now,
        updatedAt: now,
      };
      summary.docsToCreate += 1;
    } else {
      const roleShouldUpdate =
        masterUids.has(authUser.uid) ||
        adminUids.has(authUser.uid) ||
        !VALID_ROLES.has(existing.role);
      docPayload = {
        updatedAt: now,
      };

      if (roleShouldUpdate) {
        docPayload.role = role;
      }

      docAction = Object.keys(docPayload).length > 1 ? "update-role+updatedAt" : "update-updatedAt";
      summary.docsToUpdate += 1;
    }

    if (claimsNeedUpdate) {
      summary.claimsToUpdate += 1;
    }

    if (docAction === "none" && !claimsNeedUpdate) {
      summary.unchanged += 1;
    }

    console.log(
      [
        `uid=${authUser.uid}`,
        `email=${authUser.email || ""}`,
        `doc=${userSnap.exists ? "exists" : "missing"}`,
        `role=${role}`,
        `docAction=${docAction}`,
        `claims=${claimsNeedUpdate ? `${formatClaims(currentClaims)} -> ${formatClaims(nextClaims)}` : "unchanged"}`,
      ].join(" | ")
    );

    if (APPLY) {
      if (!existing) {
        await userRef.set(docPayload);
      } else {
        await userRef.set(docPayload, { merge: true });
      }

      if (claimsNeedUpdate) {
        await auth.setCustomUserClaims(authUser.uid, nextClaims);
      }
    }
  }

  console.log("Final summary:");
  console.log(JSON.stringify(summary, null, 2));

  if (!APPLY) {
    console.log("Dry run only. Re-run with APPLY=true to write Firestore docs and custom claims.");
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
});
