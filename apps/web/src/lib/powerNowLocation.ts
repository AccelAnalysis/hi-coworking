import { canonicalizePowerNowPath, type PowerNowPath } from "./powerNowLead";

/** `/power-now/pitch` (optional trailing slash) is the clean form of `?path=pitch`. */
export function powerNowPathFromPathname(pathname: string): PowerNowPath | null {
  const bare = pathname.split("?")[0]?.split("#")[0] ?? "";
  const normalized = bare.replace(/\/+$/, "") || "/";
  const match = normalized.match(/^\/power-now\/([^/]+)$/i);
  if (!match?.[1]) return null;
  try {
    return canonicalizePowerNowPath(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/**
 * A valid `path` query wins, so card clicks that set `?path=` still work on a clean URL.
 * Otherwise the path segment selects the form. Other query params, including UTMs, are ignored here.
 */
export function resolvePowerNowPath(pathname: string, search: string): PowerNowPath | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fromQuery = canonicalizePowerNowPath(params.get("path"));
  if (fromQuery) return fromQuery;
  return powerNowPathFromPathname(pathname);
}
