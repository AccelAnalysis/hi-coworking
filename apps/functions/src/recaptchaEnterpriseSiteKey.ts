/**
 * Public reCAPTCHA Enterprise site key for hi-coworking-plat ("Power NOW form" key).
 * Not a secret: the same value ships to browsers as NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY.
 * Allowed domains in the console: forms.accelanalysis.com, hi-coworking.com,
 * www.hi-coworking.com, hi-coworking-plat.web.app, localhost.
 * Kept in a dependency-free module so the core codebase can import it without
 * pulling in Power NOW params.
 */
export const RECAPTCHA_ENTERPRISE_PUBLIC_SITE_KEY = "6LcAvvMtAAAAAOAmm8Z-yA83L0B_EmU7kIaq6rDX";
