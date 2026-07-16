import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "demo-hi-coworking";
const NOW = Date.UTC(2026, 6, 13, 16, 0, 0);
const DAY = 24 * 60 * 60 * 1_000;
const DEMO_PASSWORD = "Run3-Demo-Only!";

function requireSafeEmulatorEnvironment() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const configuredProject = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!firestoreHost || !authHost) {
    throw new Error(
      "Refusing to seed without FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST",
    );
  }
  if (configuredProject !== PROJECT_ID) {
    throw new Error(`Refusing to seed project ${configuredProject ?? "(unset)"}; expected ${PROJECT_ID}`);
  }
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(firestoreHost)
      || !/^(?:127\.0\.0\.1|localhost):\d+$/.test(authHost)) {
    throw new Error("Refusing to seed non-local emulator hosts");
  }
}

requireSafeEmulatorEnvironment();

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

const demoUsers = [
  { uid: "demo-referrer", email: "referrer@run3.example.test", displayName: "Avery Morgan", role: "member" },
  { uid: "demo-provider", email: "provider@run3.example.test", displayName: "Jordan Lee", role: "member" },
  { uid: "demo-partner", email: "partner@run3.example.test", displayName: "Sam Rivera", role: "member" },
  { uid: "demo-admin", email: "admin@run3.example.test", displayName: "Run 3 Admin", role: "admin" },
];

for (const user of demoUsers) {
  try {
    await auth.updateUser(user.uid, {
      email: user.email,
      displayName: user.displayName,
      password: DEMO_PASSWORD,
      emailVerified: true,
      disabled: false,
    });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      password: DEMO_PASSWORD,
      emailVerified: true,
    });
  }
  await auth.setCustomUserClaims(user.uid, { role: user.role });
}

const documents = new Map();
const put = (path, value) => documents.set(path, value);

for (const user of demoUsers) {
  put(`users/${user.uid}`, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    membershipStatus: "active",
    createdAt: NOW - 180 * DAY,
    updatedAt: NOW,
  });
}

const organizations = [
  { id: "org-harbor", name: "Harbor Strategy Group", ownerUid: "demo-referrer" },
  { id: "org-tidewater", name: "Tidewater Energy Systems", ownerUid: "demo-provider" },
  { id: "org-catalyst", name: "Catalyst Workforce Partners", ownerUid: "demo-partner" },
];

for (const org of organizations) {
  put(`orgs/${org.id}`, {
    id: org.id,
    name: org.name,
    ownerUid: org.ownerUid,
    status: "active",
    createdAt: NOW - 150 * DAY,
    updatedAt: NOW,
  });
  put(`orgMembers/${org.id}_${org.ownerUid}`, {
    id: `${org.id}_${org.ownerUid}`,
    orgId: org.id,
    uid: org.ownerUid,
    role: "owner",
    joinedAt: NOW - 150 * DAY,
  });
}

const profiles = [
  ["demo-referrer", "Harbor Strategy Group", ["541611", "541690"]],
  ["demo-provider", "Tidewater Energy Systems", ["221114", "541330"]],
  ["demo-partner", "Catalyst Workforce Partners", ["541612", "611430"]],
];
for (const [uid, businessName, naicsCodes] of profiles) {
  put(`profiles/${uid}`, {
    uid,
    businessName,
    naicsCodes,
    published: true,
    verificationStatus: "verified",
    createdAt: NOW - 120 * DAY,
    updatedAt: NOW,
  });
  put(`publicProfiles/${uid}`, {
    uid,
    businessName,
    naicsCodes,
    published: true,
    verificationStatus: "verified",
    verifiedCertifications: [],
    updatedAt: NOW,
  });
}

put("territories/51003", {
  fips: "51003",
  name: "Albemarle County",
  state: "VA",
  status: "released",
  centroid: { latitude: 38.03, longitude: -78.56 },
  releaseDate: NOW - 90 * DAY,
  updatedAt: NOW,
});
put("territories/51700", {
  fips: "51700",
  name: "Newport News",
  state: "VA",
  status: "scheduled",
  centroid: { latitude: 37.09, longitude: -76.47 },
  releaseDate: NOW + 30 * DAY,
  updatedAt: NOW,
});

