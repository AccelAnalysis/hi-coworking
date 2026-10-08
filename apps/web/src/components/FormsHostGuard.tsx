"use client";

import { useEffect } from "react";
import { FORMS_HOST_HOME, decideFormsHost } from "@/lib/formsHostGuard";

/** Backup for the before-paint script. No-op unless the hostname is the forms domain. */
export function FormsHostGuard() {
  useEffect(() => {
    if (decideFormsHost(window.location.hostname, window.location.pathname) === "redirect") {
      window.location.replace(FORMS_HOST_HOME);
    }
  }, []);
  return null;
}
