import { describe, expect, it } from "vitest";

import {
  actorScopedValue,
  exchangeActorScopeKey,
} from "../../apps/web/src/features/exchange/data/exchangeActorScope";
import {
  createOrganizationPerspectiveKey,
  toServerSecondary,
} from "../../apps/web/src/features/exchange/data/organizationContextKey";

describe("Exchange context isolation", () => {
  it("does not expose an actor-scoped value during a render for another actor", () => {
    const scope = exchangeActorScopeKey("actor-a");
    expect(actorScopedValue({ privateCount: 3 }, scope, "actor-a")).toEqual({
      privateCount: 3,
    });
    expect(actorScopedValue({ privateCount: 3 }, scope, "actor-b")).toBeNull();
    expect(actorScopedValue({ privateCount: 3 }, scope, undefined)).toBeNull();
  });

  it("keys a perspective to actor, subject, mode, and secondary context", () => {
    const base = createOrganizationPerspectiveKey({
      actorOrganizationId: "actor-a",
      subjectOrganizationId: "subject-a",
      mode: "opportunities",
      secondary: { type: "opportunity", id: "rfx-a" },
    });
    expect(base).not.toBeNull();
    expect(createOrganizationPerspectiveKey({
      actorOrganizationId: "actor-b",
      subjectOrganizationId: "subject-a",
      mode: "opportunities",
      secondary: { type: "opportunity", id: "rfx-a" },
    })).not.toBe(base);
    expect(createOrganizationPerspectiveKey({
      actorOrganizationId: "actor-a",
      subjectOrganizationId: "subject-a",
      mode: "resources",
      secondary: { type: "resource", id: "resource-a" },
    })).not.toBe(base);
  });

  it("preserves every server-supported secondary context without promoting filters", () => {
    expect(toServerSecondary({ entityType: "rfx", entityId: "rfx-1" })).toEqual({
      type: "opportunity",
      id: "rfx-1",
    });
    expect(toServerSecondary({ entityType: "opportunity", entityId: "opp-1" })).toEqual({
      type: "opportunity",
      id: "opp-1",
    });
    expect(toServerSecondary({ entityType: "resource", entityId: "resource-1" })).toEqual({
      type: "resource",
      id: "resource-1",
    });
    expect(toServerSecondary({ entityType: "team", entityId: "team-1" })).toEqual({
      type: "team",
      id: "team-1",
    });
    expect(toServerSecondary({ entityType: "relationship", entityId: "rel-1" })).toBeUndefined();
    expect(toServerSecondary({ entityType: "industry", entityId: "541330" })).toBeUndefined();
  });
});
