import type { FloorDoc, FloorplanElement, FloorplanElementType, ShellDoc } from "@hi/shared";
import { elementTypeLabel, uid } from "./floorplanBuilder";

/** A new element of `type`, positioned at 0,0 (the caller places it). */
export function createDesignerElement(type: FloorplanElementType, resourceId?: string): FloorplanElement {
  const base: FloorplanElement = {
    id: uid(type.toLowerCase()),
    type,
    shape: "RECT",
    x: 0,
    y: 0,
    width: type === "WALL" ? 260 : 120,
    height: type === "WALL" ? 10 : 100,
    rotation: 0,
    label: elementTypeLabel(type),
  };
  const withResource = resourceId ? { resourceId } : {};

  switch (type) {
    case "DOOR":
      return { ...base, width: 60, height: 10, meta: { doorType: "STANDARD", isAdaAccessible: true, isEgress: false } };
    case "WINDOW":
      return { ...base, width: 80, height: 8 };
    case "COLUMN":
      return { ...base, width: 30, height: 30 };
    case "SEAT":
      return { ...base, ...withResource, width: 60, height: 60, label: "Seat", meta: { capacity: 1 } };
    case "DESK":
      return { ...base, ...withResource, width: 100, height: 60, label: "Desk", meta: { capacity: 1 } };
    case "MODE_ZONE":
      return { ...base, ...withResource, width: 200, height: 160, label: "Meeting room", meta: { capacity: 6 } };
    case "BATHROOM":
      return { ...base, meta: { bathroomType: "ALL_GENDER", isAdaAccessible: true } };
    case "ELEVATOR":
      return { ...base, width: 100, height: 100, meta: { direction: "BOTH", isAdaAccessible: true } };
    case "STAIRS":
      return { ...base, width: 100, height: 160, meta: { direction: "UP" } };
    case "POWER":
    case "ACCESS_READER":
    case "CAMERA":
    case "FIRE_EXTINGUISHER":
    case "TRASH":
    case "PLANT":
      return { ...base, width: 30, height: 30 };
    default:
      return base;
  }
}

export function makeFloor(locationId: string, levelIndex: number, name?: string): FloorDoc {
  return {
    id: uid("floor"),
    locationId,
    name: name ?? `Level ${levelIndex + 1}`,
    levelIndex,
    canvasWidth: 1100,
    canvasHeight: 650,
    background: { opacity: 1, scale: 1, offsetX: 0, offsetY: 0, locked: true },
  };
}

/** An empty building shell (no sample walls), saved on first edit. */
export function makeEmptyShell(floorId: string, updatedBy?: string): ShellDoc {
  return { id: "main", floorId, updatedAt: Date.now(), ...(updatedBy ? { updatedBy } : {}), elements: [] };
}
