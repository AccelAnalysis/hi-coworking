import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POWER_NOW_CRITERIA_PART_B,
  POWER_NOW_FIT_PLACEHOLDER,
} from "../../apps/functions/src/expo/powerNowForms";
import { readPowerNowCriteria, weightedScore } from "../../apps/web/src/lib/powerNowScore";

const root = resolve(process.cwd());

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

const clientFiles = [
  "apps/web/src/app/power-now/ui.tsx",
  "apps/web/src/app/power-now/criteriaView.tsx",
  "apps/web/src/app/power-now/fit/page.tsx",
  "apps/web/src/app/power-now/judges/page.tsx",
  "apps/web/src/app/power-now/results/page.tsx",
  "apps/web/src/app/power-now/score/page.tsx",
  "apps/web/src/app/power-now/rubric/page.tsx",
  "apps/web/src/lib/powerNowScore.ts",
];

describe("Power NOW form client", () => {
  it("does not bundle criteria or fit-question copy", () => {
    const secretPhrases = [
      ...POWER_NOW_FIT_PLACEHOLDER.items.map((item) => item.prompt),
      ...POWER_NOW_CRITERIA_PART_B.items.flatMap((item) => [
        item.label,
        item.prompt,
        ...item.anchors.map((anchor) => anchor.text),
      ]),
      POWER_NOW_FIT_PLACEHOLDER.notice,
      POWER_NOW_CRITERIA_PART_B.notice,
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
    const points = published.items.map((item, index) => ({ criterionId: item.id, value: index + 1 > 5 ? 5 : index + 1 }));
    expect(weightedScore(points, published.items)).toBeCloseTo(3.15, 5);
  });
});
