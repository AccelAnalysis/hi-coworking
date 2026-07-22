import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Exchange referral actor scoping", () => {
  it("carries the selected actor through every live detail and mutation request", () => {
    const gateway = source("apps/web/src/features/exchange/data/exchangeRun3Gateway.ts");
    const workspace = source("apps/web/src/features/exchange/connections/ConnectionsWorkspace.tsx");

    for (const callable of [
      "listBusinessReferralsFn",
      "getBusinessReferralDetailFn",
      "listBusinessReferralTimelineFn",
      "createBusinessReferralFn",
      "sendBusinessReferralFn",
      "respondBusinessReferralFn",
      "progressBusinessReferralFn",
      "reportBusinessReferralTransactionFn",
      "reviewBusinessReferralTransactionFn",
    ]) {
      expect(gateway).toMatch(new RegExp(`${callable}\\(\\{[\\s\\S]{0,500}actorOrganizationId`));
    }
    expect(workspace).toContain("operation: (actorOrganizationId?: string)");
    expect(workspace).toContain("actorOrganizationId,");
    expect(workspace).toContain("referrerOrgId: actorOrganizationId");
  });

  it("partitions client state and gateway caches before returning actor-scoped data", () => {
    const gateway = source("apps/web/src/features/exchange/data/exchangeRun3Gateway.ts");
    const hook = source("apps/web/src/features/exchange/data/useConnectionsData.ts");

    expect(gateway).toContain("const actorCaches = new Map<string, ActorCache>()");
    expect(gateway).toContain("const latestListRequestByActor = new Map<string, number>()");
    expect(gateway).toContain("latestListRequestByActor.get(cacheKey) === requestSequence");
    expect(hook).toContain("snapshotState?.scopeKey === currentScopeKey");
    expect(hook).toContain("detailState?.requestKey === currentDetailKey");
    expect(hook).toContain("renderedScopeRef.current !== requestScopeKey");
    expect(hook).toContain("scopeAtStart !== renderedScopeRef.current");
    expect(hook).toContain("gateway.getReferralDetail(selectedReferralId, actorOrganizationId)");
  });
});
