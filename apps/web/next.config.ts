import type { NextConfig } from "next";

/** Public reCAPTCHA Enterprise site key. Not a secret. Must allow both production hosts. */
const POWER_NOW_RECAPTCHA_SITE_KEY = "6LcAvvMtAAAAAOAmm8Z-yA83L0B_EmU7kIaq6rDX";

const nextConfig: NextConfig = {
  output: "export",
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY:
      process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY || POWER_NOW_RECAPTCHA_SITE_KEY,
    // SayHi switches (see src/lib/sayhiFlags.ts). Always defined, empty when
    // unset, so a production build inlines them as off and drops the gated
    // preview code and draft copy instead of reading process.env at runtime.
    NEXT_PUBLIC_SAYHI_FLOW: process.env.NEXT_PUBLIC_SAYHI_FLOW || "",
    NEXT_PUBLIC_VIRTUAL_ADDRESS: process.env.NEXT_PUBLIC_VIRTUAL_ADDRESS || "",
    NEXT_PUBLIC_SAYHI_PREVIEW_DEMO: process.env.NEXT_PUBLIC_SAYHI_PREVIEW_DEMO || "",
  },
  transpilePackages: ["@hi/shared"],
  images: {
    unoptimized: true, // Required for static hosting without server
  },
};

export default nextConfig;
