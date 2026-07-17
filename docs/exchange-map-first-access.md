# Exchange map-first access correction

## Product priority

The Exchange workspace is the product. Organization connection and Founding Membership enhance the workspace but do not gate basic browsing.

## Canonical routes

- `/exchange` — authenticated Exchange map and RFx opportunity workspace.
- `/exchange/onboarding` — optional organization search, claim, or creation.
- `/exchange/founding` — public Founding Membership campaign.
- `/exchange/membership` — organization-level membership purchase and management.

## Access behavior

- Registration and sign-in redirect to `/exchange`.
- A registered user can browse the map without an organization.
- A pending, rejected, or unresolved organization claim does not remove map access.
- Creating an organization returns the user to `/exchange` rather than forcing an immediate upgrade.
- Organization ownership remains required for profile management, organization actions, and organization-level billing.
- The Coming Soon gate does not hide Exchange routes.
- The global Exchange navigation item opens the workspace rather than the Founding campaign.

## Current map implementation

The canonical `/exchange` route exposes the existing RFx marketplace map, including opportunity discovery, released and scheduled territories, filters, saved records, managed RFx, and teaming surfaces. This is the immediate operational map while seeded organization markers, directory layers, referrals, resources, and intelligence are progressively consolidated into the same workspace.

## Acceptance checks

1. Register and land on `/exchange`.
2. Confirm the RFx marketplace map workspace renders.
3. Open `/exchange/onboarding` and return to the map without entering organization data.
4. Submit a seeded-organization claim and continue browsing while it remains pending.
5. Create a new organization and return to the map.
6. Open membership separately for an owned or approved organization.
7. Run the full Exchange security and Week 1 acceptance workflows before staging deployment.
