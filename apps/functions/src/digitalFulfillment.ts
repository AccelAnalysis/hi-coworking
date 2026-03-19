import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

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
export const bookstore_getDownloadLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to access digital content");
  }

  const { bookId } = request.data;
  if (!bookId) {
    throw new HttpsError("invalid-argument", "bookId is required");
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
    throw new HttpsError("permission-denied", "You have not purchased this book");
  }

  // 2. Get Book details for asset path
  const bookSnap = await db.collection("books").doc(bookId).get();
  if (!bookSnap.exists) {
    throw new HttpsError("not-found", "Book not found");
  }
  const book = bookSnap.data();
  
  const assetPath = book?.digitalAssetUrl;
  if (!assetPath) {
    throw new HttpsError("not-found", "No digital asset available for this book");
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
      throw new HttpsError("internal", "Asset file is missing");
    }

    // Generate signed URL valid for 1 hour
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    return { url };
  } catch (err) {
    logger.error("Failed to generate signed URL", { err });
    throw new HttpsError("internal", "Failed to generate download link");
  }
});
