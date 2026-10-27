import { describe, expect, it } from "vitest";
import { predatorHunger } from "./predation.ts";
import type { Lineage } from "./trophic.ts";

const deer: Lineage = {
  id: "deer",
  kingdom: "herbivore",
  growth: 0.003,
  mortality: 0.0005,
  bodyMass: 60,
  maxIntake: 0,
  halfSaturation: 1,
  efficiency: 0,
};
const wolf: Lineage = {
  id: "wolf",
  kingdom: "carnivore",
  growth: 0,
  mortality: 0.0006,
  bodyMass: 35,
  diet: { deer: 1 },
  maxIntake: 0.05,
  halfSaturation: 20,
  efficiency: 0.25,
};
const lineages = { deer, wolf };
const cell = (n: number, shelter = 0) => ({
  productivity: 100,
  shelter,
  populations: [
    { lineage: "deer", count: n },
    { lineage: "wolf", count: 5 },
  ],
});

describe("el hambre del depredador (livestock-predators)", () => {
  it("baja con más presa, sube con refugio y es plena sin presa", () => {
    expect(predatorHunger(wolf, cell(0), lineages)).toBe(1);
    const few = predatorHunger(wolf, cell(10), lineages);
    const many = predatorHunger(wolf, cell(1000), lineages);
    expect(many).toBeLessThan(few);
    expect(many).toBeGreaterThan(0);
    expect(predatorHunger(wolf, cell(1000, 1), lineages)).toBeGreaterThan(many);
    expect(predatorHunger(deer, cell(1000), lineages)).toBe(0);
  });
});
