/**
 * Hi Coworking email branding: PNG mark (email clients don't render SVG),
 * Hi Navy buttons with white text, Fraunces/DM Sans with safe fallbacks.
 */
export const EMAIL_NAVY = "#101D4B";
export const EMAIL_LOGO_URL = "https://hi-coworking.com/brand/hi-coworking/hi-coworking-mark-256.png";
export const EMAIL_LOGO_HTML =
  `<img src="${EMAIL_LOGO_URL}" width="48" height="48" alt="Hi Coworking" style="display:block;border:0;width:48px;height:48px">`;
export const EMAIL_BODY_FONT = "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
export const EMAIL_HEADLINE_FONT = "Fraunces,Georgia,'Times New Roman',serif";
export const EMAIL_BUTTON_STYLE =
  `display:inline-block;padding:12px 20px;border-radius:999px;background:${EMAIL_NAVY};color:#ffffff;text-decoration:none;font-weight:650`;
