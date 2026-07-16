# Run 3 referral security and privacy

Status: implemented access boundary and unresolved production controls  
Recorded: 2026-07-13  
Production deployment, migration, or secret change: **not performed**

## Security invariants

Run 3 preserves the Run 1 default-deny model:

1. Authentication is required for every business-referral and intelligence
   callable.
2. A client-supplied organization ID, UID, role, lifecycle state, calculation,
   relationship state, or score is never authority.
3. Current authority is re-read from canonical records inside or immediately
   before the protected operation.
4. Lifecycle, contact disclosure, offer, terms snapshot, fee snapshot,
   transaction, calculation, confirmation, timeline, relationship, risk, and
   aggregate writes are server authoritative.
5. Callable responses are allowlisted projections because Admin SDK reads are
   not constrained by Firestore rules.
6. Platform invitations and business referrals remain separate security and
   analytics domains.

## Referral read authority

A full business referral is available only to:

- its individual referrer when the side is not represented by an organization;
- a current member of the referring organization;
- its individual recipient when the side is not represented by an organization;
- a current member of the recipient organization;
- explicitly assigned staff; or
- admin/master.

When an organization side exists, current canonical organization membership
controls that side and historical participant UID does not preserve access
after removal. Organization management actions—creating on behalf of the
referrer organization, managing offers, accepting compensated terms, reporting
or confirming financial facts—require current owner/admin membership in an
active organization.

List, detail, timeline, transaction, and intelligence callables repeat these
checks. Firestore rules do not substitute for server checks, and the Admin SDK
does not turn a bounded callable into a broad read entitlement.

## Direct Firestore boundary

Clients cannot directly write `businessReferrals`,
`businessReferralContacts`, `businessReferralDisputes`, service offers,
transaction reports, timeline events, analytics, relationship state, risk
signals, duplicate fingerprints, or platform commerce configuration.

The Run 3 collections below deny both direct reads and direct writes; approved
access is through authenticated, bounded, allowlisted callables:

- `referralServiceOffers`;
- `referralTransactionReports`;
- `businessReferralTimeline`;
- `referralRelationshipInsights`;
- `referralAnalyticsSnapshots`;
- `referralRiskSignals`;
- `referralDuplicateFingerprints`; and
- `platformConfiguration`.

The primary `businessReferrals` rules still allow only a current party,
assigned staff, or admin to read. `businessReferralContacts` has the stricter
contact-disclosure rule described below.

## Mutation controls

Strict Zod parsing rejects unknown or malformed fields. High-risk offer,
configuration, report, and review mutations bind an idempotency key to the
caller, action, and canonical request fingerprint. Reuse for different input
fails. Expected versions prevent stale offer, referral, report, or configuration
decisions. The protected record, idempotency result, timeline event, and audit
record are written atomically where the workflow requires them.

Server checks also enforce current entity state:

- a referral cannot target the caller or the same organization;
- a linked RFx must be approved/open or currently manageable;
- a linked team requires canonical current member guards;
- a service offer must be the recipient's effective published accepting
  version;
- acceptance re-reads that offer and the current prospective fee configuration;
- transaction reporting requires an immutable terms snapshot and recipient
  finance authority;
- transaction review requires referrer finance authority; and
- active disputes block incompatible lifecycle or commerce changes.

Every new calculation, accepted snapshot, score, relationship classification,
timeline event, transaction decision, and aggregate is generated on the server.
No client may directly claim trust, a conversion time, a fee, a payout, or a
confirmed transaction.

## Contact PII and consent

The minimized referral record may contain a party type and company name, but
third-party name, email, and telephone are stored in the same-ID protected
`businessReferralContacts` document. The referrer and assigned staff/admin may
read it. A recipient may read it only while
`recipientDisclosureAllowed == true`, which follows the consent workflow.
Consent withdrawal removes disclosure authority; it does not rely on the UI to
hide an otherwise readable document.

General referral lists, recipient suggestions, relationship records, timeline
events, and analytics must not include:

- customer name, email, or telephone;
- evidence URL, path, or contents;
- contract or invoice detail;
- notes or review narratives; or
- dispute narratives.

The detail callable returns an allowlisted referral and a sanitized transaction
projection. Transaction `reviewNote` and evidence paths remain private workflow
data. Timeline metadata may carry an evidence count, currency, status, or
calculation version, never evidence identity or content.

## Evidence

Evidence uses the existing Run 1 private Storage namespace and short-lived,
exact-scope grants. The reporting callable accepts at most ten canonical paths,
verifies that each object exists, and enforces an allowlisted content type and
15 MiB per-object ceiling. A URL or uploaded file is evidence for review, not
proof of identity, conversion, payout, payment, or entitlement.

No full invoice content is copied to the referral, timeline, suggestion, or
analytics records. Evidence paths are not returned in ordinary analytics or
participant-safe timeline projections.

