/** forms.accelanalysis.com is attached to the Hi Coworking Hosting site. Only the forms stay there. */
export const FORMS_HOST = "forms.accelanalysis.com";
export const FORMS_HOST_HOME = "https://accelanalysis.com";

/**
 * Page roots, plus the static assets and lead API those pages request.
 * A root matches itself and any slash-child, not a longer sibling name.
 */
export const FORMS_HOST_ALLOWED_ROOTS = ["/power-now", "/intake", "/_next", "/brand", "/api/expo"] as const;

export function normalizeFormsPath(pathname: string): string {
  const raw = pathname.split("?")[0]?.split("#")[0] ?? "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const collapsed = withSlash.replace(/\/{2,}/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed || "/";
}

export function isFormsHost(hostname: string): boolean {
  return hostname.trim().toLowerCase().replace(/\.$/, "") === FORMS_HOST;
}

export function isFormsHostPathAllowed(pathname: string): boolean {
  const path = normalizeFormsPath(pathname);
  return FORMS_HOST_ALLOWED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Stay on every host except the forms domain. There, leave allowed paths and replace the rest. */
export function decideFormsHost(hostname: string, pathname: string): "stay" | "redirect" {
  if (!isFormsHost(hostname)) return "stay";
  return isFormsHostPathAllowed(pathname) ? "stay" : "redirect";
}

/** Runs before paint. Other hostnames return immediately. */
export function formsHostGuardScript(): string {
  const roots = JSON.stringify(FORMS_HOST_ALLOWED_ROOTS);
  return `(function(){try{var h=String(location.hostname||"").toLowerCase().replace(/\\.$/,"");if(h!==${JSON.stringify(FORMS_HOST)})return;var p=String(location.pathname||"/").split("?")[0].split("#")[0];if(p.charAt(0)!=="/")p="/"+p;p=p.replace(/\\/+/g,"/");if(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);var roots=${roots};for(var i=0;i<roots.length;i++){var r=roots[i];if(p===r||p.indexOf(r+"/")===0)return;}location.replace(${JSON.stringify(FORMS_HOST_HOME)});}catch(e){}})();`;
}
