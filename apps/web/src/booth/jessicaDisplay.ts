/**
 * Booth chrome is the operator page. Ambient is the always-on TV:
 * Jessica idle and animating, push-to-talk still talks, no wake screen.
 */
export type JessicaDisplay = "booth" | "ambient";

export function jessicaDisplayFromSearch(search: string): JessicaDisplay {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const mode = (params.get("mode") ?? "").trim().toLowerCase();
  const display = (params.get("display") ?? "").trim().toLowerCase();
  if (mode === "ambient" || display === "solo") return "ambient";
  return "booth";
}

/**
 * Ambient never shows the wake screen. Connection and voice failure stay
 * on the idle pose so she keeps moving until a real listen or speak status.
 */
export function ambientAvatarStatus(status: string): string {
  if (status === "needs-start" || status === "connecting" || status === "error") return "ready";
  return status;
}
