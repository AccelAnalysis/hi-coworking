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
exports.bookstore_getDownloadLink = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
function getDb() {
    return admin.firestore();
}
function getStorage() {
    return admin.storage();
}
/**
 * Generate a secure download link for a digital product.
 * Verifies that the user has purchased the book (or is an admin).
 */
exports.bookstore_getDownloadLink = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in to access digital content");
    }
    const { bookId } = request.data;
    if (!bookId) {
        throw new https_1.HttpsError("invalid-argument", "bookId is required");
    }
    const uid = request.auth.uid;
    const db = getDb();
    // 1. Check if user owns the book
    // Check bookPurchases collection for userId == uid and bookId == bookId
    const purchasesSnap = await db.collection("bookPurchases")
        .where("userId", "==", uid)
        .where("bookId", "==", bookId)
        .limit(1)
        .get();
    const hasPurchased = !purchasesSnap.empty;
    // Also check if user is admin/master/staff
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const isAdmin = ["admin", "master", "staff"].includes(userData?.role);
    if (!hasPurchased && !isAdmin) {
        throw new https_1.HttpsError("permission-denied", "You have not purchased this book");
    }
    // 2. Get Book details for asset path
    const bookSnap = await db.collection("books").doc(bookId).get();
    if (!bookSnap.exists) {
        throw new https_1.HttpsError("not-found", "Book not found");
    }
    const book = bookSnap.data();
    const assetPath = book?.digitalAssetUrl;
    if (!assetPath) {
        throw new https_1.HttpsError("not-found", "No digital asset available for this book");
    }
    // 3. Generate Signed URL
    // If assetPath starts with http/https, return as is (insecure but supported for external links)
    if (assetPath.startsWith("http")) {
        return { url: assetPath };
    }
    // Assume it's a storage path
    try {
        const bucket = getStorage().bucket();
        // Handle potential 'gs://' prefix if admin copied full URL
        const cleanPath = assetPath.replace(/^gs:\/\/[^/]+\//, "");
        const file = bucket.file(cleanPath);
        const [exists] = await file.exists();
        if (!exists) {
            logger.error("Digital asset file missing", { bookId, assetPath: cleanPath });
            throw new https_1.HttpsError("internal", "Asset file is missing");
        }
        // Generate signed URL valid for 1 hour
        const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 60 * 60 * 1000,
        });
        return { url };
    }
    catch (err) {
        logger.error("Failed to generate signed URL", { err });
        throw new https_1.HttpsError("internal", "Failed to generate download link");
    }
});