put("rfx/demo-rfx-energy", {
  id: "demo-rfx-energy",
  title: "Community solar engineering support",
  description: "Design and workforce partners for a regional solar program.",
  ownerUid: "demo-referrer",
  orgId: "org-harbor",
  issuerDisplayName: "Harbor Strategy Group",
  status: "open",
  adminApprovalStatus: "approved",
  memberOnly: false,
  territoryFips: "51003",
  naicsCodes: ["541330", "221114"],
  geo: { lat: 38.03, lng: -78.56, geohash: "dqb0" },
  version: 2,
  responseCount: 2,
  createdAt: NOW - 25 * DAY,
  updatedAt: NOW - DAY,
});

put("rfxTeams/demo-team-energy", {
  id: "demo-team-energy",
  rfxId: "demo-rfx-energy",
  name: "Solar delivery team",
  primeUid: "demo-referrer",
  memberUids: ["demo-referrer", "demo-provider"],
  members: [
    { uid: "demo-referrer", role: "prime" },
    { uid: "demo-provider", role: "sub" },
  ],
  createdAt: NOW - 20 * DAY,
  updatedAt: NOW - 20 * DAY,
});
for (const [uid, role] of [["demo-referrer", "prime"], ["demo-provider", "sub"]]) {
  put(`rfxTeamMemberships/demo-team-energy/members/${uid}`, {
    id: uid,
    uid,
    teamId: "demo-team-energy",
    rfxId: "demo-rfx-energy",
    role,
    createdAt: NOW - 20 * DAY,
    updatedAt: NOW - 20 * DAY,
  });
}

put("referralServiceOffers/demo-energy-offer_v1", {
  id: "demo-energy-offer_v1",
  offerId: "demo-energy-offer",
  schemaVersion: 1,
  version: 1,
  providerOrgId: "org-tidewater",
  serviceName: "Distributed-energy engineering",
  serviceCategory: "Engineering services",
  naicsCodes: ["541330"],
  territoryFips: ["51003", "51700"],
  status: "published",
  acceptingReferrals: true,
  compensationType: "percentage",
  compensationRateBasisPoints: 1000,
  percentageBasis: "first_collected_invoice",
  currency: "USD",
  attributionWindowDays: 90,
  payoutTrigger: "confirmed collected invoice",
  paymentDeadlineDays: 30,
  refundTreatment: "recalculate after confirmed refund",
  includedCharges: ["professional services"],
  excludedCharges: ["tax", "pass-through expenses"],
  effectiveAt: NOW - 60 * DAY,
  publishedAt: NOW - 60 * DAY,
  publishedBy: "demo-provider",
  stateVersion: 1,
  createdBy: "demo-provider",
  createdAt: NOW - 61 * DAY,
  updatedAt: NOW - 60 * DAY,
});
put("referralServiceOffers/demo-workforce-offer_v1", {
  id: "demo-workforce-offer_v1",
  offerId: "demo-workforce-offer",
  schemaVersion: 1,
  version: 1,
  providerOrgId: "org-catalyst",
  serviceName: "Workforce program introduction",
  serviceCategory: "Workforce development",
  naicsCodes: ["541612", "611430"],
  territoryFips: ["51003"],
  status: "published",
  acceptingReferrals: true,
  compensationType: "none",
  currency: "USD",
  attributionWindowDays: 120,
  effectiveAt: NOW - 45 * DAY,
  publishedAt: NOW - 45 * DAY,
  publishedBy: "demo-partner",
  stateVersion: 1,
  createdBy: "demo-partner",
  createdAt: NOW - 46 * DAY,
  updatedAt: NOW - 45 * DAY,
});

put("platformConfiguration/referralCommerce", {
  id: "referralCommerce",
  schemaVersion: 1,
  platformFeeBasisPoints: 100,
  version: 1,
  effectiveAt: NOW - 90 * DAY,
  updatedBy: "demo-admin",
  updatedAt: NOW - 90 * DAY,
  commerceEnabled: true,
  settlementEnabled: false,
  payoutHoldDays: 14,
  manualEvidenceThresholdCents: 100_000,
});

