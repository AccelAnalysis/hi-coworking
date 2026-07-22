#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");

const CONFIGURED_DEVELOPMENT_PROJECT = "hi-coworking-plat";
const REVIEW_PACKET_VERSION = 1;
const PROJECTION_VERSION = 1;
const SEED_PACKAGE_VERSION = 2;
const DEFAULT_SAMPLE_LIMIT = 100;

const PRIVACY_CLASSIFICATIONS = Object.freeze({
  PUBLIC: "public_business",
  SUPPRESSED_HOME: "suppressed_home_business",
  RESTRICTED: "restricted_match_only",
});

// This is a conservative validation envelope for the configured Isle of Wight
// market, not a substitute for authoritative boundary geometry. Coordinates
// outside the envelope stay list-only until a reviewer resolves the source.
const MARKET_COORDINATE_BOUNDS = Object.freeze({
  "51093": Object.freeze({
    minimumLatitude: 36.64,
    maximumLatitude: 37.22,
    minimumLongitude: -77.02,
    maximumLongitude: -76.43,
  }),
});

const REVIEW_METADATA_KEYS = new Set([
  "addressPublicationApproved",
  "approvedExportVersion",
  "coordinatePublicationApproved",
  "privacyClassification",
  "projectionVersion",
  "reviewCandidateHash",
  "reviewIssues",
  "reviewPacketVersion",
  "reviewStatus",
  "reviewedAt",
  "reviewedBy",
  "seedPackageVersion",
  "organizationDecision",
  "establishmentDecisions",
  "contactDecisions",
  "communicationRouteDecisions",
  "establishments",
  "contactPoints",
  "communicationRoutes",
  "seedPackageHash",
  "sourceProvenance",
]);

class SeedLifecycleError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "SeedLifecycleError";
    this.report = report;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function loadJsonLines(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new SeedLifecycleError(`${file}:${index + 1}: invalid JSON: ${error.message}`, {
        file,
        line: index + 1,
      });
    }
  });
}

function candidatePayload(reviewRow) {
  return Object.fromEntries(
    Object.entries(reviewRow).filter(([key]) => !REVIEW_METADATA_KEYS.has(key)),
  );
}

function privacyClassificationFor(row, restricted = false) {
  if (restricted || row.restrictedMatchOnly === true) return PRIVACY_CLASSIFICATIONS.RESTRICTED;
  if (row.homeBased === true || row.privacySuppressed === true) {
    return PRIVACY_CLASSIFICATIONS.SUPPRESSED_HOME;
  }
  return PRIVACY_CLASSIFICATIONS.PUBLIC;
}

function sourceProvenanceFor(row) {
  return [...new Set(Array.isArray(row.sources) ? row.sources.filter((source) => typeof source === "string" && source.trim()) : [])]
    .sort()
    .map((source) => ({ source }));
}

function coordinateIssues(row) {
  const issues = [];
  const hasLatitude = Object.hasOwn(row, "latitude") && row.latitude !== null;
  const hasLongitude = Object.hasOwn(row, "longitude") && row.longitude !== null;
  if (hasLatitude !== hasLongitude) {
    return ["latitude and longitude must either both be present or both be absent"];
  }
  if (!hasLatitude) return issues;
  if (
    typeof row.latitude !== "number"
    || !Number.isFinite(row.latitude)
    || row.latitude < -90
    || row.latitude > 90
    || typeof row.longitude !== "number"
    || !Number.isFinite(row.longitude)
    || row.longitude < -180
    || row.longitude > 180
  ) {
    return ["coordinates must be finite, globally valid latitude/longitude values"];
  }
  if (row.latitude === 0 && row.longitude === 0) {
    issues.push("zero/zero is a missing-coordinate sentinel, not a publishable location");
  }
  const bounds = MARKET_COORDINATE_BOUNDS[String(row.territoryFips || "")];
  if (bounds && (
    row.latitude < bounds.minimumLatitude
    || row.latitude > bounds.maximumLatitude
    || row.longitude < bounds.minimumLongitude
    || row.longitude > bounds.maximumLongitude
  )) {
    issues.push(`coordinates are outside the configured validation envelope for FIPS ${row.territoryFips}`);
  }
  return issues;
}

