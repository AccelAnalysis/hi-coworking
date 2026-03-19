/**
 * Intuit OAuth 2.0 Connect Flow (PR-12)
 *
 * Handles the OAuth 2.0 authorization code flow for QuickBooks Online.
 * Tokens are stored in encrypted Firestore (per Arch Decision #3).
 *
 * Token storage: `intuitTokens/default` doc in Firestore.
 * Only one QB connection per Hi Coworking instance (single-tenant).
 *
 * Setup:
 *   firebase functions:secrets:set INTUIT_CLIENT_ID
 *   firebase functions:secrets:set INTUIT_CLIENT_SECRET
 *
 * Intuit Developer Portal:
 *   - Create an app at https://developer.intuit.com
 *   - Set redirect URI to: https://<region>-<project>.cloudfunctions.net/intuit_oauthCallback
 *   - Enable Accounting and Payments scopes
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

function getDb() { return admin.firestore(); }
const TOKEN_DOC = "intuitTokens/default";

// Intuit OAuth endpoints
const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

// Scopes needed for invoice creation + payments
const SCOPES = "com.intuit.quickbooks.accounting com.intuit.quickbooks.payment";

export interface IntuitTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: number;
  refreshExpiresAt: number;
  updatedAt: number;
}

/**
 * Generate the authorization URL that the admin clicks to connect QuickBooks.
 */
export function getAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  realmId: string
): Promise<IntuitTokens> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    logger.error("Intuit token exchange failed", { status: resp.status, body: errBody });
    throw new Error(`Token exchange failed: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };

  const now = Date.now();
  const tokens: IntuitTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId,
    expiresAt: now + data.expires_in * 1000,
    refreshExpiresAt: now + data.x_refresh_token_expires_in * 1000,
    updatedAt: now,
  };

  await saveTokens(tokens);
  logger.info("Intuit tokens stored", { realmId, expiresAt: tokens.expiresAt });
  return tokens;
}

/**
 * Refresh the access token using the stored refresh token.
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string
): Promise<IntuitTokens> {
  const current = await getTokens();
  if (!current) {
    throw new Error("No Intuit tokens found — connect QuickBooks first");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    }).toString(),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    logger.error("Intuit token refresh failed", { status: resp.status, body: errBody });
    throw new Error(`Token refresh failed: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };

  const now = Date.now();
  const tokens: IntuitTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId: current.realmId,
    expiresAt: now + data.expires_in * 1000,
    refreshExpiresAt: now + data.x_refresh_token_expires_in * 1000,
    updatedAt: now,
  };

  await saveTokens(tokens);
  logger.info("Intuit tokens refreshed", { realmId: tokens.realmId });
  return tokens;
}

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getValidAccessToken(
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; realmId: string }> {
  let tokens = await getTokens();
  if (!tokens) {
    throw new Error("No Intuit tokens found — connect QuickBooks first");
  }

  // Refresh if access token expires in less than 5 minutes
  if (tokens.expiresAt < Date.now() + 5 * 60 * 1000) {
    tokens = await refreshAccessToken(clientId, clientSecret);
  }

  return { accessToken: tokens.accessToken, realmId: tokens.realmId };
}

// --- Firestore Token Storage ---

async function saveTokens(tokens: IntuitTokens): Promise<void> {
  await getDb().doc(TOKEN_DOC).set(tokens);
}

export async function getTokens(): Promise<IntuitTokens | null> {
  const snap = await getDb().doc(TOKEN_DOC).get();
  return snap.exists ? (snap.data() as IntuitTokens) : null;
}

/**
 * Check if QuickBooks is connected (has valid refresh token).
 */
export async function isQuickBooksConnected(): Promise<boolean> {
  const tokens = await getTokens();
  if (!tokens) return false;
  // Refresh token typically valid for 100 days
  return tokens.refreshExpiresAt > Date.now();
}
