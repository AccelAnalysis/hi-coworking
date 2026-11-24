"use client";

import { useEffect, useState } from "react";
import {
  isResourceOffered,
  type ResourceOfferingMap,
} from "@hi/shared";
import { subscribeToResourceOffering } from "@/lib/firestore";

export function useResourceOffering() {
  const [offered, setOffered] = useState<ResourceOfferingMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    return subscribeToResourceOffering((map) => {
      setOffered(map);
      setLoaded(true);
    });
  }, []);

  return {
    offered,
    loaded,
    isOffered: (resourceId: string) => isResourceOffered(resourceId, offered),
  };
}
