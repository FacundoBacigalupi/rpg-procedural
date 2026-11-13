import { describe, expect, it } from "vitest";
import {
  judgeRankUp,
  nextRank,
  RANK_BAR,
  RANK_STEPS,
  type RankCase,
  rankChance,
  rankScore,
  voiceOf,
} from "./rank.ts";

const inner = RANK_STEPS.inner;
if (!inner) throw new Error("sin paso de interno");

const candidate = (over: Partial<RankCase> = {}): RankCase => ({
  rank: "inner",
  stage: inner.stage,
  points: inner.points,
  days: inner.days,
  talent: 0.6,
  regard: 0.2,
  voices: [],
  ...over,
});

describe("los ascensos que se deciden (novel2-rank-core)", () => {
  it("de interno a núcleo y de núcleo a anciano; más arriba no", () => {
    expect(nextRank("inner")?.to).toBe("core");
    expect(nextRank("core")?.to).toBe("elder");
    expect(nextRank("outer")).toBeUndefined();
    expect(nextRank("elder")).toBeUndefined();
    expect(judgeRankUp(candidate({ rank: "elder" }), 0)).toEqual({
      kind: "refused",
      refused: "top",
    });
  });

  it("los pisos van antes que la tirada, en orden", () => {
    const refused = (over: Partial<RankCase>) => {
      const r = judgeRankUp(candidate(over), 0);
      return r.kind === "refused" ? r.refused : r.kind;
    };
    expect(refused({ days: inner.days - 1, stage: 0 })).toBe("too_soon");
    expect(refused({ stage: inner.stage - 1, points: 0 })).toBe("too_low");
    expect(refused({ points: inner.points - 1 })).toBe("few_points");
    expect(refused({ regard: -0.5 })).toBe("grudge");
    // Con la tirada en cero y los pisos pasados, sube.
    expect(refused({})).toBe("promoted");
  });

  it("la utilidad sube con talento, excedente, tramos y voces; la chance es monótona", () => {
    const base = rankScore(candidate(), inner);
    expect(rankScore(candidate({ talent: 0.9 }), inner)).toBeGreaterThan(base);
    expect(rankScore(candidate({ points: inner.points * 2 }), inner)).toBeGreaterThan(base);
    expect(rankScore(candidate({ stage: inner.stage + 1 }), inner)).toBeGreaterThan(base);
    expect(rankScore(candidate({ voices: [{ regard: 0.8, weight: 2 }] }), inner)).toBeGreaterThan(
      base,
    );
    expect(rankScore(candidate({ voices: [{ regard: -0.8, weight: 1 }] }), inner)).toBeLessThan(
      base,
    );
    expect(rankChance(RANK_BAR)).toBeCloseTo(0.5, 4);
    expect(rankChance(RANK_BAR + 0.2)).toBeGreaterThan(rankChance(RANK_BAR));
  });

  it("la voz del padrino pesa más; sin voces, nada", () => {
    expect(voiceOf([])).toBe(0);
    expect(
      voiceOf([
        { regard: 1, weight: 2 },
        { regard: -1, weight: 1 },
      ]),
    ).toBeCloseTo(1 / 3, 4);
  });

  it("la tirada decide contra la chance", () => {
    const c = candidate();
    const p = rankChance(rankScore(c, inner));
    const yes = judgeRankUp(c, p - 0.01);
    const no = judgeRankUp(c, p + 0.01);
    expect(yes).toMatchObject({ kind: "promoted", to: "core" });
    expect(no).toMatchObject({ kind: "refused", refused: "voted_down", p });
  });
});
