import type { KeyboardEvent } from "react";

/**
 * Keyboard handling for the WAI-ARIA tabs pattern (automatic activation):
 * Left/Right move between tabs, Home/End jump to the first/last tab.
 * Each tab button must have id `${idPrefix}${tabId}`.
 */
export function tablistKeyHandler<T extends string>(
  order: readonly T[],
  active: T,
  select: (next: T) => void,
  idPrefix: string,
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const index = order.indexOf(active);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % order.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(order[next]);
    if (typeof document !== "undefined") document.getElementById(`${idPrefix}${order[next]}`)?.focus();
  };
}
