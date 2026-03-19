import { z } from "zod";
export declare const doorTypeSchema: z.ZodEnum<{
    OPENING: "OPENING";
    STANDARD: "STANDARD";
    KEY_ENTRY: "KEY_ENTRY";
    SCAN_TO_ENTER: "SCAN_TO_ENTER";
    PIN_CODE: "PIN_CODE";
    PUSH_BAR: "PUSH_BAR";
    EMERGENCY_EXIT: "EMERGENCY_EXIT";
}>;
export type DoorType = z.infer<typeof doorTypeSchema>;
export declare const elementShapeSchema: z.ZodEnum<{
    RECT: "RECT";
    LINE: "LINE";
    POLY: "POLY";
    ICON: "ICON";
    TEXT: "TEXT";
}>;
export type ElementShape = z.infer<typeof elementShapeSchema>;
export declare const floorplanElementTypeSchema: z.ZodEnum<{
    WALL: "WALL";
    ROOM: "ROOM";
    DOOR: "DOOR";
    WINDOW: "WINDOW";
    STAIRS: "STAIRS";
    ELEVATOR: "ELEVATOR";
    BATHROOM: "BATHROOM";
    COLUMN: "COLUMN";
    RECEPTION: "RECEPTION";
    ENTRANCE: "ENTRANCE";
    EXIT: "EXIT";
    FIRE_EXIT: "FIRE_EXIT";
    UTILITY: "UTILITY";
    DESK: "DESK";
    SEAT: "SEAT";
    MODE_ZONE: "MODE_ZONE";
    AMENITY: "AMENITY";
    FURNITURE: "FURNITURE";
    SIGNAGE: "SIGNAGE";
    POWER: "POWER";
    ACCESS_READER: "ACCESS_READER";
    CAMERA: "CAMERA";
    FIRE_EXTINGUISHER: "FIRE_EXTINGUISHER";
    TRASH: "TRASH";
    PLANT: "PLANT";
}>;
export type FloorplanElementType = z.infer<typeof floorplanElementTypeSchema>;
export declare const floorplanElementSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<{
        WALL: "WALL";
        ROOM: "ROOM";
        DOOR: "DOOR";
        WINDOW: "WINDOW";
        STAIRS: "STAIRS";
        ELEVATOR: "ELEVATOR";
        BATHROOM: "BATHROOM";
        COLUMN: "COLUMN";
        RECEPTION: "RECEPTION";
        ENTRANCE: "ENTRANCE";
        EXIT: "EXIT";
        FIRE_EXIT: "FIRE_EXIT";
        UTILITY: "UTILITY";
        DESK: "DESK";
        SEAT: "SEAT";
        MODE_ZONE: "MODE_ZONE";
        AMENITY: "AMENITY";
        FURNITURE: "FURNITURE";
        SIGNAGE: "SIGNAGE";
        POWER: "POWER";
        ACCESS_READER: "ACCESS_READER";
        CAMERA: "CAMERA";
        FIRE_EXTINGUISHER: "FIRE_EXTINGUISHER";
        TRASH: "TRASH";
        PLANT: "PLANT";
    }>;
    shape: z.ZodOptional<z.ZodEnum<{
        RECT: "RECT";
        LINE: "LINE";
        POLY: "POLY";
        ICON: "ICON";
        TEXT: "TEXT";
    }>>;
    label: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    resourceId: z.ZodOptional<z.ZodString>;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodDefault<z.ZodNumber>;
    height: z.ZodDefault<z.ZodNumber>;
    rotation: z.ZodDefault<z.ZodNumber>;
    points: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    closed: z.ZodOptional<z.ZodBoolean>;
    fill: z.ZodOptional<z.ZodString>;
    stroke: z.ZodOptional<z.ZodString>;
    strokeWidth: z.ZodOptional<z.ZodNumber>;
    opacity: z.ZodOptional<z.ZodNumber>;
    locked: z.ZodOptional<z.ZodBoolean>;
    visible: z.ZodOptional<z.ZodBoolean>;
    zIndex: z.ZodOptional<z.ZodNumber>;
    groupId: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.core.$strip>;