## Analytics privacy

An individual may request their own exact activity. A current organization
member may request that organization's exact activity. Platform scope requires
admin/master and is restricted to an explicit intelligence callable path.

Platform overview, economic-impact, and gap aggregates use both minimums:

```text
minimum business-referral records       5
minimum distinct organizations          5
```

If either minimum fails, values are suppressed/null rather than rounded into a
potentially identifying cell. Own-scope exact metrics are labeled
`own_exact`; platform values are labeled `publishable` or `suppressed`.
Unrelated private relationships and third-party customers are never returned.

Queries are time bounded and record capped. The response exposes `truncated`
when a cap is hit, and the UI must retain that data-quality notice. Platform
relationship details and platform reciprocal-pair details are denied even to
the ordinary intelligence surface; risk-review detail is not a public graph.

Reported values remain separate from confirmed values. Disputed, cancelled,
and reversed reports cannot improve confirmed economic metrics. Currency
buckets are never combined without an approved FX method.

## Suggestions and relationship privacy

Recipient suggestions use only effective published offers, published public
profiles, discovery NAICS/category/territory fields, accepting-referrals state,
and allowed verification context. Protected contact data is never a matching
feature. The caller and caller's current organizations are excluded.

Each suggestion explains its deterministic factors. A score is ranking context,
not AI, trust, authorization, or a guarantee. Relationship classifications
expose their factor counts and sample size, but not the customers or private
reports behind them. The `trusted` label is contextual and cannot grant data or
financial access.

Reciprocal-pattern output uses neutral language. It does not accuse a business
of fraud and does not alter a calculation. `referralRiskSignals` remains
direct-read denied; any future detailed review surface must be limited to
assigned staff/admin and must audit administrative actions.

## Duplicate-contact fingerprint contract

The existing contact record can support duplicate review because email and
telephone are already separated from the general referral. Run 3 does not
enable a production fingerprint by falling back to plaintext search or an
unsalted public hash.

The required future server-only contract is:

```text
Secret Manager entry: REFERRAL_DUPLICATE_HMAC_KEY
Algorithm:            HMAC-SHA-256
Fingerprint version:  1
Storage:               referralDuplicateFingerprints (direct access denied)
```

Before HMAC, the server must normalize:

- email by trimming, applying Unicode normalization, parsing the address,
  lowercasing/IDNA-normalizing the domain, and applying a separately approved
  mailbox-case policy without provider-specific dot or plus-address folding;
  and
- telephone into E.164 only when a region-aware parser can do so reliably,
  otherwise treating it as unavailable rather than guessing.

The HMAC input must be domain-separated and scoped, for example:

```text
v1 \0 recipient-scope-id \0 contact-kind \0 normalized-value
```

The stored record may contain only a keyed digest, `keyVersion`, contact kind,
authorized recipient/review scope, minimal referral references, and audit
timestamps. The raw normalized value and secret must never be stored in that
record, returned to a client, included in logs, placed in source control, or
used in analytics. Recipient-scoped values prevent unrelated organizations
from correlating the same contact. A separately domain-separated platform-review
scope may be used only by an explicitly authorized administrative path.

A fingerprint match is a duplicate-review signal, not proof that two people or
businesses are identical. It cannot automatically reject a referral, alter a
calculation, create a risk accusation, or expose another referral.

Key rotation requires a new `keyVersion`, a controlled dual-read/re-fingerprint
migration from authoritative contact data, and an audit/rollback plan. Existing
digests cannot be safely transformed into a new keyed digest. Deleting the old
key before an authorized migration would make old fingerprints unmatchable.

No `REFERRAL_DUPLICATE_HMAC_KEY` value was created, read, printed, or deployed
in Run 3. No callable currently generates or queries these fingerprints. Until
the Secret Manager binding and authorized review workflow are separately
implemented, duplicate fingerprinting must display as unavailable/manual
review, while the collection remains deny-all.

## Settlement and secret boundary

The calculation engine does not move money. `settlementEnabled` is schema-locked
to false and no client or administrator callable can change it to true. A proof
upload, checkout, Stripe charge, or one-party assertion cannot create a paid
state. Payment-provider secrets and existing legacy referral checkout paths are
not reused as business-referral settlement authority.

Run 3 performed no Secret Manager create/rotate operation, Firebase deployment,
production migration, production analytics read, or production data seed.

## Remaining production decisions

Separate security, legal, finance, and privacy approval is still required for:

- duplicate-HMAC implementation, rotation, retention, and deletion;
- customer/contact retention, access export, correction, and deletion policy;
- final refund, chargeback, evidence, dispute, appeal, reserve, and hold policy;
- marketplace payout onboarding, sanctions, and prohibited categories;
- merchant-of-record, tax, and withholding responsibilities;
- administrative risk-review roles and auditing; and
- production migration and rollback plans.
