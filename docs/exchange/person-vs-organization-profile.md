# Person versus organization profile

## Ownership boundary

A person profile is UID-owned. It contains display name, professional title, preferred private email/telephone, communication preferences, accessibility preferences, notification preferences, preferred Actor organization/establishment, and explicit professional-contact publication decisions.

An organization profile is organization-owned. It contains legal and trade identity, domain/website, identifiers, industries, capabilities, certifications, media/documents, establishments, contact points, communication routes, claim state, verification state, and publication decisions.

An authentication email is never copied automatically into an organization public contact point or route.

## Compatibility fields

Legacy UID fields (`businessName`, organization city/state, domain, NAICS, certifications, UEI, DUNS, CAGE, website) remain readable for compatibility. A profile save copies supplied values into `organizationOnboardingSuggestions`. It does not read, update, or supersede an organization record.

Public person projections use a final allowlist. Preferred private email/telephone appears publicly only when its own `professionalContactPublication` flag is true. Organization suggestions, enrichment proposals, preferences, and private destinations never enter `publicProfiles`.

## Enrichment

Selected provider values are stored as field-provenanced `enrichmentProposals` and organization-onboarding suggestions. Existing owner-entered organization data is never overwritten silently. Acceptance into an organization is a separate authorized workflow, followed by separate location/contact publication decisions.
