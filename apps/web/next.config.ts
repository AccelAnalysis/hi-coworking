import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  reactCompiler: true,
  transpilePackages: ["@hi/shared"],
  images: {
    unoptimized: true, // Required for static hosting without server
  },
};

export default nextConfig;