const terms = {
  schemaVersion: 1,
  serviceOfferId: "demo-energy-offer",
  serviceOfferVersionId: "demo-energy-offer_v1",
  serviceOfferVersion: 1,
  compensationType: "percentage",
  compensationRateBasisPoints: 1000,
  percentageBasis: "first_collected_invoice",
  currency: "USD",
  attributionWindowDays: 90,
  payoutTrigger: "confirmed collected invoice",
  paymentDeadlineDays: 30,
  refundTreatment: "recalculate after confirmed refund",
  includedCharges: ["professional services"],
  excludedCharges: ["tax", "pass-through expenses"],
  platformFeeBasisPoints: 100,
  platformFeeConfigVersion: 1,
  acceptedByUid: "demo-provider",
  acceptedByOrgId: "org-tidewater",
  acceptedAt: NOW - 15 * DAY,
  calculationVersion: 1,
};

const referralBase = {
  schemaVersion: 2,
  referrerUid: "demo-referrer",
  referrerOrgId: "org-harbor",
  assignedStaffUids: [],
  referralType: "project_opportunity",
  consentStatus: "confirmed",
  consentConfirmedAt: NOW - 22 * DAY,
  consentConfirmedByUid: "demo-referrer",
  category: "Engineering services",
  naicsCodes: ["541330"],
  territoryFips: "51003",
  relatedRfxId: "demo-rfx-energy",
  relatedTeamId: "demo-team-energy",
  relatedOpportunityId: "demo-rfx-energy",
  createdAt: NOW - 22 * DAY,
  updatedAt: NOW - DAY,
};

put("businessReferrals/demo-referral-compensated", {
  ...referralBase,
  id: "demo-referral-compensated",
  recipientUid: "demo-provider",
  recipientOrgId: "org-tidewater",
  title: "Solar feasibility engineering introduction",
  needSummary: "A municipal customer needs feasibility and interconnection engineering.",
  status: "converted",
  version: 5,
  sentAt: NOW - 21 * DAY,
  acceptedAt: NOW - 15 * DAY,
  inProgressAt: NOW - 12 * DAY,
  convertedAt: NOW - 3 * DAY,
  closedAt: NOW - 3 * DAY,
  serviceOfferId: "demo-energy-offer_v1",
  serviceOfferVersion: 1,
  acceptedTermsSnapshot: terms,
  compensationPolicy: {
    type: "percentage",
    percentageBasisPoints: 1000,
    percentageBasis: "first_collected_invoice",
    currency: "USD",
    status: "agreed",
    lockedAt: NOW - 15 * DAY,
  },
  commerceStatus: "settlement_unavailable",
  latestTransactionReportId: "demo-transaction-confirmed",
  outcome: {
    type: "converted",
    summary: "Customer contracted for the first engineering phase.",
    recordedAt: NOW - 3 * DAY,
    recordedByUid: "demo-provider",
  },
});

put("businessReferrals/demo-referral-noncompensated", {
  ...referralBase,
  id: "demo-referral-noncompensated",
  recipientUid: "demo-partner",
  recipientOrgId: "org-catalyst",
  title: "Workforce training partner introduction",
  needSummary: "Connect the project team with a regional training provider.",
  category: "Workforce development",
  naicsCodes: ["611430"],
  status: "converted",
  version: 4,
  sentAt: NOW - 18 * DAY,
  acceptedAt: NOW - 16 * DAY,
  inProgressAt: NOW - 10 * DAY,
  convertedAt: NOW - 2 * DAY,
  closedAt: NOW - 2 * DAY,
  serviceOfferId: "demo-workforce-offer_v1",
  serviceOfferVersion: 1,
  acceptedTermsSnapshot: {
    schemaVersion: 1,
    serviceOfferId: "demo-workforce-offer",
    serviceOfferVersionId: "demo-workforce-offer_v1",
    serviceOfferVersion: 1,
    compensationType: "none",
    currency: "USD",
    attributionWindowDays: 120,
    platformFeeBasisPoints: 100,
    platformFeeConfigVersion: 1,
    acceptedByUid: "demo-partner",
    acceptedByOrgId: "org-catalyst",
    acceptedAt: NOW - 16 * DAY,
    calculationVersion: 1,
  },
  compensationPolicy: { type: "none", status: "none" },
  commerceStatus: "none",
  outcome: {
    type: "converted",
    recordedAt: NOW - 2 * DAY,
    recordedByUid: "demo-partner",
  },
});

