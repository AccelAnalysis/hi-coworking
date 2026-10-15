/** Same id the Firestore rules require: night_pitcher_judge. */
export function powerNowScoreDocId(nightId: string, pitcherId: string, judgeUid: string): string {
  return `${nightId}_${pitcherId}_${judgeUid}`;
}

export type PowerNowPoint = { criterionId: string; value: number };

export type PowerNowAnchor = { score: number; text: string };

export type PowerNowCriterion = {
  id: string;
  code: string;
  label: string;
  prompt: string;
  weight: number;
  max: number;
  anchors: PowerNowAnchor[];
};

export type PowerNowCriteriaDoc = {
  placeholder: boolean;
  notice: string;
  version: string;
  items: PowerNowCriterion[];
};

/** Reads the published rubric. Wording stays in Firestore, not in this file. */
export function readPowerNowCriteria(data: unknown): PowerNowCriteriaDoc {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const items = Array.isArray(record.items) ? record.items : [];
  const parsed: PowerNowCriterion[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!id || !label) continue;
    const max = Number(row.max);
    const weight = Number(row.weight);
    const anchors = Array.isArray(row.anchors)
      ? row.anchors.flatMap((anchor) => {
        if (!anchor || typeof anchor !== "object") return [];
        const entry = anchor as { score?: unknown; text?: unknown };
        const score = Number(entry.score);
        const text = String(entry.text ?? "").trim();
        if (!Number.isInteger(score) || !text) return [];
        return [{ score, text }];
      })
      : [];
    parsed.push({
      id,
      code: String(row.code ?? "").trim(),
      label,
      prompt: String(row.prompt ?? "").trim(),
      weight: Number.isFinite(weight) ? weight : 0,
      max: Number.isInteger(max) && max >= 1 ? Math.min(max, 5) : 5,
      anchors,
    });
  }
  return {
    placeholder: record.placeholder === true,
    notice: typeof record.notice === "string" ? record.notice : "",
    version: typeof record.version === "string" ? record.version : "",
    items: parsed,
  };
}

/** Weighted score on the 1–5 scale. Weights are percents that should add to 100. */
export function weightedScore(
  points: PowerNowPoint[],
  criteria: Pick<PowerNowCriterion, "id" | "weight">[],
): number {
  const total = criteria.reduce((sum, criterion) => {
    const point = points.find((item) => item.criterionId === criterion.id);
    return sum + (point ? Number(point.value) * criterion.weight : 0);
  }, 0);
  return total / 100;
}
