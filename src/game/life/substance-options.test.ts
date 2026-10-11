import { describe, expect, it } from "vitest";
import { optInParts } from "./create.ts";

describe("opciones de vida de sustancias", () => {
  it("sin pedirlas no hay nada; pedidas, pasan a LifeParts tal cual", () => {
    expect(optInParts({})).toEqual({});
    const borrowCraving = { minCraving: 0.3, weight: 0.8, approach: 0.5 };
    const buyCraving = { minCraving: 0.4, weight: 1 };
    const gatherCraving = { minCraving: 0.4, weight: 0.8 };
    expect(
      optInParts({
        buyCraving,
        gatherCraving,
        borrowCraving,
        lendBorrowed: true,
        repayDoses: true,
      }),
    ).toEqual({ buyCraving, gatherCraving, borrowCraving, lendBorrowed: true, repayDoses: true });
    expect(optInParts({ lendBorrowed: false, repayDoses: false })).toEqual({});
  });
});
