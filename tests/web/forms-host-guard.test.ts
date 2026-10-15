import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORMS_HOST,
  FORMS_HOST_HOME,
  decideFormsHost,
  formsHostGuardScript,
  isFormsHostPathAllowed,
} from "../../apps/web/src/lib/formsHostGuard";

function runGuard(hostname: string, pathname: string): string | null {
  let replaced: string | null = null;
  const window = {
    location: {
      hostname,
      pathname,
      replace(url: string) {
        replaced = url;
      },
    },
  };
  const run = new Function("window", "location", formsHostGuardScript());
  run(window, window.location);
  return replaced;
}

describe("forms.accelanalysis.com host guard", () => {
  it("leaves Hi Coworking, web.app, and preview channels alone", () => {
    const hosts = [
      "hi-coworking.com",
      "www.hi-coworking.com",
      "hi-coworking-plat.web.app",
      "hi-coworking-plat--pr-82-oqz548tq.web.app",
      "localhost",
      "127.0.0.1",
      "forms.accelanalysis.com.evil.example",
    ];
    for (const host of hosts) {
      expect(decideFormsHost(host, "/")).toBe("stay");
      expect(decideFormsHost(host, "/pricing")).toBe("stay");
      expect(decideFormsHost(host, "/power-now/pitch")).toBe("stay");
      expect(runGuard(host, "/spaces")).toBeNull();
    }
  });

  it("keeps Power NOW, intake, their assets, and the lead API on the forms host", () => {
    const allowed = [
      "/power-now",
      "/power-now/",
      "/power-now/pitch",
      "/power-now/watch",
      "/power-now/contribute",
      "/power-now/pitch/",
      "/power-now/power-now-logo-lockup.jpg",
      "/intake",
      "/intake/",
      "/brand/accel-analysis-wordmark.png",
      "/_next/static/chunks/app.js",
      "/api/expo/nasa-lead",
    ];
    for (const path of allowed) {
      expect(isFormsHostPathAllowed(path), path).toBe(true);
      expect(decideFormsHost(FORMS_HOST, path), path).toBe("stay");
      expect(decideFormsHost("Forms.AccelAnalysis.com", path), path).toBe("stay");
      expect(runGuard(FORMS_HOST, path), path).toBeNull();
    }
  });

  it("replaces every other forms-host path with the Accel site", () => {
    const blocked = ["/", "/spaces", "/pricing", "/book", "/kiosk/jessica", "/power-nowhere", "/intakefoo", "/api/other"];
    for (const path of blocked) {
      expect(decideFormsHost(FORMS_HOST, path), path).toBe("redirect");
      expect(runGuard(FORMS_HOST, path), path).toBe(FORMS_HOST_HOME);
    }
  });

  it("is installed in the root document before paint", () => {
    const layout = readFileSync("apps/web/src/app/layout.tsx", "utf8");
    expect(layout).toContain("formsHostGuardScript");
    expect(layout).toContain("FormsHostGuard");
    expect(layout).toContain('strategy="beforeInteractive"');
    expect(formsHostGuardScript()).toContain(FORMS_HOST);
    expect(formsHostGuardScript()).toContain(`location.replace(${JSON.stringify(FORMS_HOST_HOME)})`);
    expect(formsHostGuardScript()).not.toContain("</");
  });
});
