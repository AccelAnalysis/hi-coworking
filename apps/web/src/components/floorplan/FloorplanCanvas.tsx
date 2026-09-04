"use client";

import type { ComponentProps } from "react";
import "./FloorplanCanvasViewportDiagnostic";
import { FloorplanCanvas as PointerStateCanvas } from "./FloorplanCanvasPointerState";

type FloorplanCanvasProps = ComponentProps<typeof PointerStateCanvas>;

export function FloorplanCanvas(props: FloorplanCanvasProps) {
  return (
    <div
      className="h-full w-full"
      data-testid="floorplan-browser-context-guard"
      onContextMenu={(event) => event.preventDefault()}
    >
      <PointerStateCanvas {...props} />
    </div>
  );
}
