"use client";

import { useEffect, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { getBlob, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";

/**
 * Resolves an authorized Storage object to a short-lived in-memory blob URL.
 * Canonical profile paths therefore do not need permanent bearer download URLs
 * persisted in Firestore. `legacyUrl` is retained only for existing profiles.
 */
export function useProfileAssetUrl(
  storagePath?: string | null,
  legacyUrl?: string | null,
): string | null {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    storagePath ? null : legacyUrl ?? null,
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    if (!storagePath) {
      setResolvedUrl(legacyUrl ?? null);
      return () => undefined;
    }

    setResolvedUrl(null);
    void getBlob(ref(storage, storagePath))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setResolvedUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(legacyUrl ?? null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [legacyUrl, storagePath]);

  return resolvedUrl;
}

export type ProfileAssetImageProps = Omit<ImageProps, "src"> & {
  storagePath?: string | null;
  legacyUrl?: string | null;
};

export function ProfileAssetImage({
  storagePath,
  legacyUrl,
  alt,
  unoptimized,
  ...imageProps
}: ProfileAssetImageProps) {
  const src = useProfileAssetUrl(storagePath, legacyUrl);
  if (!src) return null;

  return (
    <Image
      {...imageProps}
      src={src}
      alt={alt}
      unoptimized={unoptimized ?? src.startsWith("blob:")}
    />
  );
}
