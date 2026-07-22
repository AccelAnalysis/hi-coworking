# Organization context accessibility

Organization context must remain understandable without relying on marker
color, pointer input, animation, or a large desktop viewport.

## Implemented interaction contract

- The persistent context bar has a named “Working as organization” selector.
- Actor and subject are expressed in text, not only by marker style.
- The subject control has an explicit label, and clearing subject is a separate
  named action that does not change actor.
- Actor fallback and errors use status/live-region text.
- Organization drawer controls have visible focus rings and descriptive labels.
- Close-drawer copy explains that context is retained; clear-context is a
  separate full-width action.
- Contact and introduction inputs use a programmatic label and disabled states.
- Async perspective verification and action notices use status semantics.
- Primary touch controls are at least 44 CSS pixels tall in the drawer and
  context controls are designed for touch operation.
- Decorative icons are hidden from assistive technology.
- The persistent map host is a named region; visible list/detail experiences
  provide a non-map route to organization information.
- Map result fitting and loading animation honor `prefers-reduced-motion`.
- Inactive mode containers use `display: none` and `aria-hidden`, preventing
  hidden mode controls from entering normal keyboard interaction.

## Information clarity

The UI states “Working as” separately from the viewed organization and renders
context/projection labels as text. Opportunities and Resources use actor-
relative headings when the subject differs. Resource provider state, claim
state, location availability, and relationship indicator have textual forms;
they are not communicated by color alone.

Unavailable or temporarily unverifiable context presents a fail-closed message
instead of a blank private panel. Relationship-safe copy does not reveal a path
or imply endorsement.

## Keyboard expectations

Required configured checks include:

- tab and reverse-tab through actor, subject, drawer, mode, filter, list, and
  action controls;
- Space/Enter operation for mode and context controls;
- visible focus at every step;
- Escape/close behavior that does not silently clear subject;
- list-based access to every organization action available from a marker; and
- focus restoration or an announced logical destination after closing detail.

Mapbox canvas marker keyboard behavior is not treated as the only path to an
organization. The list and search interface must remain equivalent.

## Mobile and responsive expectations

The compact context bar truncates long names without removing accessible
labels. The drawer width is bounded to the viewport and content scrolls within
it. Configured testing must verify safe-area interaction, zoom/reflow, no
horizontal overflow, touch target spacing, virtual keyboard behavior, and that
map controls are not obscured by mobile navigation or the drawer.

## Known gaps

The organization drawer is currently an `aside`, not a modal dialog with a
focus trap. That is appropriate only if background interaction remains
intentional and focus order remains clear; configured keyboard and screen-reader
testing must confirm it. Focus restoration, announcement verbosity, Mapbox
canvas accessibility, and high-zoom/reflow behavior require browser evidence.

No configured axe scan, VoiceOver, TalkBack, native Safari, or complete
Firefox/WebKit run has been recorded for this workstream. Static labels and unit
tests do not replace assistive-technology acceptance.

## Acceptance gate

Run automated accessibility checks at desktop and mobile sizes, then manual
keyboard, reduced-motion, high-contrast/forced-colors where supported, screen-
reader, 200%/400% zoom, and touch checks. Record browser/version, viewport,
violations, screenshots, and remediations. Accessibility remains partially
implemented and not configured-accepted until that evidence exists.
