/**
 * People.company is a single record reference in Attio.
 * Keep the active company already on the person. A submitted name that is
 * not linked is stored on the description. Create a company only when it
 * will be that one record.
 */

export function readActiveCompanyId(
  record: { values?: Record<string, unknown> } | null | undefined,
): string | null {
  const values = record?.values?.company;
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    if ((value as { active_until?: unknown }).active_until != null) continue;
    const id = (value as { target_record_id?: unknown }).target_record_id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

export function singleCompanyValue(companyId: string): Array<{ target_object: "companies"; target_record_id: string }> {
  return [{ target_object: "companies", target_record_id: companyId }];
}

export function appendDescriptionToken(tag: string, key: string, value: string): string {
  const safeKey = key.replace(/[^a-z0-9-]/gi, "");
  const safe = value.replace(/[|[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!safeKey || !safe) return tag;
  const token = `${safeKey}:${safe}`;
  if (tag.includes(token)) return tag;
  if (tag.endsWith("]")) return `${tag.slice(0, -1)} | ${token}]`;
  return `${tag} | ${token}`;
}

export function logAttioSendFailure(scope: string, error: unknown): void {
  const detail = readAttioFailure(error);
  const status = detail.status === null ? "unknown" : String(detail.status);
  const code = detail.code?.trim() || "none";
  const message = redactAttioLog(detail.message).slice(0, 500);
  console.error(`${scope} send failed. HTTP ${status}. Attio error code: ${code}. ${message}`);
}

function readAttioFailure(error: unknown): { status: number | null; code: string | null; message: string } {
  if (error instanceof Error) {
    const status = "status" in error && typeof error.status === "number" ? error.status : null;
    const rawCode = "code" in error ? error.code : null;
    const code = typeof rawCode === "string" && rawCode.trim() ? rawCode.trim() : null;
    return { status, code, message: error.message || "Attio request failed" };
  }
  return { status: null, code: null, message: "Attio request failed" };
}

function redactAttioLog(message: string): string {
  const recordIds: string[] = [];
  const shielded = message.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (id) => {
      recordIds.push(id);
      return `@@${recordIds.length - 1}@@`;
    },
  );
  const redacted = shielded
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted]");
  return redacted.replace(/@@(\d+)@@/g, (_, index: string) => recordIds[Number(index)] ?? "");
}
