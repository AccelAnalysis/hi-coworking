# Profile business-field migration

Profile schema version 4 introduces canonical person fields. Legacy business fields remain temporarily so existing readiness, assets, and verification journeys continue to render.

On save, supplied legacy values are copied into `organizationOnboardingSuggestions`; null does not silently erase a prior suggestion. The helper never loads or changes an organization. Enrichment writes proposals and field provenance into the same review boundary instead of replacing authoritative organization data.

Organization owners explicitly review suggestions in organization settings/onboarding. Identity, establishment classification, geocode confirmation, contact visibility, and route configuration each require their own decision. Removing compatibility fields is deferred until every reader and readiness calculation is migrated and configured acceptance confirms no regression.

External enrichment addresses and contacts use the same proposal boundary.
Owners can classify an address as headquarters, branch, mailing-only,
historical, duplicate, not associated, private home, or unresolved; contacts
can be classified by purpose and visibility or rejected/historicized. Accepted
records receive field-level source metadata. No proposal changes legal/trade
identity, replaces the current primary establishment, or becomes public without
the corresponding explicit publication decision.