function baseCandidateIssues(row, restricted = false) {
  const issues = [];
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["row must be an object"];
  if (typeof row.id !== "string" || !row.id.trim()) issues.push("id is required");
  if (typeof row.name !== "string" || !row.name.trim()) issues.push("name is required");
  if (typeof row.normalizedName !== "string" || !row.normalizedName.trim()) {
    issues.push("normalizedName is required");
  }
  if (!Array.isArray(row.sources) || !row.sources.length || row.sources.some((source) => typeof source !== "string" || !source.trim())) {
    issues.push("sources must be a non-empty string array");
  }

  const forbiddenRestrictedKeys = [
    "email", "phone", "publicPhone", "address", "addressLine1", "street", "postalCode",
    "birthDate", "age", "militaryStatus", "contactName", "race", "gender",
    "otherRace", "otherGender", "latitude", "longitude", "geohash",
  ];
  const forbiddenSuppressedKeys = [
    "address", "addressLine1", "postalCode", "publicPhone", "latitude", "longitude", "geohash",
  ];
  if (!restricted && row.restrictedMatchOnly === true) {
    issues.push("restricted matching rows cannot enter the public organization import");
  }
  if (restricted || row.restrictedMatchOnly === true) {
    if (row.restrictedMatchOnly !== true || row.privacySuppressed !== true) {
      issues.push("restricted matching rows require restrictedMatchOnly and privacySuppressed");
    }
    if (forbiddenRestrictedKeys.some((key) => Object.hasOwn(row, key))) {
      issues.push("restricted matching row contains prohibited personal, demographic, contact, or precise-location fields");
    }
  } else if ((row.homeBased === true || row.privacySuppressed === true)
      && forbiddenSuppressedKeys.some((key) => Object.hasOwn(row, key))) {
    issues.push("privacy-suppressed organization contains a precise address or location field");
  }
  if (!restricted) issues.push(...coordinateIssues(row));
  return issues;
}

