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

## Shared mobile workspace contract

At phone breakpoints, every primary view uses the same application anatomy:

- one stable command and universal-search row;
- one persistent lower workspace tray;
- one consistent drag handle, sort area, and map/list toggle;
- four contextual actions in fixed positions;
- persistent icon-above-label bottom navigation;
- contextual details in sheets or modals.

The tray may change its action labels for Intelligence, Referrals, Opportunities, and Resources, but it must not move, disappear, or use a different structure between primary views.

## Desktop workspace contract

Desktop retains the expanded Exchange workspace rather than imitating a phone. All four primary modes use the same Hi Exchange command bar and desktop tab navigation. No primary mode may replace it with a one-off header.

## Map contract

The Exchange map is a functional geographic surface, never a decorative CSS approximation.

- Use Mapbox when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured.
- Use the Leaflet/OpenStreetMap fallback when no Mapbox token is configured.
- Opportunities may display RFx and territory markers when verified coordinates exist.
- Intelligence, Referrals, and Resources display real launch-market territory context immediately.
- Domain-specific markers appear only when authorized records include verified coordinates.
- Records without verified geography remain available through lists and detail surfaces; the application must not invent marker positions.

## Resources

Resources uses the same command bar, responsive application frame, lower mobile tray, and real geographic surface as the other primary views. Placeholder gradients and simulated map markers are prohibited.

## Implemented acceptance coverage

Automated tests and CI verify:

- the mobile navigation labels and exact order;
- Businesses and Teaming are absent from primary navigation;
- legacy Businesses and Teaming states resolve to Opportunities;
- legacy Connections resolves to Referrals;
- Team up is available from an opportunity detail;
- `/exchange` continues to render `ExchangeWorkspace`, never the legacy RFx page;
- lint, Exchange tests, inherited security, Run 3, Run 4, production build, and clean-diff checks pass.

A final browser-based visual comparison against the supplied 390×844 and 430×932 references remains a manual design-acceptance step before release. Automated code, security, and production-build validation does not by itself prove pixel-level visual parity.
