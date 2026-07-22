# Referral communication routing

When a canonical business referral is sent to an organization, the server resolves:

1. establishment-specific referral route when a location is supplied;
2. organization referral route;
3. active referral-manager members;
4. active owner/admin members;
5. in-app fallback.

The referral stores only the safe route-resolution result. A private delivery audit stores contact-point/member IDs. Active destination members receive in-app notifications. The sender receives delivery state, channels, fallback, route ID when applicable, and audit ID—never a private email or telephone.

Referral party/consent authorization remains unchanged and separate from communication-destination visibility.