function reviewMetadataIssues(row, { restricted = false, requireApproved = true } = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["review row must be an object"];
  const issues = [];
  const expectedPrivacy = privacyClassificationFor(row, restricted);
  if (row.reviewPacketVersion !== REVIEW_PACKET_VERSION) {
    issues.push(`reviewPacketVersion must be ${REVIEW_PACKET_VERSION}`);
  }
  if (row.projectionVersion !== PROJECTION_VERSION) {
    issues.push(`projectionVersion must be ${PROJECTION_VERSION}`);
  }
  if (row.privacyClassification !== expectedPrivacy) {
    issues.push(`privacyClassification must be ${expectedPrivacy}`);
  }
  if (!["pending", "approved", "rejected"].includes(row.reviewStatus)) {
    issues.push("reviewStatus must be pending, approved, or rejected");
  }
  if (row.seedPackageVersion !== SEED_PACKAGE_VERSION) {
    issues.push(`seedPackageVersion must be ${SEED_PACKAGE_VERSION}`);
  }
  const organizationDecisions = [
    "approve_organization", "reject", "defer", "restricted_matching_only",
    "duplicate_survivor", "link_existing",
  ];
  if (!organizationDecisions.includes(row.organizationDecision)) {
    issues.push("organizationDecision is invalid");
  }
  if (!Array.isArray(row.establishmentDecisions)
      || !Array.isArray(row.contactDecisions)
      || !Array.isArray(row.communicationRouteDecisions)) {
    issues.push("establishment, contact, and communication-route decisions must be arrays");
  }
  if (row.reviewStatus === "approved") {
    const permittedOrganizationDecision = restricted
      ? row.organizationDecision === "restricted_matching_only"
      : row.organizationDecision === "approve_organization";
    if (!permittedOrganizationDecision) issues.push("approved review requires an approving organization decision");
    if ((row.establishmentDecisions || []).some((decision) => decision.decision === "defer_location")) {
      issues.push("approved package cannot contain deferred establishment decisions");
    }
    if ((row.contactDecisions || []).some((decision) => decision.decision === "defer")) {
      issues.push("approved package cannot contain deferred contact decisions");
    }
    if ((row.communicationRouteDecisions || []).some((decision) => decision.decision === "defer")) {
      issues.push("approved package cannot contain deferred route decisions");
    }
  }
  if (typeof row.reviewedBy !== "string") issues.push("reviewedBy must be present as a string");
  if (row.reviewedAt !== null && (!Number.isSafeInteger(row.reviewedAt) || row.reviewedAt <= 0)) {
    issues.push("reviewedAt must be null or a positive epoch-millisecond integer");
  }
  if (typeof row.coordinatePublicationApproved !== "boolean") {
    issues.push("coordinatePublicationApproved must be explicitly true or false");
  }
  if (typeof row.addressPublicationApproved !== "boolean") {
    issues.push("addressPublicationApproved must be explicitly true or false");
  }
  if (!Array.isArray(row.sourceProvenance) || !row.sourceProvenance.length
      || row.sourceProvenance.some((item) => (
        !item
        || typeof item !== "object"
        || Array.isArray(item)
        || Object.keys(item).length !== 1
        || typeof item.source !== "string"
        || !item.source.trim()
      ))) {
    issues.push("sourceProvenance must be a non-empty array of source records");
  } else {
    const expectedSources = sourceProvenanceFor(row).map((item) => item.source);
    const actualSources = [...new Set(row.sourceProvenance.map((item) => item.source))].sort();
    if (stableJson(actualSources) !== stableJson(expectedSources)) {
      issues.push("sourceProvenance must exactly represent the candidate sources");
    }
  }
  if (typeof row.reviewCandidateHash !== "string" || row.reviewCandidateHash !== contentHash(candidatePayload(row))) {
    issues.push("reviewCandidateHash does not match the immutable candidate payload");
  }

  const hasCoordinates = Object.hasOwn(row, "latitude") && row.latitude !== null
    && Object.hasOwn(row, "longitude") && row.longitude !== null;
  if (!hasCoordinates && row.coordinatePublicationApproved !== false) {
    issues.push("coordinatePublicationApproved must remain false when no coordinates are present");
  }
  const hasAddress = ["address", "addressLine1", "postalCode"]
    .some((key) => typeof row[key] === "string" && row[key].trim());
  if (!hasAddress && row.addressPublicationApproved !== false) {
    issues.push("addressPublicationApproved must remain false when no address is present");
  }
  if (requireApproved || row.reviewStatus === "approved" || row.reviewStatus === "rejected") {
    if (row.reviewStatus !== "approved" && requireApproved) issues.push("reviewStatus must be approved");
    if (typeof row.reviewedBy !== "string" || !row.reviewedBy.trim()) {
      issues.push("approved or rejected rows require reviewedBy");
    }
    if (!Number.isSafeInteger(row.reviewedAt) || row.reviewedAt <= 0) {
      issues.push("approved or rejected rows require reviewedAt");
    }
  }
  return issues;
}

function validateReviewRow(row, options = {}) {
  return [
    ...baseCandidateIssues(row, options.restricted === true),
    ...reviewMetadataIssues(row, options),
  ];
}

function proposedEstablishmentDecision(candidate) {
  const addressLine1 = typeof (candidate.addressLine1 || candidate.address) === "string"
    ? (candidate.addressLine1 || candidate.address).trim() : "";
  if (!addressLine1 || !candidate.city || !candidate.state) return [];
  const privateHome = candidate.homeBased === true || candidate.privacySuppressed === true;
  return [{
    proposalId: `${candidate.id}:establishment:0`,
    decision: "defer_location",
    classification: privateHome ? "private_home" : "unresolved",
    isHeadquarters: false,
    isPrimary: false,
    addressPublicationApproved: false,
    coordinatePublicationApproved: false,
    proposal: {
      name: `${candidate.name} proposed location`,
      locationType: privateHome ? "other" : "headquarters",
      physicalAddress: {
        line1: addressLine1,
        ...(candidate.addressLine2 ? { line2: candidate.addressLine2 } : {}),
        locality: candidate.city,
        administrativeArea: candidate.state,
        ...(candidate.postalCode ? { postalCode: candidate.postalCode } : {}),
        countryCode: candidate.countryCode || "US",
        ...(candidate.county ? { county: candidate.county } : {}),
      },
      ...(typeof candidate.latitude === "number" && typeof candidate.longitude === "number"
        ? { coordinates: { latitude: candidate.latitude, longitude: candidate.longitude } } : {}),
    },
  }];
}

