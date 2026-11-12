import { describe, expect, it } from "vitest";
import { type EventId, Rng } from "../../core/index.ts";
import { generateCultivationLaw } from "../cultivation/index.ts";
import {
  generateHeavenLaw,
  HEAVEN_STRENGTH,
  heavenThreshold,
  THRESHOLD_DROP,
  THRESHOLD_TOP,
  tribulationDue,
} from "./index.ts";

const ev = "event:1" as EventId;

describe("la fuerza del Cielo (novel2-trib-heaven)", () => {
  it("sale del seed: mismo seed, mismo Cielo; la fuerza queda en su rango", () => {
    for (let s = 1; s <= 40; s++) {
      const a = generateHeavenLaw(Rng.root(s).fork("heaven", "law"), ev);
      const b = generateHeavenLaw(Rng.root(s).fork("heaven", "law"), ev);
      expect(a).toEqual(b);
      expect(a.strength).toBeGreaterThanOrEqual(HEAVEN_STRENGTH[0]);
      expect(a.strength).toBeLessThanOrEqual(HEAVEN_STRENGTH[1]);
      expect(a.threshold).toBe(heavenThreshold(a.strength));
      expect(a.originEventId).toBe(ev);
    }
  });

  it("a más fuerza, umbral más bajo", () => {
    expect(heavenThreshold(0)).toBe(THRESHOLD_TOP);
    expect(heavenThreshold(1)).toBeCloseTo(THRESHOLD_TOP - THRESHOLD_DROP);
    expect(heavenThreshold(0.8)).toBeLessThan(heavenThreshold(0.3));
  });

  it("la tribulación llega solo arriba: los primeros umbrales nunca la llaman y el último siempre", () => {
    const elements = { id: "wuxing", elements: ["wood", "fire", "earth", "metal", "water"] };
    for (let s = 1; s <= 40; s++) {
      const law = generateCultivationLaw(Rng.root(s).fork("cultivation", "law"), elements, ev);
      const heaven = generateHeavenLaw(Rng.root(s).fork("heaven", "law"), ev);
      const due = (law.paths[0]?.thresholds ?? []).map((t) =>
        tribulationDue(heaven, t.transgression),
      );
      expect(due[0]).toBe(false);
      expect(due[1]).toBe(false);
      expect(due[due.length - 1]).toBe(true);
      // Monótona: una vez que la llama, los de arriba también.
      const first = due.indexOf(true);
      expect(due.slice(first).every(Boolean)).toBe(true);
    }
  });

  it("un Cielo fuerte la llama antes que uno débil", () => {
    const strong = { strength: 0.85, threshold: heavenThreshold(0.85), originEventId: ev };
    const weak = { strength: 0.25, threshold: heavenThreshold(0.25), originEventId: ev };
    expect(tribulationDue(strong, 0.2)).toBe(true);
    expect(tribulationDue(weak, 0.2)).toBe(false);
  });
});
