/** Only same-origin relative paths may survive an authentication round trip. */
export function safeNextPath(value: string | null | undefined, fallback = "/account/bookings"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return fallback;
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || /^\/(login|register)(\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function authPath(page: "login" | "register", next: string): string {
  return `/${page}?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function membershipPath(tier: string, interval: "month" | "year" = "month"): string {
  return `/pricing?${new URLSearchParams({ tier, interval })}`;
}
