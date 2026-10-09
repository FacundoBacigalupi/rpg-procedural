import { describe, expect, it } from "vitest";
import { moralWeightOf } from "./conscience.ts";

const base = { warmth: 0, willpower: 0, moralShare: null, taboo: 0 };

describe("moralWeightOf", () => {
  it("sin valores ni tabú es el temperamento", () => {
    expect(moralWeightOf(base)).toBeCloseTo(0.5);
    expect(moralWeightOf({ ...base, warmth: 1 })).toBeGreaterThan(0.5);
  });

  it("quien valora la justicia y la tradición lo condena más", () => {
    const low = moralWeightOf({ ...base, moralShare: 0.1 });
    const high = moralWeightOf({ ...base, moralShare: 0.45 });
    expect(high).toBeGreaterThan(low);
  });

  it("el tabú creído suma y todo queda en 0-1", () => {
    expect(moralWeightOf({ ...base, taboo: 0.5 })).toBeGreaterThan(moralWeightOf(base));
    expect(moralWeightOf({ warmth: 5, willpower: 5, moralShare: 1, taboo: 1 })).toBeLessThanOrEqual(
      1,
    );
  });
});
