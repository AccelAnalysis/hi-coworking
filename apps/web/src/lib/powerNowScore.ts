/** Same id the Firestore rules require: night_pitcher_judge. */
export function powerNowScoreDocId(nightId: string, pitcherId: string, judgeUid: string): string {
  return `${nightId}_${pitcherId}_${judgeUid}`;
}

export type PowerNowPoint = { criterionId: string; value: number; evidence?: string };

export type PowerNowAnchor = { score: number; text: string };

export type PowerNowCriterion = {
  id: string;
  code: string;
  label: string;
  prompt: string;
  weight: number;
  proposed: boolean;
  max: number;
  anchors: PowerNowAnchor[];
};

export type PowerNowCriteriaDoc = {
  placeholder: boolean;
  draft: boolean;
  proposed: boolean;
  notice: string;
  version: string;
  scaleInstruction: string;
  conflictOptions: string[];
  recuseIndex: number;
  leastSureOptions: string[];
  pitcherQuestions: string[];
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
      proposed: row.proposed === true || record.proposed === true,
      max: Number.isInteger(max) && max >= 1 ? Math.min(max, 5) : 5,
      anchors,
    });
  }
  const conflictOptions = Array.isArray(record.conflictOptions)
    ? record.conflictOptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const leastSureOptions = Array.isArray(record.leastSureOptions)
    ? record.leastSureOptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const pitcherQuestions = Array.isArray(record.pitcherQuestions)
    ? record.pitcherQuestions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const recuseIndex = Number(record.recuseIndex);
  return {
    placeholder: record.placeholder === true,
    draft: record.draft === true,
    proposed: record.proposed === true,
    notice: typeof record.notice === "string" ? record.notice : "",
    version: typeof record.version === "string" ? record.version : "",
    scaleInstruction: typeof record.scaleInstruction === "string" ? record.scaleInstruction : "",
    conflictOptions,
    recuseIndex: Number.isInteger(recuseIndex) && recuseIndex >= 0 && recuseIndex < conflictOptions.length ? recuseIndex : 1,
    leastSureOptions,
    pitcherQuestions,
    items: parsed,
  };
}

export const DEFAULT_TIE_BREAK = ["j5-execution", "j2-customer-market", "j1-opportunity", "judge-preference", "jonathan"];

export type RankedPitcher = {
  key: string;
  weightedAverage: number;
  criterionAverages: Record<string, number>;
  preferenceCount: number;
  jonathanRank: number | null;
  place: number;
};

/** Average of non-recused weighted scores, then J5, J2, J1, judge preference, and Jonathan. */
export function rankPitchers(
  pitchers: { key: string; jonathanRank: number | null }[],
  scores: { pitcherKey: string; judgeUid: string; recused: boolean; points: PowerNowPoint[] }[],
  criteria: Pick<PowerNowCriterion, "id" | "weight">[],
  tieBreak: string[] = DEFAULT_TIE_BREAK,
): RankedPitcher[] {
  const rows = pitchers.map((pitcher) => {
    const mine = scores.filter((score) => score.pitcherKey === pitcher.key && !score.recused);
    const weightedValues = mine.map((score) => weightedScore(score.points, criteria));
    const criterionAverages: Record<string, number> = {};
    for (const criterion of criteria) {
      const values = mine.flatMap((score) => score.points.filter((point) => point.criterionId === criterion.id).map((point) => Number(point.value)));
      criterionAverages[criterion.id] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    }
    return {
      key: pitcher.key,
      weightedAverage: weightedValues.length ? weightedValues.reduce((sum, value) => sum + value, 0) / weightedValues.length : 0,
      criterionAverages,
      preferenceCount: 0,
      jonathanRank: pitcher.jonathanRank,
      place: 0,
    };
  });
  const byJudge = new Map<string, { pitcherKey: string; weighted: number }[]>();
  for (const score of scores) {
    if (score.recused) continue;
    const weighted = weightedScore(score.points, criteria);
    byJudge.set(score.judgeUid, [...(byJudge.get(score.judgeUid) ?? []), { pitcherKey: score.pitcherKey, weighted }]);
  }
  for (const ballots of byJudge.values()) {
    const best = Math.max(...ballots.map((ballot) => ballot.weighted));
    const leaders = ballots.filter((ballot) => ballot.weighted === best);
    if (leaders.length === 1) {
      const row = rows.find((item) => item.key === leaders[0].pitcherKey);
      if (row) row.preferenceCount += 1;
    }
  }
  rows.sort((a, b) => compareRank(a, b, tieBreak) || a.key.localeCompare(b.key));
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    row.place = previous && compareRank(previous, row, tieBreak) === 0 ? previous.place : index + 1;
  });
  return rows;
}

function compareRank(a: RankedPitcher, b: RankedPitcher, tieBreak: string[]): number {
  if (b.weightedAverage !== a.weightedAverage) return b.weightedAverage - a.weightedAverage;
  for (const step of tieBreak) {
    if (step === "judge-preference") {
      if (b.preferenceCount !== a.preferenceCount) return b.preferenceCount - a.preferenceCount;
      continue;
    }
    if (step === "jonathan") {
      const left = a.jonathanRank ?? Number.POSITIVE_INFINITY;
      const right = b.jonathanRank ?? Number.POSITIVE_INFINITY;
      if (left !== right) return left - right;
      continue;
    }
    const left = a.criterionAverages[step] ?? 0;
    const right = b.criterionAverages[step] ?? 0;
    if (right !== left) return right - left;
  }
  return 0;
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
