# Organization-issued opportunities

`issuerOrganizationId` is the canonical identity for organization-issued opportunities. It is preserved in the discovery projection independently of `createdBy` UID.

Discovery accepts an exact `issuerOrganizationId` filter and still applies server-side visibility authorization. The drawer action switches to Opportunities while preserving Actor, Subject, and establishment context, then sets the issuer filter.

An empty result means the organization currently has no authorized/public opportunities. It does not create an opportunity and has no effect on organization or establishment marker eligibility.
