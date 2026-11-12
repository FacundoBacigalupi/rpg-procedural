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
  WAVES,
  waveCount,
  waveForce,
  waveTemper,
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

describe("las olas de la tribulación (novel2-trib-waves)", () => {
  const strong = { strength: 0.85, threshold: heavenThreshold(0.85), originEventId: ev };
  const weak = { strength: 0.25, threshold: heavenThreshold(0.25), originEventId: ev };
  const hold = { capacity: 100, qi: 100, foundation: 1, health: 1 };

  it("más ofensa y más Cielo, más olas, dentro del rango", () => {
    expect(waveCount(weak, 0)).toBe(WAVES[0]);
    expect(waveCount(strong, 1)).toBeGreaterThan(waveCount(weak, 1));
    for (const t of [0, 0.3, 0.6, 1]) {
      expect(waveCount(strong, t)).toBeGreaterThanOrEqual(WAVES[0]);
      expect(waveCount(strong, t)).toBeLessThanOrEqual(WAVES[1]);
    }
  });

  it("lo que aguanta frena la ola: vacío, sin fundamento o herido pega más", () => {
    const base = waveForce(3, hold, 0.5);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(1);
    expect(waveForce(3, { ...hold, qi: 0 }, 0.5)).toBeGreaterThan(base);
    expect(waveForce(3, { ...hold, foundation: 0 }, 0.5)).toBeGreaterThan(base);
    expect(waveForce(3, { ...hold, health: 0.3 }, 0.5)).toBeGreaterThan(base);
    expect(waveForce(6, hold, 0.5)).toBeGreaterThan(base);
    expect(waveForce(0, hold, 0.5)).toBe(0);
    expect(waveForce(1e6, hold, 1)).toBe(1);
  });

  it("templa en proporción a lo que pegó", () => {
    expect(waveTemper(0)).toBe(0);
    expect(waveTemper(0.6)).toBeGreaterThan(waveTemper(0.3));
    expect(waveTemper(5)).toBe(waveTemper(1));
  });
});
