// One-click unsubscribe endpoint for event campaign email (marketing_unsubscribe).
//
// Ships in the isolated campaign bundle next to events_processCampaignJobs
// and in the main source. No secrets. The link in every campaign email and
// its List-Unsubscribe header point here with ?t=<token>.
//
//   GET/HEAD  shows a confirmation page with an Unsubscribe button. It never
//             changes anything, so link scanners and prefetchers can't
//             unsubscribe people.
//   POST      unsubscribes. Mail clients send this for RFC 8058 one-click
//             (body "List-Unsubscribe=One-Click"); the page's button posts
//             the same way.
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { applyUnsubscribeToken, isWellFormedToken, type UnsubscribeResult } from "./providers/marketingPreferences";

export type UnsubscribeHttpResult = { status: number; html: string };

const SITE = "https://hi-coworking.com";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:48px auto;padding:0 24px;color:#0f172a;"><h1 style="font-size:22px;">${title}</h1>${body}</body></html>`;
}

export async function handleUnsubscribeRequest(
  input: { method: string; token: unknown },
  apply: (token: string) => Promise<UnsubscribeResult>,
): Promise<UnsubscribeHttpResult> {
  const method = input.method.toUpperCase();
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const invalid = {
    status: 404,
    html: page(
      "This link isn't valid",
      `<p>We couldn't find that unsubscribe link. You can manage email from your <a href="${SITE}/my-hi">Hi Coworking account</a>.</p>`,
    ),
  };
  if (method === "GET" || method === "HEAD") {
    if (!isWellFormedToken(token)) return invalid;
    return {
      status: 200,
      html: page(
        "Unsubscribe from Hi Coworking event emails?",
        `<p>You'll stop getting event announcements, reminders and follow-ups by email. You can still sign up for events.</p><form method="post" action="?t=${token}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit" style="padding:12px 24px;background:#0f172a;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;">Unsubscribe</button></form>`,
      ),
    };
  }
  if (method !== "POST") return { status: 405, html: page("Method not allowed", "") };
  if (!isWellFormedToken(token)) return invalid;
  const result = await apply(token);
  if (result === "not-found") return invalid;
  return {
    status: 200,
    html: page(
      "You're unsubscribed",
      `<p>You won't get Hi Coworking marketing emails anymore. Account and booking emails still arrive.</p><p><a href="${SITE}">Back to Hi Coworking</a></p>`,
    ),
  };
}

export const marketing_unsubscribe = onRequest(
  { cors: false, memory: "256MiB", timeoutSeconds: 30, invoker: "public" },
  async (req, res) => {
    try {
      const bodyToken = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).t : undefined;
      const result = await handleUnsubscribeRequest(
        { method: req.method, token: req.query.t ?? bodyToken },
        (token) => {
          const db = admin.firestore();
          return applyUnsubscribeToken(db, token, Date.now());
        },
      );
      if (result.status === 405) res.set("Allow", "GET, HEAD, POST");
      res.set("Cache-Control", "no-store");
      res.set("Referrer-Policy", "no-referrer");
      res.status(result.status).type("html").send(req.method === "HEAD" ? "" : result.html);
    } catch (error) {
      logger.error("marketing_unsubscribe failed", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).type("html").send(page("Something went wrong", "<p>Please try the link again in a minute.</p>"));
    }
  },
);
