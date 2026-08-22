import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactCompiler: true,
  transpilePackages: ["@hi/shared"],
  images: {
    unoptimized: true, // Required for static hosting without server
  },
};

export default nextConfig;
