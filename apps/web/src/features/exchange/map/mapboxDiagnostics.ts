"use client";

import mapboxgl from "mapbox-gl";

import { EXCHANGE_MAP_STYLE } from "./mapConfig";

const MAPBOX_STYLE_ENDPOINT = "https://api.mapbox.com/styles/v1/mapbox/streets-v12";

export interface MapboxRuntimeDiagnostics {
  origin: string;
  protocol: string;
  style: string;
  tokenFingerprint: string;
  webglSupported: boolean;
  styleStatus?: number;
}

export class MapboxRuntimeError extends Error {
  diagnostics: MapboxRuntimeDiagnostics;

  constructor(message: string, diagnostics: MapboxRuntimeDiagnostics) {
    super(message);
    this.name = "MapboxRuntimeError";
    this.diagnostics = diagnostics;
  }
}

export function fingerprintMapboxToken(token: string): string {
  // FNV-1a is sufficient here because this value is only used to confirm that
  // a changed public token reached the browser bundle. The token itself is never displayed.
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pk-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function runtimeDiagnostics(token: string): MapboxRuntimeDiagnostics {
  const protocol = window.location.protocol;
  return {
    origin: window.location.origin || "null",
    protocol,
    style: EXCHANGE_MAP_STYLE,
    tokenFingerprint: fingerprintMapboxToken(token),
    webglSupported: mapboxgl.supported(),
  };
}

async function readMapboxError(response: Response): Promise<string> {
  try {
    const value = await response.json() as { message?: unknown };
    if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  } catch {
    // The status-specific message below remains actionable when the body is not JSON.
  }
  return response.statusText || `HTTP ${response.status}`;
}

export async function validateMapboxRuntime(token: string): Promise<MapboxRuntimeDiagnostics> {
  const diagnostics = runtimeDiagnostics(token);

  if (diagnostics.protocol !== "http:" && diagnostics.protocol !== "https:") {
    throw new MapboxRuntimeError(
      "The Exchange is running without an HTTP(S) origin. Serve the app through Next.js or Firebase Hosting instead of opening exported files directly.",
      diagnostics,
    );
  }

  if (!diagnostics.webglSupported) {
    throw new MapboxRuntimeError(
      "This browser session does not provide the WebGL support required by Mapbox GL JS. Enable hardware acceleration/WebGL or test in another supported browser session.",
      diagnostics,
    );
  }

  let response: Response;
  try {
    const url = `${MAPBOX_STYLE_ENDPOINT}?access_token=${encodeURIComponent(token)}&fresh=true`;
    response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "strict-origin-when-cross-origin",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The browser blocked the request.";
    throw new MapboxRuntimeError(
      `The browser could not reach the Mapbox Styles API from ${diagnostics.origin}. ${detail}`,
      diagnostics,
    );
  }

  const completed = { ...diagnostics, styleStatus: response.status };
  if (!response.ok) {
    const detail = await readMapboxError(response);
    if (response.status === 401) {
      throw new MapboxRuntimeError(`Mapbox rejected the compiled browser token as invalid: ${detail}`, completed);
    }
    if (response.status === 403) {
      throw new MapboxRuntimeError(
        `Mapbox denied this origin or the token is missing styles:read access. Confirm that ${diagnostics.origin} is included in the token's allowed URLs. ${detail}`,
        completed,
      );
    }
    throw new MapboxRuntimeError(
      `Mapbox Streets could not be read (HTTP ${response.status}). ${detail}`,
      completed,
    );
  }

  return completed;
}

export function mapboxRequestTransform(url: string) {
  return {
    url,
    credentials: "omit" as const,
    referrerPolicy: "strict-origin-when-cross-origin" as const,
  };
}
