import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

export interface SocialPostPayload {
  caption: string;
  imageUrl?: string;
  link?: string;
}

export interface SocialPostResult {
  postId: string;
  postUrl: string;
}

export interface SocialPlatformProvider {
  platform: string;
  publish(payload: SocialPostPayload): Promise<SocialPostResult>;
}

// --- Token Vault ---
// Stores and retrieves encrypted OAuth tokens from Firestore.
// Tokens are stored in `socialTokenVault/{platform}` documents.
// Admins set tokens via the admin UI or CLI; the vault just reads them at publish time.

interface VaultedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  pageId?: string;
  orgId?: string;
  updatedAt: number;
}

async function getVaultedToken(platform: string): Promise<VaultedToken | null> {
  const db = admin.firestore();
  const snap = await db.collection("socialTokenVault").doc(platform).get();
  if (!snap.exists) return null;
  return snap.data() as VaultedToken;
}

async function updateVaultedToken(platform: string, updates: Partial<VaultedToken>): Promise<void> {
  const db = admin.firestore();
  await db.collection("socialTokenVault").doc(platform).set(
    { ...updates, updatedAt: Date.now() },
    { merge: true }
  );
}

// --- LinkedIn Provider ---
// Uses LinkedIn Marketing API v2 (Community Management API).
// Requires LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET secrets for token refresh.
// Access token stored in socialTokenVault/linkedin.

export class LinkedInProvider implements SocialPlatformProvider {
  platform = "linkedin";
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getAccessToken(): Promise<{ accessToken: string; orgUrn: string }> {
    const vault = await getVaultedToken("linkedin");
    if (!vault?.accessToken) {
      throw new Error("LinkedIn access token not configured. Set it in socialTokenVault/linkedin.");
    }

    // Check if token needs refresh
    if (vault.expiresAt && vault.expiresAt < Date.now() + 5 * 60 * 1000 && vault.refreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(vault.refreshToken);
        await updateVaultedToken("linkedin", {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || vault.refreshToken,
          expiresAt: refreshed.expiresAt,
        });
        return {
          accessToken: refreshed.accessToken,
          orgUrn: vault.orgId ? `urn:li:organization:${vault.orgId}` : `urn:li:person:${vault.pageId || "me"}`,
        };
      } catch (err) {
        logger.warn("LinkedIn token refresh failed, using existing token", { err });
      }
    }

    return {
      accessToken: vault.accessToken,
      orgUrn: vault.orgId ? `urn:li:organization:${vault.orgId}` : `urn:li:person:${vault.pageId || "me"}`,
    };
  }

  private async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown");
      throw new Error(`LinkedIn token refresh failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async publish(payload: SocialPostPayload): Promise<SocialPostResult> {
    const { accessToken, orgUrn } = await this.getAccessToken();

    const postBody: Record<string, unknown> = {
      author: orgUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: payload.caption },
          shareMediaCategory: payload.link ? "ARTICLE" : "NONE",
          ...(payload.link
            ? {
                media: [
                  {
                    status: "READY",
                    originalUrl: payload.link,
                    ...(payload.imageUrl ? { thumbnails: [{ resolvedUrl: payload.imageUrl }] } : {}),
                  },
                ],
              }
            : {}),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(postBody),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      logger.error("LinkedIn publish failed", { status: response.status, body: errorBody });
      throw new Error(`LinkedIn publish failed: ${response.status}`);
    }

    const postId = response.headers.get("x-restli-id") || `li_${Date.now()}`;
    const postUrl = `https://www.linkedin.com/feed/update/${postId}`;

    logger.info("LinkedIn post published", { postId, postUrl });
    return { postId, postUrl };
  }
}

// --- X (Twitter) Provider ---
// Uses X API v2 with OAuth 2.0 User Context (PKCE flow).
// Requires X_CLIENT_ID and X_CLIENT_SECRET secrets for token refresh.
// Access token stored in socialTokenVault/x.

export class XTwitterProvider implements SocialPlatformProvider {
  platform = "x";
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getAccessToken(): Promise<string> {
    const vault = await getVaultedToken("x");
    if (!vault?.accessToken) {
      throw new Error("X/Twitter access token not configured. Set it in socialTokenVault/x.");
    }

    // Check if token needs refresh
    if (vault.expiresAt && vault.expiresAt < Date.now() + 5 * 60 * 1000 && vault.refreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(vault.refreshToken);
        await updateVaultedToken("x", {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || vault.refreshToken,
          expiresAt: refreshed.expiresAt,
        });
        return refreshed.accessToken;
      } catch (err) {
        logger.warn("X token refresh failed, using existing token", { err });
      }
    }

