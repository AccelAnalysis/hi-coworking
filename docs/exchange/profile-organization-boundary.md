# Personal profile and organization boundary

A personal profile is keyed by Firebase UID and describes the authenticated person/business-facing profile. An organization is a separate shared authority boundary with owner/admin/member roles. Updating a personal profile cannot create organization ownership, and linking or acting for an organization requires a current `orgMembers` record issued by server code.

`profile_update` accepts a strict allowlist and ignores no unknown linkage fields. It normalizes legacy documents to `profileSchemaVersion: 2`, preserves safe legacy data, calculates completeness/readiness, and publishes only the sanitized `publicProfiles` projection.

The legacy super-admin path is claims-compatible: `master` remains recognized by server authorization, but a legacy Firestore role field alone does not grant authority.
