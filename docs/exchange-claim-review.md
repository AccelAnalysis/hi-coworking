# Exchange organization claim review

## Claimant flow

An authenticated user searches before creating an organization. A claim request uses the deterministic ID `{organizationId}_{uid}`. Repeating a pending or approved request is idempotent. Claimants see pending, approved, or rejected status on `/exchange/onboarding`; pending claimants cannot edit the organization or start checkout.

## Administrator flow

Platform `admin` or `master` users open `/admin/exchange-claims`. The admin must provide a review note and approve or reject. The callable rechecks the custom claim; the browser role gate is only presentation.

Approval runs one Firestore transaction that:

1. Confirms the claim is still pending and the organization is not owned by another approved claimant.
2. Marks the selected claim approved.
3. Creates/merges the claimant's deterministic `orgMembers` owner record.
4. Sets `orgs.ownerUid` and `claimStatus: claimed`.
5. Rejects every competing pending claim.
6. Writes a deterministic `exchangeAudit` decision record.

Replaying the same decision returns an idempotent result. A different decision after completion is rejected. Rejecting the last pending claim returns the organization to `unclaimed`; otherwise it remains `claim_pending`.

Claims and claim audit collections deny all client reads/writes. Claimants and admins receive privacy-filtered records from callable functions.
