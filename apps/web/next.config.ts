import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactCompiler: true,
  transpilePackages: ["@hi/shared"],
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true, // Required for static hosting without server
  },
};

export default nextConfig;