for (const [id, status, recipientUid, recipientOrgId, title, daysAgo] of [
  ["demo-referral-draft", "draft", "demo-provider", "org-tidewater", "Battery storage design referral", 1],
  ["demo-referral-sent", "sent", "demo-partner", "org-catalyst", "Construction workforce referral", 4],
  ["demo-referral-active", "in_progress", "demo-provider", "org-tidewater", "Energy audit introduction", 8],
  ["demo-referral-disputed", "converted", "demo-provider", "org-tidewater", "Controls engineering introduction", 28],
]) {
  put(`businessReferrals/${id}`, {
    ...referralBase,
    id,
    recipientUid,
    recipientOrgId,
    title,
    needSummary: "Synthetic Run 3 review scenario.",
    status,
    version: status === "draft" ? 0 : status === "sent" ? 1 : 3,
    compensationPolicy: { type: "none", status: "none" },
    commerceStatus: id === "demo-referral-disputed" ? "disputed" : "none",
    activeDisputeId: id === "demo-referral-disputed" ? "demo-dispute" : undefined,
    createdAt: NOW - Number(daysAgo) * DAY,
    updatedAt: NOW - DAY,
  });
}

put("referralTransactionReports/demo-transaction-confirmed", {
  id: "demo-transaction-confirmed",
  schemaVersion: 1,
  referralId: "demo-referral-compensated",
  reportedByUid: "demo-provider",
  reportedByOrgId: "org-tidewater",
  status: "settlement_unavailable",
  contractReference: "DEMO-INVOICE-1001",
  qualifyingTransactionCents: 1_000_000,
  collectedTransactionCents: 1_000_000,
  currency: "USD",
  collectionDate: NOW - 4 * DAY,
  evidenceStoragePaths: [],
  refundStatus: "none",
  referrerDecision: "confirmed",
  confirmedByUid: "demo-referrer",
  confirmedAt: NOW - 2 * DAY,
  financials: {
    qualifyingTransactionCents: 1_000_000,
    collectedTransactionCents: 1_000_000,
    compensationBasisCents: 1_000_000,
    grossReferralPayoutCents: 100_000,
    platformFeeBasisPointsSnapshot: 100,
    platformFeeCents: 1_000,
    netReferrerPayoutCents: 99_000,
    currency: "USD",
    calculationVersion: 1,
    calculationStatus: "calculated",
  },
  version: 2,
  createdAt: NOW - 4 * DAY,
  updatedAt: NOW - 2 * DAY,
});

const timeline = [
  [0, "draft_created", "demo-referrer", NOW - 22 * DAY],
  [1, "referral_sent", "demo-referrer", NOW - 21 * DAY],
  [2, "recipient_accepted", "demo-provider", NOW - 15 * DAY],
  [2, "terms_snapshot_locked", "demo-provider", NOW - 15 * DAY + 1],
  [3, "progress_changed", "demo-provider", NOW - 12 * DAY],
  [4, "referral_converted", "demo-provider", NOW - 3 * DAY],
  [5, "transaction_reported", "demo-provider", NOW - 4 * DAY],
  [6, "transaction_confirmed", "demo-referrer", NOW - 2 * DAY],
  [6, "calculation_completed", "system", NOW - 2 * DAY + 1],
];
for (const [version, eventType, actorUid, occurredAt] of timeline) {
  const id = `demo-referral-compensated_${version}_${eventType}`;
  put(`businessReferralTimeline/${id}`, {
    id,
    referralId: "demo-referral-compensated",
    eventType,
    actorUid,
    actorRole: actorUid === "system" ? "system" : "member",
    referralVersion: version,
    occurredAt,
  });
}

