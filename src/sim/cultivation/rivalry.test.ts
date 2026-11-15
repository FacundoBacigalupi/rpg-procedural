// La rivalidad entre sectas (novel4-rival-sect-relation): la fuerza creída con error acotado y el
// sentimiento de rival, puros y deterministas.

import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { BELIEF_ERROR, rivalSentiment, seededBelief, strengthScore } from "./rivalry.ts";

describe("la fuerza creída de la otra secta (novel4-rival-sect-relation)", () => {
  const truth = { elders: 3, disciples: 10, topStage: 3 };

  it("erra dentro del margen, a veces de más y a veces de menos; determinista", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const b = seededBelief(truth, Rng.root(i).fork("b"));
      expect(b.disciples).toBeGreaterThanOrEqual(Math.floor(10 * (1 - BELIEF_ERROR)));
      expect(b.disciples).toBeLessThanOrEqual(Math.ceil(10 * (1 + BELIEF_ERROR)));
      expect(b.elders).toBeGreaterThanOrEqual(1);
      expect(Math.abs(b.topStage - 3)).toBeLessThanOrEqual(1);
      seen.add(Math.sign(strengthScore(b) - strengthScore(truth)).toString());
      expect(seededBelief(truth, Rng.root(i).fork("b"))).toEqual(b);
    }
    expect(seen.has("1") && seen.has("-1")).toBe(true);
  });

  it("teme más a la que cree más fuerte", () => {
    const weak = { elders: 1, disciples: 3, topStage: 1 };
    const strong = { elders: 4, disciples: 12, topStage: 4 };
    const scared = rivalSentiment(weak, strong, Rng.root(1));
    const calm = rivalSentiment(strong, weak, Rng.root(1));
    expect(scared.fear).toBeGreaterThan(calm.fear);
    for (const v of Object.values(scared)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
