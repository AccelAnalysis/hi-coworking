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
exports.events_onMediaUploaded = void 0;
const storage_1 = require("firebase-functions/v2/storage");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() {
    return admin.firestore();
}
function parseEventMediaPath(path) {
    const match = path.match(/^event-media\/(events|series)\/([^/]+)\/(.+)$/);
    if (!match)
        return null;
    return {
        entityType: match[1],
        entityId: match[2],
        filename: match[3],
    };
}
function isImageContentType(contentType) {
    if (!contentType)
        return false;
    return contentType.startsWith("image/") && !contentType.includes("svg");
}
// Variant definitions for Sharp processing
const IMAGE_VARIANTS = [
    { name: "thumbnail", width: 300, height: 200, fit: "cover" },
    { name: "og", width: 1200, height: 630, fit: "cover" },
    { name: "square", width: 600, height: 600, fit: "cover" },
    { name: "card", width: 800, height: 450, fit: "cover" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateSignedUrl(bucket, storagePath) {
    const file = bucket.file(storagePath);
    const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });
    return url;
}
exports.events_onMediaUploaded = (0, storage_1.onObjectFinalized)({
    memory: "1GiB",
    cpu: 2,
}, async (event) => {
    const object = event.data;
    const storagePath = object.name;
    if (!storagePath)
        return;
    const parsed = parseEventMediaPath(storagePath);
    if (!parsed)
        return;
    // Skip variant files to avoid infinite loop
    if (storagePath.includes("/variants/"))
        return;
    const db = getDb();
    const bucket = admin.storage().bucket(object.bucket);
    const assetId = storagePath.replace(/\//g, "__");
    const now = Date.now();
    // Generate download URL for original
    let originalDownloadUrl;
    try {
        originalDownloadUrl = await generateSignedUrl(bucket, storagePath);
    }
    catch (err) {
        logger.warn("Failed to generate signed URL for original", { storagePath, err });
    }
    const variantsData = [
        {
            variant: "original",
            storagePath,
            downloadUrl: originalDownloadUrl,
        },
    ];
    // Process image variants with Sharp if it's an image
    let processingStatus = "complete";
    if (isImageContentType(object.contentType)) {
        try {
            const sharp = (await import("sharp")).default;
            const [sourceBuffer] = await bucket.file(storagePath).download();
            // Get original metadata
            const metadata = await sharp(sourceBuffer).metadata();
            variantsData[0].width = metadata.width;
            variantsData[0].height = metadata.height;
            for (const variant of IMAGE_VARIANTS) {
                const ext = object.contentType === "image/png" ? "png" : "webp";
                const variantPath = storagePath.replace(/\/([^/]+)$/, `/variants/${variant.name}.${ext}`);
                try {
                    let pipeline = sharp(sourceBuffer).resize(variant.width, variant.height, {
                        fit: variant.fit,
                        position: "center",
                        withoutEnlargement: true,
                    });
                    if (ext === "webp") {
                        pipeline = pipeline.webp({ quality: 85 });
                    }
                    else {
                        pipeline = pipeline.png({ quality: 90, compressionLevel: 8 });
                    }
                    const variantBuffer = await pipeline.toBuffer();
                    const variantFile = bucket.file(variantPath);
                    await variantFile.save(variantBuffer, {
                        contentType: ext === "webp" ? "image/webp" : "image/png",
                        metadata: {
                            cacheControl: "public, max-age=31536000",
                            metadata: {
                                sourceAsset: assetId,
                                variant: variant.name,
                            },
                        },
                    });
                    let variantDownloadUrl;
                    try {
                        variantDownloadUrl = await generateSignedUrl(bucket, variantPath);
                    }
                    catch {
                        // Non-critical: URL generation can fail
                    }
                    variantsData.push({
                        variant: variant.name,
                        storagePath: variantPath,
                        downloadUrl: variantDownloadUrl,
                        width: variant.width,
                        height: variant.height,
                    });
                    logger.info("Variant generated", { variant: variant.name, path: variantPath });
                }
                catch (variantErr) {
                    logger.error("Variant generation failed", { variant: variant.name, err: variantErr });
                }
            }
        }
        catch (sharpErr) {
            logger.error("Sharp processing failed", { storagePath, err: sharpErr });
            processingStatus = "sharp_failed";
        }
    }
    else {
        processingStatus = "not_image";
    }
    // Write asset document
    await db.collection("eventMediaAssets").doc(assetId).set({
        id: assetId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        bucket: object.bucket,
        storagePath,
        downloadUrl: originalDownloadUrl,
        contentType: object.contentType || null,
        size: Number(object.size || 0),
        uploadedAt: now,
        processingStatus,
        variants: variantsData,
    }, { merge: true });
    // Build rich media record with variant URLs
    const ogVariant = variantsData.find((v) => v.variant === "og");
    const thumbnailVariant = variantsData.find((v) => v.variant === "thumbnail");
    const mediaRecord = {
        storagePath,
        downloadUrl: originalDownloadUrl,
        alt: parsed.filename,
        width: variantsData[0].width,
        height: variantsData[0].height,
    };
    // Auto-wire hero images to events/series documents
    if (parsed.entityType === "events" && /^hero[-_]/i.test(parsed.filename)) {
        await db.collection("events").doc(parsed.entityId).set({
            heroImage: mediaRecord,
            ...(ogVariant?.downloadUrl ? { imageUrl: ogVariant.downloadUrl } : {}),
            updatedAt: now,
        }, { merge: true });
    }
    if (parsed.entityType === "series" && /^hero[-_]/i.test(parsed.filename)) {
        await db.collection("eventSeries").doc(parsed.entityId).set({
            heroImage: mediaRecord,
            updatedAt: now,
        }, { merge: true });
    }
    // Auto-wire gallery images
    if (/^gallery[-_]/i.test(parsed.filename)) {
        const collection = parsed.entityType === "events" ? "events" : "eventSeries";
        await db.collection(collection).doc(parsed.entityId).set({
            gallery: admin.firestore.FieldValue.arrayUnion(mediaRecord),
            updatedAt: now,
        }, { merge: true });
    }
    logger.info("Event media processed", {
        storagePath,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        processingStatus,
        variantCount: variantsData.length,
    });
});