function proposedContactDecisions(candidate) {
  return [["email", candidate.email], ["phone", candidate.publicPhone || candidate.phone]]
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([type, value], index) => ({
      proposalId: `${candidate.id}:contact:${index}`,
      decision: "defer",
      purpose: "general",
      visibility: "private_operational",
      proposal: { type, value },
    }));
}

function createReviewPacket(rows, { restricted = false } = {}) {
  const seen = new Set();
  const duplicateIds = [];
  const packetRows = rows.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new SeedLifecycleError("Review packet generation requires object candidates.", {
        line: index + 1,
      });
    }
    if (seen.has(candidate.id)) duplicateIds.push(candidate.id || `line:${index + 1}`);
    seen.add(candidate.id);
    const payload = candidatePayload(candidate);
    const issues = baseCandidateIssues(payload, restricted);
    return {
      ...payload,
      reviewPacketVersion: REVIEW_PACKET_VERSION,
      reviewCandidateHash: contentHash(payload),
      reviewStatus: "pending",
      reviewedBy: "",
      reviewedAt: null,
      privacyClassification: privacyClassificationFor(payload, restricted),
      sourceProvenance: sourceProvenanceFor(payload),
      projectionVersion: PROJECTION_VERSION,
      coordinatePublicationApproved: false,
      addressPublicationApproved: false,
      seedPackageVersion: SEED_PACKAGE_VERSION,
      organizationDecision: restricted ? "restricted_matching_only" : "defer",
      establishmentDecisions: restricted ? [] : proposedEstablishmentDecision(payload),
      contactDecisions: restricted ? [] : proposedContactDecisions(payload),
      communicationRouteDecisions: [],
      reviewIssues: issues,
    };
  });
  if (duplicateIds.length) {
    throw new SeedLifecycleError("Review packet generation refused duplicate candidate IDs.", {
      duplicateIds,
    });
  }
  return {
    rows: packetRows,
    report: {
      candidates: packetRows.length,
      pendingHumanReview: packetRows.length,
      candidatesWithPreparationIssues: packetRows.filter((row) => row.reviewIssues.length > 0).length,
      coordinateCandidates: packetRows.filter((row) => Object.hasOwn(row, "latitude") && Object.hasOwn(row, "longitude")).length,
      addressPublicationApproved: 0,
      coordinatePublicationApproved: 0,
      humanApproved: 0,
      restricted,
    },
  };
}

