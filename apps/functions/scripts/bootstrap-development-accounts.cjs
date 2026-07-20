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

async function applyAccount({ auth, db, email, password, role, displayName, developmentPurpose }) {
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
    developmentPurpose,
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

function optionalAccount(env, prefix, label, developmentPurpose) {
  const email = env[`EXCHANGE_DEV_${prefix}_EMAIL`];
  const password = env[`EXCHANGE_DEV_${prefix}_PASSWORD`];
  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error(`${label} email and password must either both be supplied or both be omitted.`);
  }
  return {
    email,
    password,
    role: "member",
    displayName: `Exchange Development ${label}`,
    label,
    developmentPurpose,
  };
}

function buildAccountSpecs(env = process.env) {
  const accounts = [
    {
      email: env.EXCHANGE_DEV_TEST_EMAIL,
      password: env.EXCHANGE_DEV_TEST_PASSWORD,
      role: "member",
      displayName: "Exchange Development Member",
      label: "Member",
      developmentPurpose: "configured_exchange_ordinary_member",
    },
    {
      email: env.EXCHANGE_DEV_ADMIN_EMAIL,
      password: env.EXCHANGE_DEV_ADMIN_PASSWORD,
      role: "admin",
      displayName: "Exchange Development Admin",
      label: "Admin",
      developmentPurpose: "configured_exchange_claim_reviewer",
    },
    optionalAccount(env, "OWNER", "Organization Owner", "configured_exchange_organization_owner"),
    optionalAccount(env, "UNRELATED", "Unrelated Member", "configured_exchange_unrelated_member"),
    optionalAccount(env, "ISSUER", "Issuer Manager", "configured_exchange_issuer_manager"),
  ].filter(Boolean);

  for (const account of accounts) {
    assertDevelopmentAccountEmail(account.email, account.label);
    assertPassword(account.password, account.label);
  }
  const normalizedEmails = accounts.map((account) => account.email.toLowerCase());
  if (new Set(normalizedEmails).size !== normalizedEmails.length) {
    throw new Error("Every configured-development role must use a separate account.");
  }
  return accounts;
}

async function main() {
  const projectId = argument("--project") || process.env.EXCHANGE_DEV_PROJECT_ID || "hi-coworking-plat";
  const apply = hasFlag("--apply");
  const confirmation = argument("--confirm-development");
  assertSafety({ projectId, apply, confirmation });

  const accountSpecs = buildAccountSpecs();

  if (!admin.apps.length) admin.initializeApp({ projectId });
  const auth = admin.auth();
  const db = admin.firestore();

  const report = {
    projectId,
    dryRun: !apply,
    generatedAt: new Date().toISOString(),
    accounts: apply
      ? await Promise.all(accountSpecs.map((account) => applyAccount({ auth, db, ...account })))
      : await Promise.all(accountSpecs.map((account) => planAccount(auth, account.email, account.role))),
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
  buildAccountSpecs,
};