export type FloorplanElement = z.infer<typeof floorplanElementSchema>;
export declare const shellElementTypeValues: readonly ["WALL", "ROOM", "DOOR", "WINDOW", "STAIRS", "ELEVATOR", "BATHROOM", "COLUMN", "RECEPTION", "ENTRANCE", "EXIT", "FIRE_EXIT", "UTILITY"];
export declare const layoutElementTypeValues: readonly ["DESK", "SEAT", "MODE_ZONE", "AMENITY", "FURNITURE", "SIGNAGE", "POWER", "ACCESS_READER", "CAMERA", "FIRE_EXTINGUISHER", "TRASH", "PLANT"];
export type ShellElementType = (typeof shellElementTypeValues)[number];
export type LayoutElementType = (typeof layoutElementTypeValues)[number];
export declare const SHELL_ELEMENT_TYPES: ReadonlyArray<ShellElementType>;
export declare const LAYOUT_ELEMENT_TYPES: ReadonlyArray<LayoutElementType>;
export declare function isShellType(type: FloorplanElementType): type is ShellElementType;
export declare function isLayoutType(type: FloorplanElementType): type is LayoutElementType;
export declare const floorBackgroundSchema: z.ZodObject<{
    storagePath: z.ZodOptional<z.ZodString>;
    downloadUrl: z.ZodOptional<z.ZodString>;
    opacity: z.ZodDefault<z.ZodNumber>;
    scale: z.ZodDefault<z.ZodNumber>;
    offsetX: z.ZodDefault<z.ZodNumber>;
    offsetY: z.ZodDefault<z.ZodNumber>;
    locked: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const locationDocSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    address: z.ZodOptional<z.ZodString>;
    timezone: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type LocationDoc = z.infer<typeof locationDocSchema>;
export declare const floorDocSchema: z.ZodObject<{
    id: z.ZodString;
    locationId: z.ZodString;
    name: z.ZodString;
    levelIndex: z.ZodNumber;
    canvasWidth: z.ZodNumber;
    canvasHeight: z.ZodNumber;
    background: z.ZodOptional<z.ZodObject<{
        storagePath: z.ZodOptional<z.ZodString>;
        downloadUrl: z.ZodOptional<z.ZodString>;
        opacity: z.ZodDefault<z.ZodNumber>;
        scale: z.ZodDefault<z.ZodNumber>;
        offsetX: z.ZodDefault<z.ZodNumber>;
        offsetY: z.ZodDefault<z.ZodNumber>;
        locked: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FloorDoc = z.infer<typeof floorDocSchema>;
export declare const shellDocSchema: z.ZodObject<{
    id: z.ZodString;
    floorId: z.ZodString;
    updatedAt: z.ZodNumber;
    updatedBy: z.ZodOptional<z.ZodString>;
    elements: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<{
            WALL: "WALL";
            ROOM: "ROOM";
            DOOR: "DOOR";
            WINDOW: "WINDOW";
            STAIRS: "STAIRS";
            ELEVATOR: "ELEVATOR";
            BATHROOM: "BATHROOM";
            COLUMN: "COLUMN";
            RECEPTION: "RECEPTION";
            ENTRANCE: "ENTRANCE";
            EXIT: "EXIT";
            FIRE_EXIT: "FIRE_EXIT";
            UTILITY: "UTILITY";
            DESK: "DESK";
            SEAT: "SEAT";
            MODE_ZONE: "MODE_ZONE";
            AMENITY: "AMENITY";
            FURNITURE: "FURNITURE";
            SIGNAGE: "SIGNAGE";
            POWER: "POWER";
            ACCESS_READER: "ACCESS_READER";
            CAMERA: "CAMERA";
            FIRE_EXTINGUISHER: "FIRE_EXTINGUISHER";
            TRASH: "TRASH";
            PLANT: "PLANT";
        }>;
        shape: z.ZodOptional<z.ZodEnum<{
            RECT: "RECT";
            LINE: "LINE";
            POLY: "POLY";
            ICON: "ICON";
            TEXT: "TEXT";
        }>>;
        label: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        resourceId: z.ZodOptional<z.ZodString>;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodDefault<z.ZodNumber>;
        height: z.ZodDefault<z.ZodNumber>;
        rotation: z.ZodDefault<z.ZodNumber>;
        points: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        closed: z.ZodOptional<z.ZodBoolean>;
        fill: z.ZodOptional<z.ZodString>;
        stroke: z.ZodOptional<z.ZodString>;
        strokeWidth: z.ZodOptional<z.ZodNumber>;
        opacity: z.ZodOptional<z.ZodNumber>;
        locked: z.ZodOptional<z.ZodBoolean>;
        visible: z.ZodOptional<z.ZodBoolean>;
        zIndex: z.ZodOptional<z.ZodNumber>;
        groupId: z.ZodOptional<z.ZodString>;
        meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ShellDoc = z.infer<typeof shellDocSchema>;
export declare const layoutVariantSchema: z.ZodObject<{
    id: z.ZodString;
    floorId: z.ZodString;
    name: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        DRAFT: "DRAFT";
        PUBLISHED: "PUBLISHED";
    }>>;
    updatedAt: z.ZodNumber;
    updatedBy: z.ZodOptional<z.ZodString>;
    effectiveRules: z.ZodOptional<z.ZodObject<{
        daysOfWeek: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        startTime: z.ZodOptional<z.ZodString>;
        endTime: z.ZodOptional<z.ZodString>;
        precedence: z.ZodDefault<z.ZodEnum<{
            OVERRIDE: "OVERRIDE";
            SCHEDULED: "SCHEDULED";
            DEFAULT: "DEFAULT";
        }>>;
        priority: z.ZodDefault<z.ZodNumber>;
        oneOffOverrideWindows: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            start: z.ZodNumber;
            end: z.ZodNumber;
            priority: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    elements: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<{
            WALL: "WALL";
            ROOM: "ROOM";
            DOOR: "DOOR";
            WINDOW: "WINDOW";
            STAIRS: "STAIRS";
            ELEVATOR: "ELEVATOR";
            BATHROOM: "BATHROOM";
            COLUMN: "COLUMN";
            RECEPTION: "RECEPTION";
            ENTRANCE: "ENTRANCE";
            EXIT: "EXIT";
            FIRE_EXIT: "FIRE_EXIT";
            UTILITY: "UTILITY";
            DESK: "DESK";
            SEAT: "SEAT";
            MODE_ZONE: "MODE_ZONE";
            AMENITY: "AMENITY";
            FURNITURE: "FURNITURE";
            SIGNAGE: "SIGNAGE";
            POWER: "POWER";
            ACCESS_READER: "ACCESS_READER";
            CAMERA: "CAMERA";
            FIRE_EXTINGUISHER: "FIRE_EXTINGUISHER";
            TRASH: "TRASH";
            PLANT: "PLANT";
        }>;
        shape: z.ZodOptional<z.ZodEnum<{
            RECT: "RECT";
            LINE: "LINE";
            POLY: "POLY";
            ICON: "ICON";
            TEXT: "TEXT";
        }>>;
        label: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        resourceId: z.ZodOptional<z.ZodString>;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodDefault<z.ZodNumber>;
        height: z.ZodDefault<z.ZodNumber>;
        rotation: z.ZodDefault<z.ZodNumber>;
        points: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        closed: z.ZodOptional<z.ZodBoolean>;
        fill: z.ZodOptional<z.ZodString>;
        stroke: z.ZodOptional<z.ZodString>;
        strokeWidth: z.ZodOptional<z.ZodNumber>;
        opacity: z.ZodOptional<z.ZodNumber>;
        locked: z.ZodOptional<z.ZodBoolean>;
        visible: z.ZodOptional<z.ZodBoolean>;
        zIndex: z.ZodOptional<z.ZodNumber>;
        groupId: z.ZodOptional<z.ZodString>;
        meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type LayoutVariant = z.infer<typeof layoutVariantSchema>;
/** @deprecated Use floorDocSchema + shellDocSchema + layoutVariantSchema instead. */
export declare const floorplanSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    levelIndex: z.ZodNumber;
    canvasWidth: z.ZodNumber;
    canvasHeight: z.ZodNumber;
    backgroundImageDataUrl: z.ZodOptional<z.ZodString>;
    elements: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<{
            WALL: "WALL";
            ROOM: "ROOM";
            DOOR: "DOOR";
            WINDOW: "WINDOW";
            STAIRS: "STAIRS";
            ELEVATOR: "ELEVATOR";
            BATHROOM: "BATHROOM";
            COLUMN: "COLUMN";
            RECEPTION: "RECEPTION";
            ENTRANCE: "ENTRANCE";
            EXIT: "EXIT";
            FIRE_EXIT: "FIRE_EXIT";
            UTILITY: "UTILITY";
            DESK: "DESK";
            SEAT: "SEAT";
            MODE_ZONE: "MODE_ZONE";
            AMENITY: "AMENITY";
            FURNITURE: "FURNITURE";
            SIGNAGE: "SIGNAGE";
            POWER: "POWER";
            ACCESS_READER: "ACCESS_READER";
            CAMERA: "CAMERA";
            FIRE_EXTINGUISHER: "FIRE_EXTINGUISHER";
            TRASH: "TRASH";
            PLANT: "PLANT";
        }>;
        shape: z.ZodOptional<z.ZodEnum<{
            RECT: "RECT";
            LINE: "LINE";
            POLY: "POLY";
            ICON: "ICON";
            TEXT: "TEXT";
        }>>;
        label: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        resourceId: z.ZodOptional<z.ZodString>;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodDefault<z.ZodNumber>;
        height: z.ZodDefault<z.ZodNumber>;
        rotation: z.ZodDefault<z.ZodNumber>;
        points: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        closed: z.ZodOptional<z.ZodBoolean>;
        fill: z.ZodOptional<z.ZodString>;
        stroke: z.ZodOptional<z.ZodString>;
        strokeWidth: z.ZodOptional<z.ZodNumber>;
        opacity: z.ZodOptional<z.ZodNumber>;
        locked: z.ZodOptional<z.ZodBoolean>;
        visible: z.ZodOptional<z.ZodBoolean>;
        zIndex: z.ZodOptional<z.ZodNumber>;
        groupId: z.ZodOptional<z.ZodString>;
        meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Floorplan = z.infer<typeof floorplanSchema>;
export declare const resourceTypeSchema: z.ZodEnum<{
    SEAT: "SEAT";
    MODE: "MODE";
}>;
export type ResourceType = z.infer<typeof resourceTypeSchema>;
export declare const resourceSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<{
        SEAT: "SEAT";
        MODE: "MODE";
    }>;
    exclusiveGroupId: z.ZodString;
    capacity: z.ZodNumber;
    guestRateHourly: z.ZodNumber;
}, z.core.$strip>;
export type Resource = z.infer<typeof resourceSchema>;
export declare const bookingStatusSchema: z.ZodEnum<{
    CONFIRMED: "CONFIRMED";
    PENDING: "PENDING";
    CANCELLED: "CANCELLED";
    COMPLETED: "COMPLETED";
}>;
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export declare const bookingSchema: z.ZodObject<{
    id: z.ZodString;
    locationId: z.ZodOptional<z.ZodString>;
    resourceId: z.ZodString;
    resourceName: z.ZodString;
    userId: z.ZodString;
    userName: z.ZodString;
    start: z.ZodNumber;
    end: z.ZodNumber;
    status: z.ZodEnum<{
        CONFIRMED: "CONFIRMED";
        PENDING: "PENDING";
        CANCELLED: "CANCELLED";
        COMPLETED: "COMPLETED";
    }>;
    totalPrice: z.ZodNumber;
    paymentMethod: z.ZodEnum<{
        STRIPE: "STRIPE";
        CREDITS: "CREDITS";
    }>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type Booking = z.infer<typeof bookingSchema>;
export declare const userRoleSchema: z.ZodEnum<{
    master: "master";
    admin: "admin";
    staff: "staff";
    member: "member";
    externalVendor: "externalVendor";
    econPartner: "econPartner";
}>;
export type UserRole = z.infer<typeof userRoleSchema>;
export declare const membershipStatusSchema: z.ZodEnum<{
    none: "none";
    trial: "trial";
    active: "active";
    pastDue: "pastDue";
    cancelled: "cancelled";
    expired: "expired";
}>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export declare const membershipTrackSchema: z.ZodEnum<{
    remote_worker: "remote_worker";
    capital_ready_founder: "capital_ready_founder";
    consultant: "consultant";
    service_provider: "service_provider";
}>;
export type MembershipTrack = z.infer<typeof membershipTrackSchema>;
export declare const userDocSchema: z.ZodObject<{
    uid: z.ZodString;
    email: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    role: z.ZodEnum<{
        master: "master";
        admin: "admin";
        staff: "staff";
        member: "member";
        externalVendor: "externalVendor";
        econPartner: "econPartner";
    }>;
    membershipStatus: z.ZodEnum<{
        none: "none";
        trial: "trial";
        active: "active";
        pastDue: "pastDue";
        cancelled: "cancelled";
        expired: "expired";
    }>;
    plan: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodNumber>;
    features: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    membershipTrack: z.ZodOptional<z.ZodEnum<{
        remote_worker: "remote_worker";
        capital_ready_founder: "capital_ready_founder";
        consultant: "consultant";
        service_provider: "service_provider";
    }>>;
    credits: z.ZodDefault<z.ZodNumber>;
    lifetimeCreditsPurchased: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type UserDoc = z.infer<typeof userDocSchema>;
export declare const orgDocSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    ownerUid: z.ZodString;
    logoUrl: z.ZodOptional<z.ZodString>;
    website: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    seatsPurchased: z.ZodDefault<z.ZodNumber>;
    seatsUsed: z.ZodDefault<z.ZodNumber>;
    billingEmail: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        suspended: "suspended";
    }>>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type OrgDoc = z.infer<typeof orgDocSchema>;
export declare const orgMemberDocSchema: z.ZodObject<{
    id: z.ZodString;
    orgId: z.ZodString;
    uid: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        member: "member";
        owner: "owner";
    }>;
    joinedAt: z.ZodNumber;
}, z.core.$strip>;
export type OrgMemberDoc = z.infer<typeof orgMemberDocSchema>;
export declare const profileDocSchema: z.ZodObject<{
    uid: z.ZodString;
    businessName: z.ZodOptional<z.ZodString>;
    bio: z.ZodOptional<z.ZodString>;
    naicsCodes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    certifications: z.ZodOptional<z.ZodArray<z.ZodString>>;
    uei: z.ZodOptional<z.ZodString>;
    duns: z.ZodOptional<z.ZodString>;
    cageCode: z.ZodOptional<z.ZodString>;
    capabilityStatementUrl: z.ZodOptional<z.ZodString>;
    photoUrl: z.ZodOptional<z.ZodString>;
    website: z.ZodOptional<z.ZodString>;
    linkedin: z.ZodOptional<z.ZodString>;
    profileCompletenessScore: z.ZodOptional<z.ZodNumber>;
    badges: z.ZodDefault<z.ZodArray<z.ZodString>>;
    trustStats: z.ZodOptional<z.ZodObject<{
        referralsConverted: z.ZodDefault<z.ZodNumber>;
        payoutsPlatformManaged: z.ZodDefault<z.ZodNumber>;
        payoutsOnTimeRate: z.ZodOptional<z.ZodNumber>;
        medianResponseTimeHours: z.ZodOptional<z.ZodNumber>;
        disputesOpened: z.ZodDefault<z.ZodNumber>;
        disputesLost: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    verificationStatus: z.ZodDefault<z.ZodEnum<{
        none: "none";
        pending: "pending";
        verified: "verified";
        rejected: "rejected";
    }>>;
    verificationSubmittedAt: z.ZodOptional<z.ZodNumber>;
    verificationReviewedAt: z.ZodOptional<z.ZodNumber>;
    verificationReviewedBy: z.ZodOptional<z.ZodString>;
    verificationRejectionReason: z.ZodOptional<z.ZodString>;
    enrichmentSource: z.ZodOptional<z.ZodEnum<{
        sam_gov: "sam_gov";
        usaspending: "usaspending";
        manual: "manual";
    }>>;
    enrichmentMatchId: z.ZodOptional<z.ZodString>;
    enrichmentData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    enrichmentLinkedAt: z.ZodOptional<z.ZodNumber>;
    attestationText: z.ZodOptional<z.ZodString>;
    attestationTimestamp: z.ZodOptional<z.ZodNumber>;
    attestationAcknowledgedConsequences: z.ZodOptional<z.ZodBoolean>;
    readinessTier: z.ZodOptional<z.ZodEnum<{
        seat_ready: "seat_ready";
        bid_ready: "bid_ready";
        procurement_ready: "procurement_ready";
    }>>;
    videoIntroUrl: z.ZodOptional<z.ZodString>;
    videoIntroPosterUrl: z.ZodOptional<z.ZodString>;
    videoIntroDurationSec: z.ZodOptional<z.ZodNumber>;
    videoIntroStatus: z.ZodOptional<z.ZodEnum<{
        processing: "processing";
        ready: "ready";
        failed: "failed";
    }>>;
    published: z.ZodDefault<z.ZodBoolean>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ProfileDoc = z.infer<typeof profileDocSchema>;
export declare const profileReadinessTierSchema: z.ZodEnum<{
    seat_ready: "seat_ready";
    bid_ready: "bid_ready";
    procurement_ready: "procurement_ready";
}>;
export type ProfileReadinessTier = z.infer<typeof profileReadinessTierSchema>;
/**
 * Readiness progression:
 * - seat_ready: baseline profile stage
 * - bid_ready: verification complete + capability statement present
 * - procurement_ready: bid_ready + enrichment linked + completeness >= 70 + trust stats present
 */
export declare function computeReadinessTier(profile: Partial<ProfileDoc> | null): ProfileReadinessTier;
export declare const territoryStatusSchema: z.ZodEnum<{
    scheduled: "scheduled";
    released: "released";
    paused: "paused";
    archived: "archived";
}>;
export type TerritoryStatus = z.infer<typeof territoryStatusSchema>;
export declare const territoryDocSchema: z.ZodObject<{
    fips: z.ZodString;
    name: z.ZodString;
    state: z.ZodString;
    status: z.ZodEnum<{
        scheduled: "scheduled";
        released: "released";
        paused: "paused";
        archived: "archived";
    }>;
    releaseDate: z.ZodOptional<z.ZodNumber>;
    pausedAt: z.ZodOptional<z.ZodNumber>;
    notes: z.ZodOptional<z.ZodString>;
    boundaryGeoJSON: z.ZodOptional<z.ZodAny>;
    centroid: z.ZodOptional<z.ZodObject<{
        lat: z.ZodNumber;
        lng: z.ZodNumber;
    }, z.core.$strip>>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type TerritoryDoc = z.infer<typeof territoryDocSchema>;
export declare const verificationDocTypeSchema: z.ZodEnum<{
    business_license: "business_license";
    ein_letter: "ein_letter";
    utility_bill: "utility_bill";
    government_id: "government_id";
    other: "other";
}>;
export type VerificationDocType = z.infer<typeof verificationDocTypeSchema>;
export declare const verificationDocumentStatusSchema: z.ZodEnum<{
    pending: "pending";
    rejected: "rejected";
    approved: "approved";
}>;
export type VerificationDocumentStatus = z.infer<typeof verificationDocumentStatusSchema>;
export declare const verificationDocumentSchema: z.ZodObject<{
    id: z.ZodString;
    uid: z.ZodString;
    type: z.ZodEnum<{
        business_license: "business_license";
        ein_letter: "ein_letter";
        utility_bill: "utility_bill";
        government_id: "government_id";
        other: "other";
    }>;
    label: z.ZodString;
    storagePath: z.ZodString;
    downloadUrl: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        rejected: "rejected";
        approved: "approved";
    }>>;
    reviewNote: z.ZodOptional<z.ZodString>;
    uploadedAt: z.ZodNumber;
    reviewedAt: z.ZodOptional<z.ZodNumber>;
    reviewedBy: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type VerificationDocument = z.infer<typeof verificationDocumentSchema>;
export declare const verificationAuditActionSchema: z.ZodEnum<{
    enrichment_linked: "enrichment_linked";
    attestation_signed: "attestation_signed";
    doc_uploaded: "doc_uploaded";
    doc_approved: "doc_approved";
    doc_rejected: "doc_rejected";
    status_changed: "status_changed";
    flag_suspicious: "flag_suspicious";
}>;
export type VerificationAuditAction = z.infer<typeof verificationAuditActionSchema>;
export declare const verificationAuditEntrySchema: z.ZodObject<{
    id: z.ZodString;
    uid: z.ZodString;
    action: z.ZodEnum<{
        enrichment_linked: "enrichment_linked";
        attestation_signed: "attestation_signed";
        doc_uploaded: "doc_uploaded";
        doc_approved: "doc_approved";
        doc_rejected: "doc_rejected";
        status_changed: "status_changed";
        flag_suspicious: "flag_suspicious";
    }>;
    performedBy: z.ZodString;
    details: z.ZodOptional<z.ZodString>;
    previousValue: z.ZodOptional<z.ZodString>;
    newValue: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type VerificationAuditEntry = z.infer<typeof verificationAuditEntrySchema>;
export interface TransactCheckInput {
    userRole?: UserRole;
    verificationStatus?: ProfileDoc["verificationStatus"];
    territoryStatus?: TerritoryStatus;
    allowAdminBypass?: boolean;
    permittedRoles?: UserRole[];
}
export interface TransactCheckResult {
    allowed: boolean;
    reasons: string[];
}
/**
 * Centralized transact gate:
 * - territory must be released
 * - company/profile must be verified
 * - role must be permitted
 * Admin/master can bypass by default.
 */
export declare function canTransact(input: TransactCheckInput): TransactCheckResult;
export declare const rfxStatusSchema: z.ZodEnum<{
    closed: "closed";
    cancelled: "cancelled";
    draft: "draft";
    under_review: "under_review";
    open: "open";
    awarded: "awarded";
}>;
export type RfxStatus = z.infer<typeof rfxStatusSchema>;
export declare const rfxAdminApprovalSchema: z.ZodEnum<{
    pending: "pending";
    rejected: "rejected";
    approved: "approved";
}>;
export type RfxAdminApproval = z.infer<typeof rfxAdminApprovalSchema>;
/** Direction for scoring: lower-is-better (price/timeline) vs higher-is-better (experience) */
export declare const scoringDirectionSchema: z.ZodEnum<{
    lower_is_better: "lower_is_better";
    higher_is_better: "higher_is_better";
}>;
export type ScoringDirection = z.infer<typeof scoringDirectionSchema>;
export declare const evaluationCriterionSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    weight: z.ZodNumber;
    direction: z.ZodEnum<{
        lower_is_better: "lower_is_better";
        higher_is_better: "higher_is_better";
    }>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EvaluationCriterion = z.infer<typeof evaluationCriterionSchema>;
/** Document that the issuer requests vendors to upload */
export declare const requestedDocumentSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    required: z.ZodDefault<z.ZodBoolean>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RequestedDocument = z.infer<typeof requestedDocumentSchema>;
export declare const rfxDocSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    naicsCodes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    location: z.ZodOptional<z.ZodString>;
    geo: z.ZodOptional<z.ZodObject<{
        lat: z.ZodNumber;
        lng: z.ZodNumber;
        geohash: z.ZodString;
    }, z.core.$strip>>;
    territoryFips: z.ZodOptional<z.ZodString>;
    dueDate: z.ZodOptional<z.ZodNumber>;
    budget: z.ZodOptional<z.ZodString>;
    memberOnly: z.ZodDefault<z.ZodBoolean>;
    status: z.ZodEnum<{
        closed: "closed";
        cancelled: "cancelled";
        draft: "draft";
        under_review: "under_review";
        open: "open";
        awarded: "awarded";
    }>;
    createdBy: z.ZodString;
    createdByName: z.ZodOptional<z.ZodString>;
    template: z.ZodOptional<z.ZodString>;
    evaluationCriteria: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        weight: z.ZodNumber;
        direction: z.ZodEnum<{
            lower_is_better: "lower_is_better";
            higher_is_better: "higher_is_better";
        }>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    requestedDocuments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        required: z.ZodDefault<z.ZodBoolean>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    adminApprovalStatus: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        rejected: "rejected";
        approved: "approved";
    }>>;
    adminReviewNote: z.ZodOptional<z.ZodString>;
    responseCount: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type RfxDoc = z.infer<typeof rfxDocSchema>;
export declare const rfxResponseStatusSchema: z.ZodEnum<{
    pending: "pending";
    accepted: "accepted";
    declined: "declined";
}>;
export type RfxResponseStatus = z.infer<typeof rfxResponseStatusSchema>;
/** A single uploaded document matching a requestedDocument */
export declare const uploadedDocumentSchema: z.ZodObject<{
    requestedDocId: z.ZodString;
    label: z.ZodString;
    url: z.ZodString;
    fileName: z.ZodString;
}, z.core.$strip>;
export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>;
export declare const rfxResponseDocSchema: z.ZodObject<{
    id: z.ZodString;
    rfxId: z.ZodString;
    rfxOwnerUid: z.ZodString;
    respondentUid: z.ZodString;
    respondentName: z.ZodOptional<z.ZodString>;
    respondentBusinessName: z.ZodOptional<z.ZodString>;
    bidAmount: z.ZodOptional<z.ZodNumber>;
    experience: z.ZodOptional<z.ZodNumber>;
    timeline: z.ZodOptional<z.ZodNumber>;
    skills: z.ZodOptional<z.ZodString>;
    pastPerformance: z.ZodOptional<z.ZodString>;
    credentials: z.ZodOptional<z.ZodArray<z.ZodString>>;
    references: z.ZodOptional<z.ZodString>;
    proposalText: z.ZodOptional<z.ZodString>;
    proposalUrl: z.ZodOptional<z.ZodString>;
    uploadedDocuments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        requestedDocId: z.ZodString;
        label: z.ZodString;
        url: z.ZodString;
        fileName: z.ZodString;
    }, z.core.$strip>>>;
    criteriaScores: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    totalScore: z.ZodOptional<z.ZodNumber>;
    status: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        accepted: "accepted";
        declined: "declined";
    }>>;
    submittedAt: z.ZodNumber;
}, z.core.$strip>;
export type RfxResponseDoc = z.infer<typeof rfxResponseDocSchema>;
export interface RfxTemplate {
    id: string;
    name: string;
    description: string;
    category: string;
    defaultTitle: string;
    defaultDescription: string;
    defaultCriteria: EvaluationCriterion[];
    defaultDocuments: RequestedDocument[];
    suggestedNaics: string[];
}
export declare const RFX_TEMPLATES: RfxTemplate[];
/**
 * Compute the score for a single criterion given a set of response values.
 * For "lower_is_better": score = (max - value) / (max - min) * 100
 * For "higher_is_better": score = (value - min) / (max - min) * 100
 * If all values are equal, score = 100 for everyone.
 */
export declare function computeCriterionScore(value: number, allValues: number[], direction: ScoringDirection): number;
/**
 * Compute weighted total score for a response given criteria and all responses' numeric values.
 * Returns { criteriaScores, totalScore }.
 */
export declare function computeRfxScores(responseValues: Record<string, number>, allResponsesValues: Record<string, number>[], criteria: EvaluationCriterion[]): {
    criteriaScores: Record<string, number>;
    totalScore: number;
};
export declare const referralPolicyTemplateSchema: z.ZodEnum<{
    flat_fee: "flat_fee";
    percentage_first_invoice: "percentage_first_invoice";
    recurring: "recurring";
    tiered: "tiered";
}>;
export type ReferralPolicyTemplate = z.infer<typeof referralPolicyTemplateSchema>;
export declare const referralPolicyDocSchema: z.ZodObject<{
    id: z.ZodString;
    uid: z.ZodString;
    acceptingReferrals: z.ZodDefault<z.ZodBoolean>;
    template: z.ZodEnum<{
        flat_fee: "flat_fee";
        percentage_first_invoice: "percentage_first_invoice";
        recurring: "recurring";
        tiered: "tiered";
    }>;
    terms: z.ZodString;
    attributionWindowDays: z.ZodDefault<z.ZodNumber>;
    payoutTrigger: z.ZodString;
    customTerms: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ReferralPolicyDoc = z.infer<typeof referralPolicyDocSchema>;
export declare const referralDisputeDocSchema: z.ZodObject<{
    id: z.ZodString;
    referralId: z.ZodString;
    openerUid: z.ZodString;
    reason: z.ZodString;
    evidenceUrls: z.ZodDefault<z.ZodArray<z.ZodString>>;
    status: z.ZodEnum<{
        under_review: "under_review";
        open: "open";
        resolved_upheld: "resolved_upheld";
        resolved_dismissed: "resolved_dismissed";
    }>;
    adminNotes: z.ZodOptional<z.ZodString>;
    resolutionAt: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type ReferralDisputeDoc = z.infer<typeof referralDisputeDocSchema>;
export declare const referralStatusSchema: z.ZodEnum<{
    expired: "expired";
    pending: "pending";
    accepted: "accepted";
    declined: "declined";
    contacted: "contacted";
    converted: "converted";
    disputed: "disputed";
    paid: "paid";
}>;
export type ReferralStatus = z.infer<typeof referralStatusSchema>;
export declare const referralTypeSchema: z.ZodEnum<{
    platform_invite: "platform_invite";
    business_intro: "business_intro";
}>;
export type ReferralType = z.infer<typeof referralTypeSchema>;
export declare const referralDocSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodDefault<z.ZodEnum<{
        platform_invite: "platform_invite";
        business_intro: "business_intro";
    }>>;
    referrerUid: z.ZodString;
    referredEmail: z.ZodOptional<z.ZodString>;
    referredName: z.ZodOptional<z.ZodString>;
    providerUid: z.ZodOptional<z.ZodString>;
    clientName: z.ZodOptional<z.ZodString>;
    clientEmail: z.ZodOptional<z.ZodString>;
    clientPhone: z.ZodOptional<z.ZodString>;
    clientCompany: z.ZodOptional<z.ZodString>;
    policySnapshot: z.ZodOptional<z.ZodObject<{
        template: z.ZodEnum<{
            flat_fee: "flat_fee";
            percentage_first_invoice: "percentage_first_invoice";
            recurring: "recurring";
            tiered: "tiered";
        }>;
        terms: z.ZodString;
        amountCents: z.ZodOptional<z.ZodNumber>;
        percentage: z.ZodOptional<z.ZodNumber>;
        currency: z.ZodDefault<z.ZodString>;
        attributionWindowDays: z.ZodDefault<z.ZodNumber>;
        payoutTrigger: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        expired: "expired";
        pending: "pending";
        accepted: "accepted";
        declined: "declined";
        contacted: "contacted";
        converted: "converted";
        disputed: "disputed";
        paid: "paid";
    }>;
    note: z.ZodOptional<z.ZodString>;
    viewedByProvider: z.ZodDefault<z.ZodBoolean>;
    acceptedAt: z.ZodOptional<z.ZodNumber>;
    convertedAt: z.ZodOptional<z.ZodNumber>;
    paidAt: z.ZodOptional<z.ZodNumber>;
    payoutMethod: z.ZodOptional<z.ZodEnum<{
        manual: "manual";
        platform: "platform";
    }>>;
    payoutProofUrl: z.ZodOptional<z.ZodString>;
    payoutPaymentId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ReferralDoc = z.infer<typeof referralDocSchema>;
export declare const eventStatusSchema: z.ZodEnum<{
    cancelled: "cancelled";
    published: "published";
    draft: "draft";
    completed: "completed";
}>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export declare const eventFormatSchema: z.ZodEnum<{
    "in-person": "in-person";
    virtual: "virtual";
    hybrid: "hybrid";
}>;
export type EventFormat = z.infer<typeof eventFormatSchema>;
export declare const eventTicketTypeSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    priceCents: z.ZodNumber;
    quantity: z.ZodOptional<z.ZodNumber>;
    soldCount: z.ZodDefault<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    targetAudience: z.ZodDefault<z.ZodEnum<{
        member: "member";
        public: "public";
        vip: "vip";
    }>>;
}, z.core.$strip>;
export type EventTicketType = z.infer<typeof eventTicketTypeSchema>;
export declare const eventSponsorshipTierSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    priceCents: z.ZodNumber;
    slots: z.ZodNumber;
    soldCount: z.ZodDefault<z.ZodNumber>;
    benefits: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type EventSponsorshipTier = z.infer<typeof eventSponsorshipTierSchema>;
export declare const eventMediaImageSchema: z.ZodObject<{
    storagePath: z.ZodString;
    downloadUrl: z.ZodOptional<z.ZodString>;
    alt: z.ZodString;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type EventMediaImage = z.infer<typeof eventMediaImageSchema>;
export declare const eventPromoVideoSchema: z.ZodObject<{
    type: z.ZodEnum<{
        upload: "upload";
        youtube: "youtube";
        vimeo: "vimeo";
    }>;
    url: z.ZodOptional<z.ZodString>;
    storagePath: z.ZodOptional<z.ZodString>;
    thumbnail: z.ZodOptional<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type EventPromoVideo = z.infer<typeof eventPromoVideoSchema>;
export declare const eventSpeakerCardSchema: z.ZodObject<{
    name: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    headshotImage: z.ZodOptional<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    socials: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type EventSpeakerCard = z.infer<typeof eventSpeakerCardSchema>;
export declare const eventAudienceRulesSchema: z.ZodObject<{
    membershipTiers: z.ZodDefault<z.ZodArray<z.ZodString>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    interests: z.ZodDefault<z.ZodArray<z.ZodString>>;
    proximityRadiusMiles: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type EventAudienceRules = z.infer<typeof eventAudienceRulesSchema>;
export declare const eventCampaignSummarySchema: z.ZodObject<{
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        scheduled: "scheduled";
        paused: "paused";
        draft: "draft";
        completed: "completed";
    }>>;
    schedule: z.ZodOptional<z.ZodObject<{
        announceAt: z.ZodOptional<z.ZodNumber>;
        reminderAt7d: z.ZodOptional<z.ZodNumber>;
        reminderAt1d: z.ZodOptional<z.ZodNumber>;
        reminderAt1h: z.ZodOptional<z.ZodNumber>;
        followUpAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    channels: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        email: "email";
        push: "push";
        sms: "sms";
        in_app: "in_app";
        social: "social";
    }>>>;
    copyVariants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    utmBase: z.ZodOptional<z.ZodObject<{
        source: z.ZodOptional<z.ZodString>;
        medium: z.ZodOptional<z.ZodString>;
        campaign: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type EventCampaignSummary = z.infer<typeof eventCampaignSummarySchema>;
export declare const eventSeriesDocSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    format: z.ZodEnum<{
        "in-person": "in-person";
        virtual: "virtual";
        hybrid: "hybrid";
    }>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        published: "published";
        draft: "draft";
        completed: "completed";
    }>;
    timezone: z.ZodDefault<z.ZodString>;
    rrule: z.ZodOptional<z.ZodString>;
    startTimeOfDay: z.ZodOptional<z.ZodString>;
    durationMins: z.ZodOptional<z.ZodNumber>;
    seriesStartDate: z.ZodOptional<z.ZodNumber>;
    seriesEndDate: z.ZodOptional<z.ZodNumber>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    overrides: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>>>;
    location: z.ZodOptional<z.ZodString>;
    virtualUrl: z.ZodOptional<z.ZodString>;
    seatCap: z.ZodOptional<z.ZodNumber>;
    price: z.ZodDefault<z.ZodNumber>;
    currency: z.ZodDefault<z.ZodString>;
    linkedRfxId: z.ZodOptional<z.ZodString>;
    recordingUrl: z.ZodOptional<z.ZodString>;
    ticketTypes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceCents: z.ZodNumber;
        quantity: z.ZodOptional<z.ZodNumber>;
        soldCount: z.ZodDefault<z.ZodNumber>;
        description: z.ZodOptional<z.ZodString>;
        targetAudience: z.ZodDefault<z.ZodEnum<{
            member: "member";
            public: "public";
            vip: "vip";
        }>>;
    }, z.core.$strip>>>;
    sponsorships: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceCents: z.ZodNumber;
        slots: z.ZodNumber;
        soldCount: z.ZodDefault<z.ZodNumber>;
        benefits: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>>;
    allowVendorTables: z.ZodDefault<z.ZodBoolean>;
    vendorTablePriceCents: z.ZodOptional<z.ZodNumber>;
    upsellProducts: z.ZodDefault<z.ZodArray<z.ZodString>>;
    heroImage: z.ZodOptional<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    gallery: z.ZodDefault<z.ZodArray<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    promoVideo: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            upload: "upload";
            youtube: "youtube";
            vimeo: "vimeo";
        }>;
        url: z.ZodOptional<z.ZodString>;
        storagePath: z.ZodOptional<z.ZodString>;
        thumbnail: z.ZodOptional<z.ZodObject<{
            storagePath: z.ZodString;
            downloadUrl: z.ZodOptional<z.ZodString>;
            alt: z.ZodString;
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    speakerCards: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        headshotImage: z.ZodOptional<z.ZodObject<{
            storagePath: z.ZodString;
            downloadUrl: z.ZodOptional<z.ZodString>;
            alt: z.ZodString;
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        socials: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>>;
    sponsorLogos: z.ZodDefault<z.ZodArray<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    topics: z.ZodDefault<z.ZodArray<z.ZodString>>;
    audienceRules: z.ZodOptional<z.ZodObject<{
        membershipTiers: z.ZodDefault<z.ZodArray<z.ZodString>>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        interests: z.ZodDefault<z.ZodArray<z.ZodString>>;
        proximityRadiusMiles: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    campaign: z.ZodOptional<z.ZodObject<{
        status: z.ZodDefault<z.ZodEnum<{
            active: "active";
            scheduled: "scheduled";
            paused: "paused";
            draft: "draft";
            completed: "completed";
        }>>;
        schedule: z.ZodOptional<z.ZodObject<{
            announceAt: z.ZodOptional<z.ZodNumber>;
            reminderAt7d: z.ZodOptional<z.ZodNumber>;
            reminderAt1d: z.ZodOptional<z.ZodNumber>;
            reminderAt1h: z.ZodOptional<z.ZodNumber>;
            followUpAt: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        channels: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            email: "email";
            push: "push";
            sms: "sms";
            in_app: "in_app";
            social: "social";
        }>>>;
        copyVariants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        utmBase: z.ZodOptional<z.ZodObject<{
            source: z.ZodOptional<z.ZodString>;
            medium: z.ZodOptional<z.ZodString>;
            campaign: z.ZodOptional<z.ZodString>;
            content: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    createdBy: z.ZodString;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type EventSeriesDoc = z.infer<typeof eventSeriesDocSchema>;
export declare const eventDocSchema: z.ZodObject<{
    id: z.ZodString;
    seriesId: z.ZodOptional<z.ZodString>;
    occurrenceDate: z.ZodOptional<z.ZodNumber>;
    isOverride: z.ZodDefault<z.ZodBoolean>;
    occurrenceStartTime: z.ZodOptional<z.ZodNumber>;
    occurrenceEndTime: z.ZodOptional<z.ZodNumber>;
    title: z.ZodString;
    description: z.ZodString;
    format: z.ZodEnum<{
        "in-person": "in-person";
        virtual: "virtual";
        hybrid: "hybrid";
    }>;
    location: z.ZodOptional<z.ZodString>;
    virtualUrl: z.ZodOptional<z.ZodString>;
    startTime: z.ZodNumber;
    endTime: z.ZodNumber;
    seatCap: z.ZodOptional<z.ZodNumber>;
    registrationCount: z.ZodDefault<z.ZodNumber>;
    price: z.ZodDefault<z.ZodNumber>;
    currency: z.ZodDefault<z.ZodString>;
    imageUrl: z.ZodOptional<z.ZodString>;
    heroImage: z.ZodOptional<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    gallery: z.ZodDefault<z.ZodArray<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    promoVideo: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            upload: "upload";
            youtube: "youtube";
            vimeo: "vimeo";
        }>;
        url: z.ZodOptional<z.ZodString>;
        storagePath: z.ZodOptional<z.ZodString>;
        thumbnail: z.ZodOptional<z.ZodObject<{
            storagePath: z.ZodString;
            downloadUrl: z.ZodOptional<z.ZodString>;
            alt: z.ZodString;
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    speakerCards: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        headshotImage: z.ZodOptional<z.ZodObject<{
            storagePath: z.ZodString;
            downloadUrl: z.ZodOptional<z.ZodString>;
            alt: z.ZodString;
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        socials: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>>;
    sponsorLogos: z.ZodDefault<z.ZodArray<z.ZodObject<{
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
        alt: z.ZodString;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    linkedRfxId: z.ZodOptional<z.ZodString>;
    recordingUrl: z.ZodOptional<z.ZodString>;
    topics: z.ZodDefault<z.ZodArray<z.ZodString>>;
    audienceRules: z.ZodOptional<z.ZodObject<{
        membershipTiers: z.ZodDefault<z.ZodArray<z.ZodString>>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        interests: z.ZodDefault<z.ZodArray<z.ZodString>>;
        proximityRadiusMiles: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    campaign: z.ZodOptional<z.ZodObject<{
        status: z.ZodDefault<z.ZodEnum<{
            active: "active";
            scheduled: "scheduled";
            paused: "paused";
            draft: "draft";
            completed: "completed";
        }>>;
        schedule: z.ZodOptional<z.ZodObject<{
            announceAt: z.ZodOptional<z.ZodNumber>;
            reminderAt7d: z.ZodOptional<z.ZodNumber>;
            reminderAt1d: z.ZodOptional<z.ZodNumber>;
            reminderAt1h: z.ZodOptional<z.ZodNumber>;
            followUpAt: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        channels: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            email: "email";
            push: "push";
            sms: "sms";
            in_app: "in_app";
            social: "social";
        }>>>;
        copyVariants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        utmBase: z.ZodOptional<z.ZodObject<{
            source: z.ZodOptional<z.ZodString>;
            medium: z.ZodOptional<z.ZodString>;
            campaign: z.ZodOptional<z.ZodString>;
            content: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        published: "published";
        draft: "draft";
        completed: "completed";
    }>;
    ticketTypes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceCents: z.ZodNumber;
        quantity: z.ZodOptional<z.ZodNumber>;
        soldCount: z.ZodDefault<z.ZodNumber>;
        description: z.ZodOptional<z.ZodString>;
        targetAudience: z.ZodDefault<z.ZodEnum<{
            member: "member";
            public: "public";
            vip: "vip";
        }>>;
    }, z.core.$strip>>>;
    sponsorships: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceCents: z.ZodNumber;
        slots: z.ZodNumber;
        soldCount: z.ZodDefault<z.ZodNumber>;
        benefits: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>>;
    allowVendorTables: z.ZodDefault<z.ZodBoolean>;
    vendorTablePriceCents: z.ZodOptional<z.ZodNumber>;
    upsellProducts: z.ZodDefault<z.ZodArray<z.ZodString>>;
    createdBy: z.ZodString;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type EventDoc = z.infer<typeof eventDocSchema>;
export declare const eventRegistrationDocSchema: z.ZodObject<{
    uid: z.ZodString;
    eventId: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    registeredAt: z.ZodNumber;
    paymentId: z.ZodOptional<z.ZodString>;
    ticketTypeId: z.ZodOptional<z.ZodString>;
    quantity: z.ZodDefault<z.ZodNumber>;
    amountPaidCents: z.ZodOptional<z.ZodNumber>;
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        cancelled: "cancelled";
        refunded: "refunded";
    }>>;
    registrationSource: z.ZodOptional<z.ZodObject<{
        utmSource: z.ZodOptional<z.ZodString>;
        utmMedium: z.ZodOptional<z.ZodString>;
        utmCampaign: z.ZodOptional<z.ZodString>;
        utmContent: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    checkedInAt: z.ZodOptional<z.ZodNumber>;
    checkInToken: z.ZodOptional<z.ZodString>;
    waitlistPromotedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type EventRegistrationDoc = z.infer<typeof eventRegistrationDocSchema>;
export declare const eventWaitlistEntryDocSchema: z.ZodObject<{
    uid: z.ZodString;
    eventId: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    joinedAt: z.ZodNumber;
    status: z.ZodDefault<z.ZodEnum<{
        expired: "expired";
        waiting: "waiting";
        notified: "notified";
        claimed: "claimed";
        removed: "removed";
    }>>;
    notifiedAt: z.ZodOptional<z.ZodNumber>;
    claimExpiresAt: z.ZodOptional<z.ZodNumber>;
    notificationToken: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EventWaitlistEntryDoc = z.infer<typeof eventWaitlistEntryDocSchema>;
export declare const eventCampaignDocSchema: z.ZodObject<{
    id: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    seriesId: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        scheduled: "scheduled";
        paused: "paused";
        draft: "draft";
        completed: "completed";
    }>>;
    channels: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        email: "email";
        push: "push";
        sms: "sms";
        in_app: "in_app";
        social: "social";
    }>>>;
    audienceRules: z.ZodOptional<z.ZodObject<{
        membershipTiers: z.ZodDefault<z.ZodArray<z.ZodString>>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        interests: z.ZodDefault<z.ZodArray<z.ZodString>>;
        proximityRadiusMiles: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    schedule: z.ZodOptional<z.ZodObject<{
        announceAt: z.ZodOptional<z.ZodNumber>;
        reminderOffsetsHours: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
        followUpAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    copyVariants: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    utmBase: z.ZodOptional<z.ZodObject<{
        source: z.ZodOptional<z.ZodString>;
        medium: z.ZodOptional<z.ZodString>;
        campaign: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    stats: z.ZodDefault<z.ZodObject<{
        impressions: z.ZodDefault<z.ZodNumber>;
        clicks: z.ZodDefault<z.ZodNumber>;
        registrations: z.ZodDefault<z.ZodNumber>;
        conversionRate: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    createdBy: z.ZodString;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type EventCampaignDoc = z.infer<typeof eventCampaignDocSchema>;
export declare const campaignJobDocSchema: z.ZodObject<{
    id: z.ZodString;
    campaignId: z.ZodString;
    type: z.ZodEnum<{
        announce: "announce";
        reminder: "reminder";
        starting_soon: "starting_soon";
        follow_up: "follow_up";
    }>;
    scheduledFor: z.ZodNumber;
    status: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        processing: "processing";
        failed: "failed";
        sent: "sent";
    }>>;
    recipientCount: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodNumber;
    processedAt: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CampaignJobDoc = z.infer<typeof campaignJobDocSchema>;
export declare const eventShareKitDocSchema: z.ZodObject<{
    id: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    seriesId: z.ZodOptional<z.ZodString>;
    assets: z.ZodDefault<z.ZodArray<z.ZodObject<{
        variant: z.ZodEnum<{
            square: "square";
            vertical: "vertical";
            horizontal: "horizontal";
        }>;
        storagePath: z.ZodString;
        downloadUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    captions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    trackedLink: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        ready: "ready";
        archived: "archived";
        approved: "approved";
        generating: "generating";
    }>>;
    generatedAt: z.ZodOptional<z.ZodNumber>;
    approvedAt: z.ZodOptional<z.ZodNumber>;
    approvedBy: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type EventShareKitDoc = z.infer<typeof eventShareKitDocSchema>;
export declare const socialPostDocSchema: z.ZodObject<{
    id: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
    seriesId: z.ZodOptional<z.ZodString>;
    channel: z.ZodEnum<{
        x: "x";
        linkedin: "linkedin";
        facebook: "facebook";
        instagram: "instagram";
    }>;
    scheduledFor: z.ZodNumber;
    status: z.ZodDefault<z.ZodEnum<{
        failed: "failed";
        scheduled: "scheduled";
        approved: "approved";
        draft: "draft";
        posted: "posted";
    }>>;
    assetRef: z.ZodOptional<z.ZodString>;
    caption: z.ZodString;
    link: z.ZodOptional<z.ZodString>;
    retries: z.ZodDefault<z.ZodNumber>;
    postedAt: z.ZodOptional<z.ZodNumber>;
    postUrl: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    createdBy: z.ZodString;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type SocialPostDoc = z.infer<typeof socialPostDocSchema>;
export declare const paymentProviderSchema: z.ZodEnum<{
    stripe: "stripe";
    quickbooks_link: "quickbooks_link";
    quickbooks_invoice: "quickbooks_invoice";
    quickbooks_payments: "quickbooks_payments";
}>;
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;
export declare const paymentStatusSchema: z.ZodEnum<{
    pending: "pending";
    failed: "failed";
    paid: "paid";
    refunded: "refunded";
}>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export declare const paymentPurposeSchema: z.ZodEnum<{
    other: "other";
    membership: "membership";
    event: "event";
    rfx: "rfx";
    booking: "booking";
    referral: "referral";
    bookstore: "bookstore";
}>;
export type PaymentPurpose = z.infer<typeof paymentPurposeSchema>;
export declare const paymentDocSchema: z.ZodObject<{
    id: z.ZodString;
    uid: z.ZodString;
    orgId: z.ZodOptional<z.ZodString>;
    provider: z.ZodEnum<{
        stripe: "stripe";
        quickbooks_link: "quickbooks_link";
        quickbooks_invoice: "quickbooks_invoice";
        quickbooks_payments: "quickbooks_payments";
    }>;
    amount: z.ZodNumber;
    currency: z.ZodDefault<z.ZodString>;
    purpose: z.ZodEnum<{
        other: "other";
        membership: "membership";
        event: "event";
        rfx: "rfx";
        booking: "booking";
        referral: "referral";
        bookstore: "bookstore";
    }>;
    purposeRefId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        pending: "pending";
        failed: "failed";
        paid: "paid";
        refunded: "refunded";
    }>;
    providerRefs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    accountingRefs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type PaymentDoc = z.infer<typeof paymentDocSchema>;
export declare const webhookEventDocSchema: z.ZodObject<{
    eventId: z.ZodString;
    provider: z.ZodString;
    processedAt: z.ZodNumber;
    result: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type WebhookEventDoc = z.infer<typeof webhookEventDocSchema>;
export declare const leadDocSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    email: z.ZodString;
    interests: z.ZodOptional<z.ZodArray<z.ZodString>>;
    message: z.ZodOptional<z.ZodString>;
    intent: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
    interestScore: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type LeadDoc = z.infer<typeof leadDocSchema>;
export declare const notificationTypeSchema: z.ZodEnum<{
    referral: "referral";
    rfx_new: "rfx_new";
    rfx_response: "rfx_response";
    event_registration: "event_registration";
    payment: "payment";
    system: "system";
}>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export declare const notificationDocSchema: z.ZodObject<{
    id: z.ZodString;
    uid: z.ZodString;
    type: z.ZodEnum<{
        referral: "referral";
        rfx_new: "rfx_new";
        rfx_response: "rfx_response";
        event_registration: "event_registration";
        payment: "payment";
        system: "system";
    }>;
    title: z.ZodString;
    body: z.ZodString;
    linkTo: z.ZodOptional<z.ZodString>;
    read: z.ZodDefault<z.ZodBoolean>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type NotificationDoc = z.infer<typeof notificationDocSchema>;
export declare const productVariantSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    priceCents: z.ZodNumber;
    type: z.ZodEnum<{
        physical: "physical";
        digital: "digital";
        service: "service";
    }>;
    digitalAssetUrl: z.ZodOptional<z.ZodString>;
    inventory: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ProductVariant = z.infer<typeof productVariantSchema>;
export declare const productDocSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    amount: z.ZodNumber;
    currency: z.ZodDefault<z.ZodString>;
    purpose: z.ZodEnum<{
        other: "other";
        membership: "membership";
        event: "event";
        rfx: "rfx";
        booking: "booking";
        referral: "referral";
        bookstore: "bookstore";
    }>;
    stripePriceId: z.ZodOptional<z.ZodString>;
    quickbooksPaymentLinkUrl: z.ZodOptional<z.ZodString>;
    variants: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceCents: z.ZodNumber;
        type: z.ZodEnum<{
            physical: "physical";
            digital: "digital";
            service: "service";
        }>;
        digitalAssetUrl: z.ZodOptional<z.ZodString>;
        inventory: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    inventory: z.ZodOptional<z.ZodNumber>;
    active: z.ZodDefault<z.ZodBoolean>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ProductDoc = z.infer<typeof productDocSchema>;
export declare const paymentAuditActionSchema: z.ZodEnum<{
    note: "note";
    mark_paid: "mark_paid";
    mark_failed: "mark_failed";
    refund: "refund";
}>;
export type PaymentAuditAction = z.infer<typeof paymentAuditActionSchema>;
export declare const paymentAuditEntrySchema: z.ZodObject<{
    id: z.ZodString;
    paymentId: z.ZodString;
    action: z.ZodEnum<{
        note: "note";
        mark_paid: "mark_paid";
        mark_failed: "mark_failed";
        refund: "refund";
    }>;
    performedBy: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
    previousStatus: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        failed: "failed";
        paid: "paid";
        refunded: "refunded";
    }>>;
    newStatus: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        failed: "failed";
        paid: "paid";
        refunded: "refunded";
    }>>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type PaymentAuditEntry = z.infer<typeof paymentAuditEntrySchema>;
export declare const rfxTeamInviteStatusSchema: z.ZodEnum<{
    pending: "pending";
    accepted: "accepted";
    declined: "declined";
}>;
export type RfxTeamInviteStatus = z.infer<typeof rfxTeamInviteStatusSchema>;
export declare const rfxTeamInviteDocSchema: z.ZodObject<{
    id: z.ZodString;
    rfxId: z.ZodString;
    inviterUid: z.ZodString;
    inviteeUid: z.ZodString;
    inviteeName: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        pending: "pending";
        accepted: "accepted";
        declined: "declined";
    }>;
    note: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type RfxTeamInviteDoc = z.infer<typeof rfxTeamInviteDocSchema>;
export declare const rfxTeamRoleSchema: z.ZodEnum<{
    prime: "prime";
    sub: "sub";
    estimator: "estimator";
    compliance: "compliance";
    proposal_writer: "proposal_writer";
}>;
export type RfxTeamRole = z.infer<typeof rfxTeamRoleSchema>;
export declare const rfxTeamMemberSchema: z.ZodObject<{
    uid: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    businessName: z.ZodOptional<z.ZodString>;
    role: z.ZodEnum<{
        prime: "prime";
        sub: "sub";
        estimator: "estimator";
        compliance: "compliance";
        proposal_writer: "proposal_writer";
    }>;
    joinedAt: z.ZodNumber;
    scopeDescription: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RfxTeamMember = z.infer<typeof rfxTeamMemberSchema>;
export declare const rfxTeamDocSchema: z.ZodObject<{
    id: z.ZodString;
    rfxId: z.ZodString;
    name: z.ZodString;
    primeUid: z.ZodString;
    members: z.ZodArray<z.ZodObject<{
        uid: z.ZodString;
        displayName: z.ZodOptional<z.ZodString>;
        businessName: z.ZodOptional<z.ZodString>;
        role: z.ZodEnum<{
            prime: "prime";
            sub: "sub";
            estimator: "estimator";
            compliance: "compliance";
            proposal_writer: "proposal_writer";
        }>;
        joinedAt: z.ZodNumber;
        scopeDescription: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    memberUids: z.ZodDefault<z.ZodArray<z.ZodString>>;
    status: z.ZodEnum<{
        active: "active";
        forming: "forming";
        submitted: "submitted";
        dissolved: "dissolved";
    }>;
    internalNotes: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type RfxTeamDoc = z.infer<typeof rfxTeamDocSchema>;
export declare const teamDocumentSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    uploadedBy: z.ZodString;
    fileName: z.ZodString;
    storagePath: z.ZodString;
    downloadUrl: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    uploadedAt: z.ZodNumber;
}, z.core.$strip>;
export type TeamDocument = z.infer<typeof teamDocumentSchema>;
export declare const creditTransactionTypeSchema: z.ZodEnum<{
    expired: "expired";
    refund: "refund";
    purchase: "purchase";
    monthly_allocation: "monthly_allocation";
    usage: "usage";
    admin_adjustment: "admin_adjustment";
}>;
export type CreditTransactionType = z.infer<typeof creditTransactionTypeSchema>;
export declare const creditTransactionDocSchema: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    amount: z.ZodNumber;
    type: z.ZodEnum<{
        expired: "expired";
        refund: "refund";
        purchase: "purchase";
        monthly_allocation: "monthly_allocation";
        usage: "usage";
        admin_adjustment: "admin_adjustment";
    }>;
    referenceId: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type CreditTransactionDoc = z.infer<typeof creditTransactionDocSchema>;
export declare const CREDIT_PACKS: readonly [{
    readonly id: "pack_10";
    readonly credits: 10;
    readonly priceCents: 2500;
}, {
    readonly id: "pack_25";
    readonly credits: 25;
    readonly priceCents: 5500;
}, {
    readonly id: "pack_60";
    readonly credits: 60;
    readonly priceCents: 12000;
}];
export declare const CREDIT_COSTS: {
    readonly RFX_PUBLISH: 3;
    readonly RFX_PUSH_INVITES_10: 1;
    readonly RFX_PRIORITY_INTRO: 2;
    readonly RFX_BID_BOOK_EXPORT: 4;
    readonly RFX_PREMIUM_CONTACT: 2;
    readonly RFX_BOOST_BID: 3;
    readonly RFX_PORTFOLIO_SPOTLIGHT: 5;
    readonly REFERRAL_SEND_EXTRA: 2;
    readonly REFERRAL_ACCEPT_EXTRA: 1;
    readonly REFERRAL_UNLOCK_POLICY: 1;
    readonly REFERRAL_PRIORITY_INTRO: 2;
    readonly REFERRAL_VERIFICATION_PACKET: 2;
    readonly REFERRAL_OPEN_DISPUTE: 4;
    readonly REFERRAL_BOOST_PROFILE: 5;
    readonly REFERRAL_FEATURED_SLOT: 10;
    readonly VERIFIED_BUSINESS_MONTHLY: 5;
};
export declare const platformFeeDocSchema: z.ZodObject<{
    id: z.ZodString;
    transactionId: z.ZodString;
    relatedEntityId: z.ZodString;
    payerUid: z.ZodString;
    payeeUid: z.ZodOptional<z.ZodString>;
    amountCents: z.ZodNumber;
    type: z.ZodEnum<{
        application_fee: "application_fee";
        service_fee: "service_fee";
        success_fee: "success_fee";
        escrow_fee: "escrow_fee";
    }>;
    status: z.ZodEnum<{
        pending: "pending";
        refunded: "refunded";
        captured: "captured";
    }>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type PlatformFeeDoc = z.infer<typeof platformFeeDocSchema>;
export declare const membershipTierIdSchema: z.ZodEnum<{
    virtual: "virtual";
    coworking: "coworking";
    coworking_plus: "coworking_plus";
}>;
export type MembershipTierId = z.infer<typeof membershipTierIdSchema>;
export interface MembershipTierDef {
    id: MembershipTierId;
    name: string;
    /** Monthly price in cents */
    amountCents: number;
    interval: "month";
    currency: string;
    features: string[];
    /** Stripe price ID placeholder — replace with real IDs after Stripe setup */
    stripePriceId: string;
    /** Included desk hours per month */
    includedHoursPerMonth: number;
    /** Extra desk-hour rate in cents (beyond included hours) */
    extraHourlyRateCents: number;
    /** Booking window: max days ahead */
    bookingWindowDays: number;
    /** Included credits per month */
    includedCreditsPerMonth: number;
    /** Feature limits */
    limits: {
        rfxActivePosts: number;
        rfxInvitePushes: number;
        referralsSentPerMonth: number;
        referralsReceivedPerMonth: number;
        referralPolicyUnlocksPerMonth: number;
        referralActiveOpen: number;
    };
}
export declare const MEMBERSHIP_TIERS: MembershipTierDef[];
export declare const RESOURCE_CATALOG: Record<string, Resource>;
export declare function getResourceById(id: string): Resource | undefined;
export declare function getResourcesByType(type: ResourceType): Resource[];
export declare const GUEST_PRICING: {
    /** Per hour per seat, in cents */
    readonly hourlyRateCents: 1750;
    /** Daily cap per seat, in cents */
    readonly dailyCapCents: 11500;
    /** Booking window: max days ahead */
    readonly bookingWindowDays: 14;
};
/** @deprecated Use GUEST_PRICING instead */
export declare const NON_MEMBER_PRICING: {
    /** Per hour per seat, in cents */
    readonly hourlyRateCents: 1750;
    /** Daily cap per seat, in cents */
    readonly dailyCapCents: 11500;
    /** Booking window: max days ahead */
    readonly bookingWindowDays: 14;
};
export declare const CONFERENCE_ROOM_CONFIG: {
    readonly maxCapacity: 10;
    /** Per hour in cents */
    readonly hourlyRateCents: 7500;
};
export declare const SPACE_INVENTORY: {
    readonly totalSeats: 6;
};
export declare const bookAvailabilityModeSchema: z.ZodEnum<{
    physical: "physical";
    digital: "digital";
    browse_only: "browse_only";
}>;
export type BookAvailabilityMode = z.infer<typeof bookAvailabilityModeSchema>;
export declare const bookSalesChannelSchema: z.ZodEnum<{
    owned: "owned";
    affiliate: "affiliate";
}>;
export type BookSalesChannel = z.infer<typeof bookSalesChannelSchema>;
export declare const bookDocSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    author: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    coverImageUrl: z.ZodOptional<z.ZodString>;
    availabilityMode: z.ZodEnum<{
        physical: "physical";
        digital: "digital";
        browse_only: "browse_only";
    }>;
    salesChannel: z.ZodEnum<{
        owned: "owned";
        affiliate: "affiliate";
    }>;
    priceCents: z.ZodOptional<z.ZodNumber>;
    stripePriceId: z.ZodOptional<z.ZodString>;
    variants: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        priceCents: z.ZodNumber;
        type: z.ZodEnum<{
            physical: "physical";
            digital: "digital";
            service: "service";
        }>;
        digitalAssetUrl: z.ZodOptional<z.ZodString>;
        inventory: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    bundleIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    affiliateUrl: z.ZodOptional<z.ZodString>;
    affiliateNetwork: z.ZodOptional<z.ZodString>;
    digitalAssetUrl: z.ZodOptional<z.ZodString>;
    requireLoginToView: z.ZodDefault<z.ZodBoolean>;
    requireLoginToPurchase: z.ZodDefault<z.ZodBoolean>;
    requireLoginToAccessContent: z.ZodDefault<z.ZodBoolean>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    featuredRank: z.ZodOptional<z.ZodNumber>;
    published: z.ZodDefault<z.ZodBoolean>;
    createdBy: z.ZodString;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type BookDoc = z.infer<typeof bookDocSchema>;
export declare const bookPurchaseDocSchema: z.ZodObject<{
    id: z.ZodString;
    bookId: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    stripeSessionId: z.ZodOptional<z.ZodString>;
    accessGrantedAt: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type BookPurchaseDoc = z.infer<typeof bookPurchaseDocSchema>;
export declare const bookAffiliateClickDocSchema: z.ZodObject<{
    id: z.ZodString;
    bookId: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    destination: z.ZodString;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export type BookAffiliateClickDoc = z.infer<typeof bookAffiliateClickDocSchema>;
