# Opportunity Discovery Accessibility

## Implemented interaction requirements

- Keyword and location search have explicit accessible names.
- Location suggestions use a combobox/listbox relationship, active-descendant state, arrow-key navigation, Enter selection, and Escape dismissal.
- Native select and checkbox controls are preferred for sort and filter choices.
- Icon-only save, clear, share, overflow, close, and map actions have accessible names.
- Result cards expose a non-map route to every opportunity.
- Result lists and load-more actions remain keyboard operable.
- Loading, result count, warning, and error states use live regions where appropriate.
- Status is communicated with text/icons as well as color.
- Motion-sensitive scrolling and spinners respect reduced-motion behavior.
- Mobile interactive targets are designed at approximately 40–44 CSS pixels or larger.
- Details and filter content use headings, fieldsets, legends, sections, and native disclosure controls.
- Map-area search is contextual and has a list equivalent.

## Required automated checks

Run axe or the repository’s equivalent against:

1. Initial Opportunities map view
2. Location combobox open
3. Filter sheet open with advanced sections expanded
4. Loaded result drawer
5. Selected opportunity detail
6. Addenda/Q&A section
7. Empty results
8. Error/degraded state
9. Saved-search section

Automated checks must report zero critical or serious violations introduced by this branch.

## Required manual keyboard checks

- Reach keyword search, location search, Filters, sort, result cards, save, overflow, map-area search, and primary detail action in logical order.
- Location options can be traversed and selected without pointer input.
- The mobile filter/detail sheets trap focus while open and restore it to the invoking control after close.
- Escape closes temporary surfaces without clearing unrelated discovery state.
- Opening and closing details restores focus or preserves result context.
- Native details elements and select controls expose state correctly.
- No keyboard user must interact with Mapbox to open an opportunity.

## Required screen-reader checks

- Result counts and loading transitions are announced once, not repeatedly.
- Active-filter changes are understandable from the filter controls and chip labels.
- Saved/unsaved and selected/unselected states are announced.
- Exact, approximate, territory-only, withheld, and remote location states are verbalized.
- Deadline, days remaining, issuer, opportunity type, and eligibility are understandable without visual position.
- Private/public Q&A visibility is announced.
- Clustered map data has a complete result-list equivalent.

## Contrast and glass surfaces

Validate text, borders, focus rings, and controls over both light and dark map regions. Glass panels may not rely on the underlying map to provide contrast. Selected markers, closing-soon states, and updated states must use shape/text/icon differences in addition to color.

## Focus management blockers

Browser acceptance must confirm the existing `ExchangeMobileDrawer`, `ExchangeDetailSheet`, and any modal action sheet trap focus and restore focus correctly. Native disclosure controls do not require custom trapping. Any regression in drawer/detail focus management blocks a 100% accessibility claim.

## Acceptance record

Record browser, assistive technology, viewport, tester, date, issues, and resolution in `opportunity-discovery-acceptance.md`. Until that record is complete, accessibility remains configuration/acceptance dependent rather than 100%.