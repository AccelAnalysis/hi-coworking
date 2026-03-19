import * as admin from "firebase-admin";

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

type LegacyElement = {
  id: string;
  type: string;
  [key: string]: unknown;
};

type LegacyFloorplan = {
  id: string;
  name: string;
  levelIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  backgroundImageDataUrl?: string;
  elements: LegacyElement[];
};

function toBuffer(dataUrl: string): Buffer {
  const parts = dataUrl.split(",");
  const raw = parts[1] ?? "";
  return Buffer.from(raw, "base64");
}

async function uploadLegacyBackground(
  locationId: string,
  floorId: string,
  dataUrl?: string
): Promise<{ storagePath?: string; downloadUrl?: string }> {
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

export async function migrateFloorplansToV2(options?: {
  dryRun?: boolean;
  defaultLocationId?: string;
  defaultLocationName?: string;
}): Promise<void> {
  const dryRun = options?.dryRun ?? false;
  const defaultLocationId = options?.defaultLocationId ?? "default";
  const defaultLocationName = options?.defaultLocationName ?? "Hi Coworking — Carrollton";

  const now = Date.now();
  const locationRef = db.collection("locations").doc(defaultLocationId);

  if (!dryRun) {
    await locationRef.set(
      {
        id: defaultLocationId,
        name: defaultLocationName,
        slug: "hi-coworking-carrollton",
        address: "Carrollton, VA",
        timezone: "America/New_York",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  const legacySnap = await db.collection("floorplans").orderBy("levelIndex").get();
  if (legacySnap.empty) {
    console.log("[migrateFloorplansToV2] No legacy floorplans found.");
    return;
  }

  for (const doc of legacySnap.docs) {
    const floorplan = doc.data() as LegacyFloorplan;
    const floorId = floorplan.id;

    const shellElements: LegacyElement[] = [];
    const layoutElements: LegacyElement[] = [];

    for (const el of floorplan.elements ?? []) {
      const normalized = {
        shape: "RECT",
        visible: true,
        ...el,
      };
      if (SHELL_TYPES.has(el.type)) {
        shellElements.push(normalized);
      } else {
        layoutElements.push(normalized);
      }
    }

    const { storagePath, downloadUrl } = await uploadLegacyBackground(
      defaultLocationId,
      floorId,
      floorplan.backgroundImageDataUrl
    );

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
