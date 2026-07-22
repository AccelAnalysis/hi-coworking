# Organization contact points

Contact points are organization-owned destinations, optionally scoped to an establishment. Types are email, phone, website, contact form, and member route. Purposes include general, referrals, opportunities, RFx responses, teaming, resource inquiries, billing, location inquiries, and administration.

Values are normalized server-side. Active duplicates are rejected. Every contact records verification state, explicit visibility, publication status, authority/consent basis, lifecycle state, creator, timestamps, and record version.

Organization settings supports both creation and editing. Updates retain the
canonical contact ID, re-run normalization and duplicate checks, and rebuild or
delete the public projection transactionally according to the new visibility
and publication decision.

Visibility levels are private operational, organization members, relationship-safe, and public. Only an active, explicitly public, publication-approved contact can enter `publicOrganizationContactPoints`. Billing contacts cannot be public. Private values are not placed in route responses, public organization records, markers, GeoJSON, logs, or external DOM.