put("referralRelationshipInsights/org-harbor__org-tidewater", {
  id: "org-harbor__org-tidewater",
  subjectAKey: "org:org-harbor",
  subjectBKey: "org:org-tidewater",
  participantSubjectKeys: ["org:org-harbor", "org:org-tidewater"],
  state: "trusted",
  factors: {
    acceptedReferrals: 12,
    confirmedConversions: 8,
    medianResponseHours: 19,
    disputes: 1,
    reversals: 0,
    relationshipDays: 310,
  },
  sampleSize: 12,
  algorithmVersion: 1,
  sourceWatermark: "demo-run3-v1",
  updatedAt: NOW,
});

put("referralAnalyticsSnapshots/demo-org-network", {
  id: "demo-org-network",
  kind: "network",
  scopeType: "organization",
  scopeId: "org-harbor",
  windowStart: NOW - 365 * DAY,
  windowEnd: NOW,
  dimensions: {},
  measures: {
    referralsSent: 24,
    referralsReceived: 11,
    accepted: 26,
    converted: 17,
    uniquePartners: 9,
    trustedRelationships: 2,
  },
  sampleSize: 35,
  distinctOrganizationCount: 10,
  privacyStatus: "own_exact",
  algorithmVersion: 1,
  sourceWatermark: "demo-run3-v1",
  generatedAt: NOW,
});
put("referralAnalyticsSnapshots/demo-org-economic", {
  id: "demo-org-economic",
  kind: "economic_impact",
  scopeType: "organization",
  scopeId: "org-harbor",
  windowStart: NOW - 365 * DAY,
  windowEnd: NOW,
  dimensions: {},
  measures: { businessesConnected: 10, newRelationships: 4, linkedRfx: 6, linkedTeams: 3 },
  currencyMeasures: {
    USD: {
      reportedTransactionCents: 4_800_000,
      confirmedTransactionCents: 3_250_000,
      grossReferralPayoutCents: 275_000,
      platformFeeCents: 2_750,
      netReferrerPayoutCents: 272_250,
    },
  },
  sampleSize: 17,
  distinctOrganizationCount: 10,
  privacyStatus: "own_exact",
  algorithmVersion: 1,
  sourceWatermark: "demo-run3-v1",
  generatedAt: NOW,
});
for (const [id, dimension, measures] of [
  ["demo-gap-industry", { naicsCode: "541330", category: "Engineering services" }, { demand: 18, activeRecipients: 4, unanswered: 7, acceptanceRateBasisPoints: 6111 }],
  ["demo-gap-territory", { territoryFips: "51700" }, { demand: 13, activeRecipients: 2, unanswered: 8, acceptanceRateBasisPoints: 3846 }],
]) {
  put(`referralAnalyticsSnapshots/${id}`, {
    id,
    kind: "gap",
    scopeType: "platform",
    scopeId: "platform",
    windowStart: NOW - 90 * DAY,
    windowEnd: NOW,
    dimensions: dimension,
    measures,
    sampleSize: 13,
    distinctOrganizationCount: 7,
    privacyStatus: "publishable",
    algorithmVersion: 1,
    sourceWatermark: "demo-run3-v1",
    generatedAt: NOW,
  });
}
put("referralAnalyticsSnapshots/demo-reciprocity", {
  id: "demo-reciprocity",
  kind: "reciprocity",
  scopeType: "organization",
  scopeId: "org-harbor",
  windowStart: NOW - 365 * DAY,
  windowEnd: NOW,
  dimensions: {},
  measures: { bidirectionalPairs: 3, concentratedPairShareBasisPoints: 4100 },
  classifications: ["normal_reciprocity", "concentrated_pair"],
  sampleSize: 24,
  distinctOrganizationCount: 9,
  privacyStatus: "own_exact",
  algorithmVersion: 1,
  sourceWatermark: "demo-run3-v1",
  generatedAt: NOW,
});

const entries = [...documents.entries()];
for (let offset = 0; offset < entries.length; offset += 400) {
  const batch = db.batch();
  for (const [path, data] of entries.slice(offset, offset + 400)) {
    const sanitized = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    batch.set(db.doc(path), sanitized);
  }
  await batch.commit();
}

console.log(JSON.stringify({
  projectId: PROJECT_ID,
  authUsers: demoUsers.map(({ uid, email }) => ({ uid, email })),
  firestoreDocuments: documents.size,
  syntheticOnly: true,
  settlementEnabled: false,
}, null, 2));
