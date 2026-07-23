import type {
  ExchangeMode,
  ExchangeSecondaryContext as ServerSecondaryContext,
} from "@hi/shared/exchange-organization-context";
import type { ExchangeSelection } from "../state/exchangeWorkspaceTypes";

export function toServerSecondary(
  selection: ExchangeSelection,
): ServerSecondaryContext | undefined {
  if (!selection) return undefined;
  if (selection.entityType === "rfx" || selection.entityType === "opportunity") {
    return { type: "opportunity", id: selection.entityId };
  }
  if (selection.entityType === "establishment") {
    return { type: "establishment", id: selection.entityId };
  }
  if (selection.entityType === "referral") {
    return { type: "referral", id: selection.entityId };
  }
  if (selection.entityType === "territory") {
    return { type: "territory", id: selection.entityId };
  }
  if (selection.entityType === "organization") {
    return { type: "organization", id: selection.entityId };
  }
  if (selection.entityType === "resource") {
    return { type: "resource", id: selection.entityId };
  }
  if (selection.entityType === "team") {
    return { type: "team", id: selection.entityId };
  }
  return undefined;
}

export function createOrganizationPerspectiveKey(input: {
  actorOrganizationId?: string;
  subjectOrganizationId?: string;
  mode: ExchangeMode;
  secondary?: ServerSecondaryContext;
}): string | null {
  if (!input.subjectOrganizationId) return null;
  return JSON.stringify([
    input.actorOrganizationId ?? null,
    input.subjectOrganizationId,
    input.mode,
    input.secondary?.type ?? null,
    input.secondary?.id ?? null,
  ]);
}
