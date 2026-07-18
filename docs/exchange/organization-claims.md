# Organization claim workflow

The state transition is `unclaimed → claim_pending → claimed`.

A signed-in claimant must supply an authority explanation of at least ten characters. The request uses a deterministic claim ID, is retry-safe, updates the public claim state, writes an audit event, and notifies the claimant without blocking Exchange browsing.

Only current `admin` or `master` custom claims can review requests. Approval transactionally:

- creates or updates the claimant's owner membership;
- initializes the Run 4 free membership and credit account when absent;
- sets authoritative owner and claimed state;
- rejects competing pending claims;
- updates the public projection;
- sends claimant/competitor notifications; and
- writes immutable audit evidence.

Approval establishes claimed authority, not full business verification. Verification remains a separate governed workflow. Rejection preserves history and returns the organization to `unclaimed` only when no competing request remains.
