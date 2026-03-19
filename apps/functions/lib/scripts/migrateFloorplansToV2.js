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
exports.migrateFloorplansToV2 = migrateFloorplansToV2;
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const storage = admin.storage();
const SHELL_TYPES = new Set([
    "WALL",
    "ROOM",
    "DOOR",
    "WINDOW",
    "STAIRS",
    "ELEVATOR",
    "BATHROOM",
    "COLUMN",
    "RECEPTION",
    "ENTRANCE",
    "EXIT",
    "FIRE_EXIT",
    "UTILITY",
]);
function toBuffer(dataUrl) {
    const parts = dataUrl.split(",");
    const raw = parts[1] ?? "";
    return Buffer.from(raw, "base64");
}
async function uploadLegacyBackground(locationId, floorId, dataUrl) {
    if (!dataUrl || !dataUrl.startsWith("data:")) {
        return {};
    }
    const bucket = storage.bucket();
    const storagePath = `floorplanBackgrounds/${locationId}/${floorId}/legacy-${Date.now()}.png`;
    const file = bucket.file(storagePath);
    await file.save(toBuffer(dataUrl), {
        metadata: {
            contentType: "image/png",
        },
        resumable: false,
    });
    const [downloadUrl] = await file.getSignedUrl({
        action: "read",
        expires: "2500-01-01",
    });
    return { storagePath, downloadUrl };
}
async function migrateFloorplansToV2(options) {
    const dryRun = options?.dryRun ?? false;
    const defaultLocationId = options?.defaultLocationId ?? "default";
    const defaultLocationName = options?.defaultLocationName ?? "Hi Coworking — Carrollton";
    const now = Date.now();
    const locationRef = db.collection("locations").doc(defaultLocationId);
    if (!dryRun) {
        await locationRef.set({
            id: defaultLocationId,
            name: defaultLocationName,
            slug: "hi-coworking-carrollton",
            address: "Carrollton, VA",
            timezone: "America/New_York",
            createdAt: now,
            updatedAt: now,
        }, { merge: true });
    }
    const legacySnap = await db.collection("floorplans").orderBy("levelIndex").get();
    if (legacySnap.empty) {
        console.log("[migrateFloorplansToV2] No legacy floorplans found.");
        return;
    }
    for (const doc of legacySnap.docs) {
        const floorplan = doc.data();
        const floorId = floorplan.id;
        const shellElements = [];
        const layoutElements = [];
        for (const el of floorplan.elements ?? []) {
            const normalized = {
                shape: "RECT",
                visible: true,
                ...el,
            };
            if (SHELL_TYPES.has(el.type)) {
                shellElements.push(normalized);
            }
            else {
                layoutElements.push(normalized);
            }
        }
        const { storagePath, downloadUrl } = await uploadLegacyBackground(defaultLocationId, floorId, floorplan.backgroundImageDataUrl);
        const floorRef = locationRef.collection("floors").doc(floorId);
        const shellRef = floorRef.collection("shell").doc("main");
        const layoutRef = floorRef.collection("layouts").doc("default");
        const floorPayload = {
            id: floorId,
            locationId: defaultLocationId,
            name: floorplan.name,
            levelIndex: floorplan.levelIndex,
            canvasWidth: floorplan.canvasWidth,
            canvasHeight: floorplan.canvasHeight,
            background: {
                storagePath: storagePath ?? null,
                downloadUrl: downloadUrl ?? null,
                opacity: 1,
                scale: 1,
                offsetX: 0,
                offsetY: 0,
                locked: true,
            },
        };
        const shellPayload = {
            id: "main",
            floorId,
            updatedAt: now,
            elements: shellElements,
        };
        const layoutPayload = {
            id: "default",
            floorId,
            name: "Default Layout",
            status: "PUBLISHED",
            updatedAt: now,
            elements: layoutElements,
        };
        if (dryRun) {
            console.log(`[migrateFloorplansToV2] DRY RUN floor=${floorId}`, {
                shellCount: shellElements.length,
                layoutCount: layoutElements.length,
            });
            continue;
        }
        await floorRef.set(floorPayload, { merge: true });
        await shellRef.set(shellPayload, { merge: true });
        await layoutRef.set(layoutPayload, { merge: true });
        console.log(`[migrateFloorplansToV2] Migrated floor=${floorId}`, {
            shellCount: shellElements.length,
            layoutCount: layoutElements.length,
        });
    }
}
if (require.main === module) {
    migrateFloorplansToV2()
        .then(() => {
        console.log("[migrateFloorplansToV2] Complete.");
        process.exit(0);
    })
        .catch((err) => {
        console.error("[migrateFloorplansToV2] Failed:", err);
        process.exit(1);
    });
}
