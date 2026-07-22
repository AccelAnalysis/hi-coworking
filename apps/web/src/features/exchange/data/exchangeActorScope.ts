/**
 * Produces a stable browser-only key for data that was authorized for one
 * validated Exchange actor. The individual viewer scope is deliberately
 * distinct from every organization ID.
 */
export function exchangeActorScopeKey(actorOrganizationId?: string): string {
  return actorOrganizationId ? `organization:${actorOrganizationId}` : "individual";
}

/**
 * Prevents a render from reusing data fetched for a previous actor while the
 * effect that starts the next request is still waiting to run.
 */
export function actorScopedValue<T>(
  value: T,
  valueScopeKey: string | null,
  actorOrganizationId?: string,
): T | null {
  return valueScopeKey === exchangeActorScopeKey(actorOrganizationId)
    ? value
    : null;
}
