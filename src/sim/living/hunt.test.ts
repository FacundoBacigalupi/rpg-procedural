import { describe, expect, it } from "vitest";
import { HUNT_BREEDERS, huntStep } from "./hunt.ts";
import type { CellEcology, Lineage } from "./trophic.ts";

const deer: Lineage = {
  id: "deer",
  kingdom: "herbivore",
  growth: 0.004,
  mortality: 0.0015,
  bodyMass: 60,
  maxIntake: 0,
  halfSaturation: 1,
  efficiency: 0,
};
const wolf: Lineage = { ...deer, id: "wolf", kingdom: "carnivore", diet: { deer: 1 } };
const lineages = { deer, wolf };
const cell = (n: number): CellEcology => ({
  productivity: 100,
  shelter: 0,
  populations: [
    { lineage: "deer", count: n },
    { lineage: "wolf", count: 3 },
  ],
});

describe("caza de la gente", () => {
  it("saca individuos enteros, deja carne por masa y no toca carnívoros", () => {
    let owed: Record<string, number> = {};
    let c = cell(400);
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const s = huntStep(c, lineages, owed, 1, 4);
      owed = { ...s.owed };
      c = s.next;
      for (const n of Object.values(s.taken)) expect(Number.isInteger(n)).toBe(true);
      total += s.taken["deer"] ?? 0;
      expect(s.grams).toBe(Math.round((s.taken["deer"] ?? 0) * 60 * 1000 * 0.4));
    }
    expect(total).toBeGreaterThan(0);
    expect(c.populations.find((p) => p.lineage === "deer")?.count).toBe(400 - total);
    expect(c.populations.find((p) => p.lineage === "wolf")?.count).toBe(3);
  });

  it("el rendimiento por hora baja con el stock y hay un piso de reproductores", () => {
    const rich = huntStep(cell(400), lineages, {}, 1);
    const poor = huntStep(cell(20), lineages, {}, 1);
    expect(rich.perHour["deer"]).toBeGreaterThan(poor.perHour["deer"] ?? 0);
    const crowd = huntStep(cell(HUNT_BREEDERS + 1), lineages, { deer: 50 }, 1);
    expect(crowd.taken["deer"]).toBe(1);
    expect(huntStep(cell(HUNT_BREEDERS), lineages, { deer: 50 }, 1).taken["deer"]).toBeUndefined();
  });
});
