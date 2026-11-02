// One-click unsubscribe endpoint for event campaign and nurture email
// (marketing_unsubscribe).
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
import { EMAIL_BODY_FONT, EMAIL_HEADLINE_FONT, EMAIL_LOGO_URL, EMAIL_NAVY } from "./payments/emailBrand";
import { applyUnsubscribeToken, isWellFormedToken, type UnsubscribeResult } from "./providers/marketingPreferences";

export type UnsubscribeHttpResult = { status: number; html: string };

const SITE = "https://hi-coworking.com";

const FONTS = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Fraunces:opsz,wght@9..144,600&display=swap";
const BUTTON = `padding:12px 24px;background:${EMAIL_NAVY};color:#fff;border:0;border-radius:999px;font:600 16px ${EMAIL_BODY_FONT};cursor:pointer`;
const LINK = `color:${EMAIL_NAVY};font-weight:600`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Hi Coworking</title><link rel="stylesheet" href="${FONTS}"></head><body style="margin:0;background:#f8fafc;color:${EMAIL_NAVY};font-family:${EMAIL_BODY_FONT}"><main style="max-width:480px;margin:64px auto;padding:40px 32px;background:#fff;border-radius:24px;text-align:center"><img src="${EMAIL_LOGO_URL}" width="56" height="56" alt="Hi Coworking" style="display:inline-block"><h1 style="margin:24px 0 24px;font-family:${EMAIL_HEADLINE_FONT};font-size:28px;font-weight:600;line-height:1.2">${title}</h1>${body}</main></body></html>`;
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
      `<p><a href="${SITE}/my-hi" style="${LINK}">Manage email preferences</a></p>`,
    ),
  };
  if (method === "GET" || method === "HEAD") {
    if (!isWellFormedToken(token)) return invalid;
    return {
      status: 200,
      html: page(
        "Unsubscribe from Hi Coworking emails?",
        `<form method="post" action="?t=${token}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit" style="${BUTTON}">Unsubscribe</button></form>`,
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
      `<p><a href="${SITE}" style="${LINK}">Back to Hi Coworking</a></p>`,
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
      res.status(500).type("html").send(page("Please try again in a minute", ""));
    }
  },
);
