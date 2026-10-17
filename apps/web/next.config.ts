import type { NextConfig } from "next";

/** Public reCAPTCHA Enterprise site key. Not a secret. Must allow both production hosts. */
const POWER_NOW_RECAPTCHA_SITE_KEY = "6LcAvvMtAAAAAOAmm8Z-yA83L0B_EmU7kIaq6rDX";

const nextConfig: NextConfig = {
  output: "export",
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY:
      process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY || POWER_NOW_RECAPTCHA_SITE_KEY,
  },
  transpilePackages: ["@hi/shared"],
  images: {
    unoptimized: true, // Required for static hosting without server
  },
};

export default nextConfig;
