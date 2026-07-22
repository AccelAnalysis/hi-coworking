# Seed review data model

Seed package version 2 governs one organization with zero or more establishments, protected contact points, and communication routes.

Preparation never infers approval. It emits `organizationDecision: defer`, establishment `defer_location`, contact `defer`, empty route decisions, review hashes, provenance, and zero public approvals.

Organization decisions support approve, reject, defer, restricted matching only, duplicate/survivor, and link existing. Establishment decisions support approve/classify, list-only, mailing-only, private-home, reject, defer, primary, headquarters, and independent address/coordinate publication. Contact decisions support private operational, public, purpose, reject, defer, historical, and duplicate. Route decisions bind approved contact IDs and safe fallbacks.

Approved export refuses deferred subdecisions and binds all approved child records with `seedPackageHash`. The importer validates organization ownership, writes child collections and final public projections, includes every changed document in rollback evidence, supports no-op replay, and preserves claimed/owned records.

This workstream does not human-approve or import a real candidate. Human-approved count: **0**. Imported real seed count: **0**.