    return vault.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const response = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown");
      throw new Error(`X token refresh failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async publish(payload: SocialPostPayload): Promise<SocialPostResult> {
    const accessToken = await this.getAccessToken();

    let text = payload.caption;
    if (payload.link) {
      text = `${text}\n\n${payload.link}`;
    }

    // X API v2 tweet creation
    const response = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      logger.error("X publish failed", { status: response.status, body: errorBody });
      throw new Error(`X publish failed: ${response.status}`);
    }

    const data = (await response.json()) as { data?: { id?: string } };
    const tweetId = data.data?.id || `x_${Date.now()}`;
    const postUrl = `https://x.com/i/status/${tweetId}`;

    logger.info("X post published", { tweetId, postUrl });
    return { postId: tweetId, postUrl };
  }
}

// --- Facebook / Instagram Provider ---
// Uses Meta Graph API. Access token stored in socialTokenVault/facebook or socialTokenVault/instagram.

export class MetaProvider implements SocialPlatformProvider {
  platform: string;
  private pageAccessToken: string | null = null;
  private pageId: string | null = null;

  constructor(platform: "facebook" | "instagram") {
    this.platform = platform;
  }

  private async getCredentials(): Promise<{ accessToken: string; pageId: string }> {
    if (this.pageAccessToken && this.pageId) {
      return { accessToken: this.pageAccessToken, pageId: this.pageId };
    }

    const vault = await getVaultedToken(this.platform);
    if (!vault?.accessToken || !vault?.pageId) {
      throw new Error(`${this.platform} credentials not configured. Set in socialTokenVault/${this.platform}.`);
    }

    this.pageAccessToken = vault.accessToken;
    this.pageId = vault.pageId;
    return { accessToken: vault.accessToken, pageId: vault.pageId };
  }

  async publish(payload: SocialPostPayload): Promise<SocialPostResult> {
    const { accessToken, pageId } = await this.getCredentials();

    if (this.platform === "instagram") {
      return this.publishInstagram(accessToken, pageId, payload);
    }

    // Facebook Page post
    const params = new URLSearchParams({
      message: payload.caption,
      access_token: accessToken,
    });
    if (payload.link) {
      params.set("link", payload.link);
    }

    const response = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      logger.error("Facebook publish failed", { status: response.status, body: errorBody });
      throw new Error(`Facebook publish failed: ${response.status}`);
    }

    const data = (await response.json()) as { id?: string };
    const postId = data.id || `fb_${Date.now()}`;
    const postUrl = `https://www.facebook.com/${postId}`;

    logger.info("Facebook post published", { postId });
    return { postId, postUrl };
  }

  private async publishInstagram(
    accessToken: string,
    igBusinessAccountId: string,
    payload: SocialPostPayload
  ): Promise<SocialPostResult> {
    // Step 1: Create media container
    const containerParams: Record<string, string> = {
      caption: payload.caption,
      access_token: accessToken,
    };
    if (payload.imageUrl) {
      containerParams.image_url = payload.imageUrl;
    }

    const containerResponse = await fetch(
      `https://graph.facebook.com/v19.0/${igBusinessAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(containerParams).toString(),
      }
    );

    if (!containerResponse.ok) {
      const errorBody = await containerResponse.text().catch(() => "unknown");
      throw new Error(`Instagram container creation failed: ${containerResponse.status} ${errorBody}`);
    }

    const containerData = (await containerResponse.json()) as { id?: string };
    const containerId = containerData.id;
    if (!containerId) throw new Error("Instagram container ID missing");

    // Step 2: Publish container
    const publishResponse = await fetch(
      `https://graph.facebook.com/v19.0/${igBusinessAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: containerId,
          access_token: accessToken,
        }).toString(),
      }
    );

    if (!publishResponse.ok) {
      const errorBody = await publishResponse.text().catch(() => "unknown");
      throw new Error(`Instagram publish failed: ${publishResponse.status} ${errorBody}`);
    }

    const publishData = (await publishResponse.json()) as { id?: string };
    const postId = publishData.id || `ig_${Date.now()}`;
    const postUrl = `https://www.instagram.com/p/${postId}`;

    logger.info("Instagram post published", { postId });
    return { postId, postUrl };
  }
}

// --- Factory ---

export function getSocialProvider(
  channel: string,
  secrets: {
    linkedinClientId?: string;
    linkedinClientSecret?: string;
    xClientId?: string;
    xClientSecret?: string;
  }
): SocialPlatformProvider {
  switch (channel) {
    case "linkedin":
      if (!secrets.linkedinClientId || !secrets.linkedinClientSecret) {
        throw new Error("LinkedIn client credentials not configured");
      }
      return new LinkedInProvider(secrets.linkedinClientId, secrets.linkedinClientSecret);
    case "x":
      if (!secrets.xClientId || !secrets.xClientSecret) {
        throw new Error("X client credentials not configured");
      }
      return new XTwitterProvider(secrets.xClientId, secrets.xClientSecret);
    case "facebook":
      return new MetaProvider("facebook");
    case "instagram":
      return new MetaProvider("instagram");
    default:
      throw new Error(`Unsupported social platform: ${channel}`);
  }
}