function approvedPackageRecords(row) {
  const establishments = (row.establishmentDecisions || []).flatMap((decision) => {
    if (!["approve_establishment", "list_only", "mailing_only", "private_home"].includes(decision.decision)) return [];
    const proposal = decision.proposal || {};
    const coordinates = proposal.coordinates;
    const publishCoordinates = decision.coordinatePublicationApproved === true
      && decision.decision === "approve_establishment"
      && coordinates && Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude);
    const privateHome = decision.decision === "private_home";
    const id = decision.establishmentId || contentHash(decision.proposalId).slice(0, 28);
    return [{
      id: `seedloc_${id}`,
      organizationId: row.id,
      name: proposal.name || `${row.name} location`,
      locationType: decision.decision === "mailing_only" ? "mailing_only" : proposal.locationType || "other",
      isHeadquarters: decision.isHeadquarters === true,
      isPrimary: decision.isPrimary === true,
      status: "active",
      ...(proposal.physicalAddress ? { physicalAddress: proposal.physicalAddress } : {}),
      addressPublicationApproved: !privateHome && decision.addressPublicationApproved === true,
      coordinatePublicationApproved: !privateHome && publishCoordinates,
      ...(coordinates ? { geocode: {
        provider: proposal.geocodeProvider || "seed_review",
        normalizedAddress: proposal.normalizedAddress || Object.values(proposal.physicalAddress || {}).filter(Boolean).join(", "),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        precision: proposal.precision || "unknown",
        confidence: proposal.confidence || "unknown",
        source: "seed_reviewed",
        geocodedAt: row.reviewedAt,
        confirmedByUid: row.reviewedBy,
        confirmedAt: row.reviewedAt,
      } } : {}),
      serviceArea: proposal.serviceArea || {},
      publicContactAvailable: false,
      privateHome,
      createdBy: row.reviewedBy,
      createdAt: row.reviewedAt,
      updatedAt: row.reviewedAt,
      version: 1,
      recordVersion: 1,
      seedProposalId: decision.proposalId,
    }];
  });
  const contactPoints = (row.contactDecisions || []).flatMap((decision) => {
    if (!["approve_private_operational", "approve_public"].includes(decision.decision)) return [];
    const proposal = decision.proposal || {};
    return [{
      id: `seedcontact_${contentHash(decision.proposalId).slice(0, 28)}`,
      organizationId: row.id,
      ...(decision.locationId ? { locationId: decision.locationId } : {}),
      type: proposal.type,
      purposes: [decision.purpose || "general"],
      normalizedValue: String(proposal.value || "").trim().toLowerCase(),
      displayValue: String(proposal.value || "").trim(),
      verificationStatus: "unverified",
      visibility: decision.decision === "approve_public" ? "public" : "private_operational",
      publicationStatus: decision.decision === "approve_public" ? "approved" : "draft",
      consentAuthorityBasis: "human_seed_review",
      status: "active",
      createdBy: row.reviewedBy,
      createdAt: row.reviewedAt,
      updatedAt: row.reviewedAt,
      version: 1,
      recordVersion: 1,
      seedProposalId: decision.proposalId,
    }];
  });
  const communicationRoutes = (row.communicationRouteDecisions || []).flatMap((decision) => (
    decision.decision === "approve" ? [{
      id: decision.routeId || `seedroute_${contentHash(decision.proposalId).slice(0, 28)}`,
      organizationId: row.id,
      ...(decision.locationId ? { locationId: decision.locationId } : {}),
      purpose: decision.purpose,
      primaryContactPointIds: decision.primaryContactPointIds || [],
      fallbackContactPointIds: decision.fallbackContactPointIds || [],
      fallbackMemberRoles: decision.fallbackMemberRoles || ["owner", "admin"],
      inAppEnabled: decision.inAppEnabled !== false,
      emailEnabled: decision.emailEnabled === true,
      phoneEnabled: decision.phoneEnabled === true,
      status: "active",
      createdBy: row.reviewedBy,
      createdAt: row.reviewedAt,
      updatedAt: row.reviewedAt,
      version: 1,
      recordVersion: 1,
      seedProposalId: decision.proposalId,
    }] : []
  ));
  return { establishments, contactPoints, communicationRoutes };
}

function exportApprovedRows(rows, {
  restricted = false,
  limit = DEFAULT_SAMPLE_LIMIT,
  maximumLimit = DEFAULT_SAMPLE_LIMIT,
} = {}) {
  if (!Number.isSafeInteger(maximumLimit) || maximumLimit < 1 || maximumLimit > 10_000) {
    throw new SeedLifecycleError("Approved export maximumLimit must be between 1 and 10000.", {
      maximumLimit,
    });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new SeedLifecycleError(`Approved export limit must be between 1 and ${maximumLimit}.`, {
      limit,
      maximumLimit,
    });
  }
  const seen = new Set();
  const duplicateIds = [];
  const invalidApproved = [];
  const approved = [];
  for (const [index, row] of rows.entries()) {
    const rowId = row && typeof row === "object" ? row.id : undefined;
    if (seen.has(rowId)) duplicateIds.push(rowId || `line:${index + 1}`);
    seen.add(rowId);
    if (!row || typeof row !== "object" || row.reviewStatus !== "approved") continue;
    const issues = validateReviewRow(row, { restricted, requireApproved: true });
    if (issues.length) {
      invalidApproved.push({ line: index + 1, id: row.id || null, issues });
      continue;
    }
    const packageRecords = approvedPackageRecords(row);
    const cleaned = {
      ...row,
      approvedExportVersion: 2,
      seedPackageVersion: SEED_PACKAGE_VERSION,
      ...packageRecords,
      seedPackageHash: contentHash({ organizationId: row.id, ...packageRecords }),
    };
    delete cleaned.reviewIssues;
    approved.push(cleaned);
  }
  const report = {
    inputRows: rows.length,
    pending: rows.filter((row) => row && typeof row === "object" && row.reviewStatus === "pending").length,
    rejected: rows.filter((row) => row && typeof row === "object" && row.reviewStatus === "rejected").length,
    approved: rows.filter((row) => row && typeof row === "object" && row.reviewStatus === "approved").length,
    validApproved: approved.length,
    invalidApproved,
    duplicateIds,
    sampleLimit: limit,
    exported: Math.min(approved.length, limit),
    exportedWithAddressPublicationApproved: approved.slice(0, limit)
      .filter((row) => row.addressPublicationApproved === true).length,
    exportedWithCoordinatePublicationApproved: approved.slice(0, limit)
      .filter((row) => row.coordinatePublicationApproved === true).length,
    truncated: approved.length > limit,
    restricted,
  };
  if (duplicateIds.length || invalidApproved.length) {
    throw new SeedLifecycleError("Approved export validation failed.", report);
  }
  if (!approved.length) {
    throw new SeedLifecycleError("Human-review gate remains closed: no valid approved rows exist.", report);
  }
  return { rows: approved.slice(0, limit), report };
}

