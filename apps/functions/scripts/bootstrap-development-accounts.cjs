#!/usr/bin/env node

const admin = require("firebase-admin");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function assertDevelopmentAccountEmail(email, label) {
  if (!email) throw new Error(`${label} email is required through the matching environment variable.`);
  const normalized = email.toLowerCase();
  const looksDedicated = normalized.includes("exchange-dev")
    || normalized.includes("exchange-smoke")
    || normalized.endsWith("@example.test");
  if (!looksDedicated) {
    throw new Error(`${label} email must be a dedicated development identity containing 'exchange-dev' or 'exchange-smoke'. Refusing to modify a general-use account.`);
  }
}

function assertPassword(password, label) {
  if (!password || password.length < 12) {
    throw new Error(`${label} password must be supplied through an environment variable and contain at least 12 characters.`);
  }
}

function assertSafety({ projectId, apply, confirmation }) {
  if (!projectId) throw new Error("--project is required; refusing an unscoped account bootstrap.");
  if (!apply) return;
  if (confirmation !== projectId) {
    throw new Error(`Refusing development account writes. Re-run with --apply --confirm-development ${projectId}.`);
  }
}

async function findUser(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function planAccount(auth, email, role) {
  const existing = await findUser(auth, email);
  return {
    email,
    role,
    exists: Boolean(existing),
    uid: existing?.uid || null,
    action: existing ? "normalize-development-account" : "create-development-account",
  };
}

async function applyAccount({ auth, db, email, password, role, displayName }) {
  const existing = await findUser(auth, email);
  const user = existing
    ? await auth.updateUser(existing.uid, { password, displayName, emailVerified: true, disabled: false })
    : await auth.createUser({ email, password, displayName, emailVerified: true, disabled: false });

  await auth.setCustomUserClaims(user.uid, { role, developmentTestAccount: true });
  const now = Date.now();
  const userDoc = {
    uid: user.uid,
    email,
    displayName,
    role,
    membershipStatus: "none",
    developmentTestAccount: true,
    developmentPurpose: "configured_exchange_smoke",
    updatedAt: now,
  };
  if (!existing) userDoc.createdAt = now;
  await db.collection("users").doc(user.uid).set(userDoc, { merge: true });

  return {
    uid: user.uid,
    email,
    role,
    action: existing ? "normalized" : "created",
  };
}

async function main() {
  const projectId = argument("--project") || process.env.EXCHANGE_DEV_PROJECT_ID || "hi-coworking-plat";
  const apply = hasFlag("--apply");
  const confirmation = argument("--confirm-development");
  assertSafety({ projectId, apply, confirmation });

  const memberEmail = process.env.EXCHANGE_DEV_TEST_EMAIL;
  const memberPassword = process.env.EXCHANGE_DEV_TEST_PASSWORD;
  const adminEmail = process.env.EXCHANGE_DEV_ADMIN_EMAIL;
  const adminPassword = process.env.EXCHANGE_DEV_ADMIN_PASSWORD;

  assertDevelopmentAccountEmail(memberEmail, "Member");
  assertDevelopmentAccountEmail(adminEmail, "Admin");
  assertPassword(memberPassword, "Member");
  assertPassword(adminPassword, "Admin");
  if (memberEmail.toLowerCase() === adminEmail.toLowerCase()) {
    throw new Error("Member and admin smoke identities must be separate accounts.");
  }

  if (!admin.apps.length) admin.initializeApp({ projectId });
  const auth = admin.auth();
  const db = admin.firestore();

  const report = {
    projectId,
    dryRun: !apply,
    generatedAt: new Date().toISOString(),
    accounts: apply
      ? [
          await applyAccount({
            auth,
            db,
            email: memberEmail,
            password: memberPassword,
            role: "member",
            displayName: "Exchange Development Member",
          }),
          await applyAccount({
            auth,
            db,
            email: adminEmail,
            password: adminPassword,
            role: "admin",
            displayName: "Exchange Development Admin",
          }),
        ]
      : [
          await planAccount(auth, memberEmail, "member"),
          await planAccount(auth, adminEmail, "admin"),
        ],
    safeguards: {
      dedicatedEmailMarkerRequired: true,
      exactProjectConfirmationRequiredForWrites: true,
      generalUserAccountsRejected: true,
      productionRolesLimitedToDevelopmentAccounts: true,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    console.log(`\nDry run only. Review the plan, then re-run with --apply --confirm-development ${projectId}.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertDevelopmentAccountEmail,
  assertPassword,
  assertSafety,
};
