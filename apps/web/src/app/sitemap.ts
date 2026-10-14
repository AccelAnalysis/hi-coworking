import type { MetadataRoute } from "next";
import { PUBLIC_HI_PAGES, publicPageUrl } from "@/lib/publicSite";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_HI_PAGES.map((path) => ({
    url: publicPageUrl(path),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
