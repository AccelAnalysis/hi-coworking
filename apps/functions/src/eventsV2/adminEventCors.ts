/**
 * Origins allowed to call the admin event save and publish callables.
 *
 * Callable functions otherwise reflect every Origin (`cors: true`). These
 * endpoints stay limited to the live site, its Firebase Hosting hosts, and
 * the local Next.js dev origins used by this app.
 *
 * Keep at least two entries. firebase-functions unwraps a one-item array
 * before handing it to the CORS middleware, which can emit an invalid
 * Access-Control-Allow-Origin value.
 */
export const ADMIN_EVENT_SAVE_ALLOWED_ORIGINS = [
  "https://hi-coworking.com",
  "https://www.hi-coworking.com",
  "https://hi-coworking-plat.web.app",
  "https://hi-coworking-plat.firebaseapp.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export function isAdminEventSaveOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return (ADMIN_EVENT_SAVE_ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

export const adminEventCallableOptions = {
  cors: [...ADMIN_EVENT_SAVE_ALLOWED_ORIGINS],
};
