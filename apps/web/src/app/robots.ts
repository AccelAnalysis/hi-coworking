import type { MetadataRoute } from "next";
import {
  ADMIN_RFX_QUARANTINE_PREFIXES,
  MEMBER_RFX_QUARANTINE_PREFIXES,
  PUBLIC_RFX_QUARANTINE_PREFIXES,
} from "@/lib/rfxQuarantine";
import { PUBLIC_SITE_ORIGIN } from "@/lib/publicSite";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        ...PUBLIC_RFX_QUARANTINE_PREFIXES,
        ...MEMBER_RFX_QUARANTINE_PREFIXES,
        ...ADMIN_RFX_QUARANTINE_PREFIXES,
      ],
    },
    sitemap: `${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
  };
}
