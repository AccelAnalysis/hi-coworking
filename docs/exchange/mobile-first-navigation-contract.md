# Exchange mobile-first navigation contract

## Canonical product navigation

The Exchange is one platform with four primary functional modes:

1. Intelligence
2. Referrals
3. Opportunities
4. Resources

On mobile, the persistent bottom navigation order is exactly:

`Intelligence | Referrals | Opportunities | Resources | Menu`

Opportunities is the default view and the central navigation item.

## Businesses

Businesses remain a first-class Exchange entity but are not a separate primary destination. Users discover and inspect businesses through universal search, opportunities, referrals, resources, intelligence, organization profiles, map markers, and contextual detail surfaces.

Legacy `view=businesses` states normalize to Opportunities, and the legacy Directory route enters opportunity search instead of presenting a separate business application.

## Teaming

Teaming is not a primary destination. It begins from a selected opportunity through the in-context **Team up** modal. The modal preserves the selected opportunity while supporting partner introductions, opportunity sharing, and review of full requirements.

Legacy `view=teaming` states normalize to Opportunities.

## Referral naming compatibility

The product-facing name is Referrals. Existing internal Connections components and legacy `view=connections` states normalize to Referrals until their implementation names are safely refactored.

## Mobile visual contract

At phone breakpoints the Exchange behaves as a full-screen application layer and covers the general site navigation. The approved mobile reference is the original mockup supplied by the product owner. Required characteristics include:

- universal search at the top of the active workspace;
- map-first Opportunities canvas;
- compact map-layer/filter and fit controls along the map edge;
- a lower opportunity control tray with a drag handle, sort label, map/list toggle, and quick actions;
- persistent icon-above-label bottom navigation;
- contextual details and teaming in mobile sheets or modals;
- account, organization, membership, credits, notifications, and secondary functions inside Menu.

Desktop retains the expanded Exchange workspace rather than imitating a phone, but uses the same four-mode information architecture and stable command-bar conventions.

## Implemented acceptance coverage

Automated tests verify:

- the mobile navigation labels and exact order;
- Businesses and Teaming are absent from primary navigation;
- legacy Businesses and Teaming states resolve to Opportunities;
- legacy Connections resolves to Referrals;
- Team up is available from an opportunity detail;
- `/exchange` continues to render `ExchangeWorkspace`, never the legacy RFx page.

A final browser-based visual comparison against the supplied 390×844 and 430×932 references remains a manual design-acceptance step before release. Automated code, security, and production-build validation does not by itself prove pixel-level visual parity.
