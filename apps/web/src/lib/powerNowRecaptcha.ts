export const POWER_NOW_RECAPTCHA_ACTION = "power_now_submit";

type EnterpriseRecaptcha = {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: { enterprise?: EnterpriseRecaptcha };
  }
}

export function powerNowRecaptchaSiteKey(): string {
  return process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() ?? "";
}

export function preloadPowerNowRecaptcha(): void {
  const siteKey = powerNowRecaptchaSiteKey();
  if (!siteKey || typeof document === "undefined") return;
  if (document.querySelector("script[data-power-now-recaptcha]")) return;
  const script = document.createElement("script");
  script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
  script.async = true;
  script.dataset.powerNowRecaptcha = "true";
  document.head.appendChild(script);
}

export async function powerNowRecaptchaToken(): Promise<string> {
  const siteKey = powerNowRecaptchaSiteKey();
  if (!siteKey || typeof window === "undefined") return "";
  preloadPowerNowRecaptcha();
  const enterprise = await waitForEnterprise(4000);
  if (!enterprise) return "";
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(""), 4000);
    try {
      enterprise.ready(() => {
        enterprise
          .execute(siteKey, { action: POWER_NOW_RECAPTCHA_ACTION })
          .then((token) => {
            window.clearTimeout(timer);
            resolve(token || "");
          })
          .catch(() => {
            window.clearTimeout(timer);
            resolve("");
          });
      });
    } catch {
      window.clearTimeout(timer);
      resolve("");
    }
  });
}

function waitForEnterprise(timeoutMs: number): Promise<EnterpriseRecaptcha | null> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const enterprise = window.grecaptcha?.enterprise;
      if (enterprise) {
        resolve(enterprise);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}
