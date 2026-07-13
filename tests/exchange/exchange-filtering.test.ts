import { describe, expect, it } from "vitest";
import { parseExchangeNaicsDraft } from "../../apps/web/src/features/exchange/utils/filtering";

describe("Exchange NAICS draft parsing", () => {
  it("accepts multiple 2–6 digit codes typed with commas or spaces", () => {
    expect(parseExchangeNaicsDraft("54, 541330 236220")).toEqual([
      "54",
      "541330",
      "236220",
    ]);
  });

  it("drops invalid and duplicate values before URL state is updated", () => {
    expect(parseExchangeNaicsDraft("abc, 1, 541330, 541330, 1234567")).toEqual([
      "541330",
    ]);
  });

  it("enforces a bounded code count", () => {
    expect(parseExchangeNaicsDraft("11 22 33 44", 2)).toEqual(["11", "22"]);
  });
});
