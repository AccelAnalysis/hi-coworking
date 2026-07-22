# Organization communication routes

A route binds one purpose and optional establishment to ordered primary/fallback contact IDs, member-role fallbacks, channel enablement, lifecycle state, timestamps, and version. Routes and delivery audit records are never directly readable from the browser.

The safe resolution result contains only organization ID, optional location ID, purpose, selected route ID, channel types, public disclosure level, fallback used, and audit request ID. Destination email, telephone, and member identity stay in the private delivery record.

Resolution order is location route, organization route, purpose role, owner/admin, then in-app fallback. General inquiries use public contact where appropriate, then platform relay. Billing is isolated from public contact.

Delivery audit records capture selected route, channels, delivery state, actor, Actor organization, Subject organization, establishment, consent/visibility basis, destination IDs, request ID, and timestamps. External transactional delivery is deliberately not implied; canonical in-app queuing is complete.