function assertDevelopmentExpansionGate(gate, projectId) {
  const requiredChecks = [
    "sampleAccepted",
    "replayNoOp",
    "rollbackRehearsalPassed",
    "browserAccepted",
    "markerBehaviorAccepted",
    "publicProjectionAccepted",
    "privacyAccepted",
    "zeroUnauthorizedFields",
  ];
  const missingChecks = requiredChecks.filter((key) => gate?.[key] !== true);
  const metadataErrors = [];
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    metadataErrors.push("gate must be an object");
  }
  if (gate?.sampleGateVersion !== 1) metadataErrors.push("sampleGateVersion must be 1");
  if (gate?.environment !== "development") metadataErrors.push("environment must be development");
  if (typeof gate?.sampleBatchId !== "string" || !gate.sampleBatchId.trim()) {
    metadataErrors.push("sampleBatchId is required");
  }
  if (!Number.isSafeInteger(gate?.sampleRecordCount)
      || gate.sampleRecordCount < 1
      || gate.sampleRecordCount > DEFAULT_SAMPLE_LIMIT) {
    metadataErrors.push(`sampleRecordCount must be between 1 and ${DEFAULT_SAMPLE_LIMIT}`);
  }
  if (typeof gate?.acceptedBy !== "string" || !gate.acceptedBy.trim()) {
    metadataErrors.push("acceptedBy is required");
  }
  if (!Number.isSafeInteger(gate?.acceptedAt) || gate.acceptedAt <= 0) {
    metadataErrors.push("acceptedAt must be a positive epoch-millisecond integer");
  }
  if (projectId !== CONFIGURED_DEVELOPMENT_PROJECT || gate?.projectId !== projectId
      || missingChecks.length || metadataErrors.length) {
    throw new SeedLifecycleError("Full development expansion gate is incomplete.", {
      expectedProject: CONFIGURED_DEVELOPMENT_PROJECT,
      requestedProject: projectId,
      manifestProject: gate?.projectId,
      missingChecks,
      metadataErrors,
    });
  }
}

function assertConfiguredDevelopmentProject(projectId, environment = "development") {
  if (environment === "emulator") {
    if (!String(projectId || "").startsWith("demo-")) {
      throw new SeedLifecycleError("Emulator seed operations require a demo-* project.", { projectId, environment });
    }
    return;
  }
  if (environment !== "development") {
    throw new SeedLifecycleError("Production seed operations are not authorized by this workflow.", {
      projectId,
      environment,
    });
  }
  if (projectId !== CONFIGURED_DEVELOPMENT_PROJECT) {
    throw new SeedLifecycleError(`Development seed operations require exact project ${CONFIGURED_DEVELOPMENT_PROJECT}.`, {
      projectId,
      environment,
    });
  }
}

module.exports = {
  CONFIGURED_DEVELOPMENT_PROJECT,
  DEFAULT_SAMPLE_LIMIT,
  MARKET_COORDINATE_BOUNDS,
  PRIVACY_CLASSIFICATIONS,
  PROJECTION_VERSION,
  SEED_PACKAGE_VERSION,
  REVIEW_PACKET_VERSION,
  SeedLifecycleError,
  assertDevelopmentExpansionGate,
  assertConfiguredDevelopmentProject,
  baseCandidateIssues,
  candidatePayload,
  contentHash,
  coordinateIssues,
  createReviewPacket,
  exportApprovedRows,
  approvedPackageRecords,
  loadJsonLines,
  privacyClassificationFor,
  reviewMetadataIssues,
  sourceProvenanceFor,
  stableJson,
  validateReviewRow,
};
