export function isLegacyPlatformInviteRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "business_intro") return false;
  if (record.type !== undefined && record.type !== "platform_invite") return false;

  const hasText = (field: string) =>
    typeof record[field] === "string" && (record[field] as string).trim().length > 0;
  const hasPlatformIdentity = [
    "referredEmail",
    "invitedEmail",
    "inviteeUid",
    "claimedByUid",
    "cancelledByUid",
  ].some(hasText);
  const hasBusinessIdentity = [
    "providerUid",
    "providerOrgId",
    "clientName",
    "clientEmail",
    "clientPhone",
    "clientCompany",
  ].some(hasText);
  return hasPlatformIdentity && !hasBusinessIdentity;
}
