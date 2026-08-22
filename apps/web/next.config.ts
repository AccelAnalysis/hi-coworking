import type { NextConfig } from "next";

const isPagesPreview = process.env.HI_COWORKING_PAGES_PREVIEW === "1";
const pagesBasePath = isPagesPreview ? (process.env.PAGES_BASE_PATH ?? "") : "";

const nextConfig: NextConfig = {
  output: "export",
  reactCompiler: true,
  transpilePackages: ["@hi/shared"],
  images: {
    unoptimized: true, // Required for static hosting without server
  },
  ...(isPagesPreview
    ? {
        basePath: pagesBasePath,
        trailingSlash: true,
        // PR previews are a visual-review surface. The existing Exchange
        // security workflow remains the merge-quality type/build gate.
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
};

export default nextConfig;
