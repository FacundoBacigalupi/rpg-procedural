import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Affiliation, PracticeDef } from "../../sim/index.ts";
import { festivalDue, festivalOf } from "./festival.ts";

const practice = {
  id: "harvest-thanks",
  name: "Gracias",
  kind: "festival",
  goods: [],
  everyDays: 30,
  sanction: 0,
  believedEffect: "x",
  socialEffect: "y",
} as PracticeDef;
const aff = (belief: number, belonging: number): Affiliation =>
  ({ religion: "r", belief, practice: 0.5, belonging, outward: 0.5, learnedFrom: [] }) as never;
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}` as AgentId, aff: aff(0.6, 0.9) }));

describe("la fiesta", () => {
  it("toca cada everyDays y nunca el día 0", () => {
    expect(festivalDue(practice, 0)).toBe(false);
    expect(festivalDue(practice, 30)).toBe(true);
    expect(festivalDue(practice, 31)).toBe(false);
    expect(festivalDue({ ...practice, kind: "rite" }, 30)).toBe(false);
  });

  it("alivia a los que van, más con más gente, y es determinista", () => {
    const rng = Rng.root(3);
    const small = festivalOf(practice, 30, people(3), rng.fork("a"));
    const big = festivalOf(practice, 30, people(60), rng.fork("a"));
    expect(big?.attendees.length).toBeGreaterThan(small?.attendees.length ?? 0);
    const avg = (f: typeof big) =>
      [...(f?.comfort.values() ?? [])].reduce((a, b) => a + b, 0) / (f?.comfort.size || 1);
    expect(avg(big)).toBeGreaterThan(avg(small));
    expect(festivalOf(practice, 30, people(60), rng.fork("a"))).toEqual(big);
    expect(festivalOf(practice, 30, [], rng.fork("a"))).toBeNull();
  });
});
