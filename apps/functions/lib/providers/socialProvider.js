"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaProvider = exports.XTwitterProvider = exports.LinkedInProvider = void 0;
exports.getSocialProvider = getSocialProvider;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
async function getVaultedToken(platform) {
    const db = admin.firestore();
    const snap = await db.collection("socialTokenVault").doc(platform).get();
    if (!snap.exists)
        return null;
    return snap.data();
}
async function updateVaultedToken(platform, updates) {
    const db = admin.firestore();
    await db.collection("socialTokenVault").doc(platform).set({ ...updates, updatedAt: Date.now() }, { merge: true });
}
// --- LinkedIn Provider ---
// Uses LinkedIn Marketing API v2 (Community Management API).
// Requires LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET secrets for token refresh.
// Access token stored in socialTokenVault/linkedin.
class LinkedInProvider {
    constructor(clientId, clientSecret) {
        this.platform = "linkedin";
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }
    async getAccessToken() {
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
            }
            catch (err) {
                logger.warn("LinkedIn token refresh failed, using existing token", { err });
            }
        }
        return {
            accessToken: vault.accessToken,
            orgUrn: vault.orgId ? `urn:li:organization:${vault.orgId}` : `urn:li:person:${vault.pageId || "me"}`,
        };
    }
    async refreshAccessToken(refreshToken) {
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
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
        };
    }
    async publish(payload) {
        const { accessToken, orgUrn } = await this.getAccessToken();
        const postBody = {
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
exports.LinkedInProvider = LinkedInProvider;
// --- X (Twitter) Provider ---
// Uses X API v2 with OAuth 2.0 User Context (PKCE flow).
// Requires X_CLIENT_ID and X_CLIENT_SECRET secrets for token refresh.
// Access token stored in socialTokenVault/x.
class XTwitterProvider {
    constructor(clientId, clientSecret) {
        this.platform = "x";
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }
    async getAccessToken() {
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
            }
            catch (err) {
                logger.warn("X token refresh failed, using existing token", { err });
            }
        }
        return vault.accessToken;
    }
    async refreshAccessToken(refreshToken) {
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
        const data = (await response.json());
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
        };
    }
    async publish(payload) {
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
        const data = (await response.json());
        const tweetId = data.data?.id || `x_${Date.now()}`;
        const postUrl = `https://x.com/i/status/${tweetId}`;
        logger.info("X post published", { tweetId, postUrl });
        return { postId: tweetId, postUrl };
    }
}
exports.XTwitterProvider = XTwitterProvider;
// --- Facebook / Instagram Provider ---
// Uses Meta Graph API. Access token stored in socialTokenVault/facebook or socialTokenVault/instagram.
class MetaProvider {
    constructor(platform) {
        this.pageAccessToken = null;
        this.pageId = null;
        this.platform = platform;
    }
    async getCredentials() {
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
    async publish(payload) {
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
        const data = (await response.json());
        const postId = data.id || `fb_${Date.now()}`;
        const postUrl = `https://www.facebook.com/${postId}`;
        logger.info("Facebook post published", { postId });
        return { postId, postUrl };
    }
    async publishInstagram(accessToken, igBusinessAccountId, payload) {
        // Step 1: Create media container
        const containerParams = {
            caption: payload.caption,
            access_token: accessToken,
        };
        if (payload.imageUrl) {
            containerParams.image_url = payload.imageUrl;
        }
        const containerResponse = await fetch(`https://graph.facebook.com/v19.0/${igBusinessAccountId}/media`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(containerParams).toString(),
        });
        if (!containerResponse.ok) {
            const errorBody = await containerResponse.text().catch(() => "unknown");
            throw new Error(`Instagram container creation failed: ${containerResponse.status} ${errorBody}`);
        }
        const containerData = (await containerResponse.json());
        const containerId = containerData.id;
        if (!containerId)
            throw new Error("Instagram container ID missing");
        // Step 2: Publish container
        const publishResponse = await fetch(`https://graph.facebook.com/v19.0/${igBusinessAccountId}/media_publish`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                creation_id: containerId,
                access_token: accessToken,
            }).toString(),
        });
        if (!publishResponse.ok) {
            const errorBody = await publishResponse.text().catch(() => "unknown");
            throw new Error(`Instagram publish failed: ${publishResponse.status} ${errorBody}`);
        }
        const publishData = (await publishResponse.json());
        const postId = publishData.id || `ig_${Date.now()}`;
        const postUrl = `https://www.instagram.com/p/${postId}`;
        logger.info("Instagram post published", { postId });
        return { postId, postUrl };
    }
}
exports.MetaProvider = MetaProvider;
// --- Factory ---
function getSocialProvider(channel, secrets) {
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
