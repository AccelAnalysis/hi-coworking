import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POWER_NOW_CRITERIA_PART_B,
  POWER_NOW_FIT_QUESTIONS,
} from "../../apps/functions/src/expo/powerNowForms";
import { readPowerNowFit } from "../../apps/web/src/lib/powerNowFit";
import { rankPitchers, readPowerNowCriteria, weightedScore } from "../../apps/web/src/lib/powerNowScore";

function longCopy(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.trim().length >= 20) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => longCopy(item, out));
    return out;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => longCopy(item, out));
  }
  return out;
}

const root = resolve(process.cwd());

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

const clientFiles = [
  "apps/web/src/app/power-now/ui.tsx",
  "apps/web/src/app/power-now/criteriaView.tsx",
  "apps/web/src/app/power-now/fit/page.tsx",
  "apps/web/src/app/power-now/fitFields.tsx",
  "apps/web/src/lib/powerNowFit.ts",
  "apps/web/src/app/power-now/judges/page.tsx",
  "apps/web/src/app/power-now/results/page.tsx",
  "apps/web/src/app/power-now/score/page.tsx",
  "apps/web/src/app/power-now/rubric/page.tsx",
  "apps/web/src/lib/powerNowScore.ts",
];

describe("Power NOW form client", () => {
  it("does not bundle criteria or fit-question copy", () => {
    const secretPhrases = [
      ...longCopy(POWER_NOW_FIT_QUESTIONS),
      ...longCopy(POWER_NOW_CRITERIA_PART_B),
    ];
    const bundle = clientFiles.map((path) => read(path)).join("\n");
    for (const phrase of secretPhrases) {
      expect(bundle, phrase).not.toContain(phrase);
    }
  });

  it("keeps scores off the pitcher page and shows each judge on the host view", () => {
    const rubric = read("apps/web/src/app/power-now/rubric/page.tsx");
    const score = read("apps/web/src/app/power-now/score/page.tsx");
    const results = read("apps/web/src/app/power-now/results/page.tsx");
    expect(rubric).not.toContain("powerNowScores");
    expect(rubric).not.toContain("powerNowPrivateComments");
    expect(score).toContain("powerNowScoreDocId");
    expect(score).toContain("recused");
    expect(score).toContain("Submit score");
    expect(results).toContain("rankPitchers");
    expect(results).toContain("Average weighted score");
    expect(results).toContain("Lock scoring");
    expect(score).not.toContain('collection(db, "powerNowScores")');
    expect(results).toContain("onSnapshot");
    expect(results).toContain('collection(db, "powerNowScores")');
    expect(results).toContain("weightedScore");
    expect(results).toContain("powerNowPrivateComments");
    const bundle = clientFiles.map((path) => read(path)).join("\n");
    expect(bundle).not.toMatch(/\bAccel\b(?! Analysis)/);
    expect(read("apps/web/src/lib/powerNowScore.ts")).toContain('return `${nightId}_${pitcherId}_${judgeUid}`');
    expect(read("firestore.rules")).toContain('scoreId == request.resource.data.nightId + "_" + request.resource.data.pitcherId + "_" + request.auth.uid');
  });

  it("weights a full scorecard and ignores nothing the rubric published", () => {
    const published = readPowerNowCriteria(POWER_NOW_CRITERIA_PART_B);
    expect(published.items).toHaveLength(6);
    expect(published.proposed).toBe(true);
    expect(published.items.every((item) => item.anchors.length === 5 && item.proposed)).toBe(true);
    const points = published.items.map((item, index) => ({ criterionId: item.id, value: index + 1 > 5 ? 5 : index + 1 }));
    expect(weightedScore(points, published.items)).toBeCloseTo(3.15, 5);
    const worked = [4, 3, 3, 4, 5, 3].map((value, index) => ({
      criterionId: published.items[index]?.id ?? "",
      value,
    }));
    expect(weightedScore(worked, published.items)).toBeCloseTo(3.75, 5);
    const fit = readPowerNowFit(POWER_NOW_FIT_QUESTIONS);
    expect(fit.items.map((item) => item.id)).toEqual(POWER_NOW_FIT_QUESTIONS.items.map((item) => item.id));
    expect(fit.items.find((item) => item.id === "fit_q10a")?.type).toBe("grid");
    expect(fit.openingScript.length).toBeGreaterThan(20);
  });

  it("ranks by weighted average, then J5, J2, J1, judge preference, and Jonathan", () => {
    const criteria = [
      { id: "j1-opportunity", weight: 20 },
      { id: "j2-customer-market", weight: 20 },
      { id: "j5-execution", weight: 20 },
    ];
    const card = (j5: number, j2: number, j1: number) => [
      { criterionId: "j5-execution", value: j5 },
      { criterionId: "j2-customer-market", value: j2 },
      { criterionId: "j1-opportunity", value: j1 },
    ];
    const tied = rankPitchers(
      [
        { key: "a", jonathanRank: 2 },
        { key: "b", jonathanRank: 1 },
      ],
      [
        { pitcherKey: "a", judgeUid: "judge-1", recused: false, points: card(4, 4, 4) },
        { pitcherKey: "b", judgeUid: "judge-1", recused: false, points: card(4, 4, 4) },
        { pitcherKey: "a", judgeUid: "judge-2", recused: true, points: [] },
      ],
      criteria,
    );
    expect(tied.map((row) => row.key)).toEqual(["b", "a"]);
    expect(tied[0]?.place).toBe(1);
    expect(tied.every((row) => row.weightedAverage === 2.4)).toBe(true);

    const byExecution = rankPitchers(
      [
        { key: "a", jonathanRank: null },
        { key: "b", jonathanRank: null },
      ],
      [
        { pitcherKey: "a", judgeUid: "judge-1", recused: false, points: card(5, 3, 1) },
        { pitcherKey: "b", judgeUid: "judge-1", recused: false, points: card(3, 5, 1) },
      ],
      criteria,
    );
    expect(byExecution[0]?.weightedAverage).toBeCloseTo(byExecution[1]?.weightedAverage ?? 0, 5);
    expect(byExecution.map((row) => row.key)).toEqual(["a", "b"]);
  });
});
