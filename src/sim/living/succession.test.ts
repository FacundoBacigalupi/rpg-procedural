import { describe, expect, it } from "vitest";
import {
  abandonedField,
  advanceSuccession,
  burnOff,
  disturb,
  fireHazard,
  minAgeSinceAbandonment,
  type PatchVegetation,
  type SuccessionConditions,
  type Trajectory,
  woodQiShare,
} from "./succession.ts";

const FOREST: Trajectory = {
  id: "temperate_humid",
  climax: "old_growth",
  years: {
    bare: 200,
    pioneer: 5,
    grass_shrub: 15,
    young_forest: 40,
    mature_forest: 120,
    old_growth: 0,
  },
};
const STEPPE: Trajectory = { ...FOREST, id: "steppe", climax: "grass_shrub" };
const GOOD: SuccessionConditions = { vigor: 1, seedSource: 1, soilDepth: 30 };

describe("sucesión y fuego", () => {
  it("un campo abandonado vuelve bosque en décadas y bosque viejo en siglos", () => {
    const f = abandonedField(FOREST);
    expect(advanceSuccession(f, GOOD, 10).stage).toBe("grass_shrub");
    expect(advanceSuccession(f, GOOD, 40).stage).toBe("young_forest");
    expect(advanceSuccession(f, GOOD, 400).stage).toBe("old_growth");
  });

  it("la estepa se queda en pastizal", () => {
    expect(advanceSuccession(abandonedField(STEPPE), GOOD, 1000).stage).toBe("grass_shrub");
  });

  it("sin semillas cerca o sobre roca sin suelo tarda más o espera", () => {
    const f = abandonedField(FOREST);
    const far = advanceSuccession(f, { ...GOOD, seedSource: 0.2 }, 60);
    expect(far.stage).not.toBe("young_forest");
    const rock: PatchVegetation = { ...f, stage: "bare" };
    expect(advanceSuccession(rock, { ...GOOD, soilDepth: 0 }, 5000).stage).toBe("bare");
  });

  it("el avance es el mismo en un paso largo que en muchos cortos", () => {
    const f = abandonedField(FOREST);
    let step = f;
    for (let i = 0; i < 100; i++) step = advanceSuccession(step, GOOD, 1);
    expect(step.stage).toBe(advanceSuccession(f, GOOD, 100).stage);
  });

  it("el fuego baja etapas y gasta el combustible; el arado deja suelo pelado", () => {
    const old = advanceSuccession(abandonedField(FOREST), GOOD, 500);
    const burnt = disturb(old, "fire");
    expect(burnt.stage).toBe("young_forest");
    expect(burnt.fuel).toBeLessThan(old.fuel);
    expect(disturb(old, "plough").stage).toBe("bare");
  });

  it("el hazard crece con el combustible: prohibir las quemas acumula la presión", () => {
    const young = { ...advanceSuccession(abandonedField(FOREST), GOOD, 100), fuel: 0.1 };
    const loaded = { ...young, fuel: 1 };
    expect(fireHazard(loaded, 0.8, 0.01)).toBeGreaterThan(fireHazard(young, 0.8, 0.01));
    expect(fireHazard(loaded, 0, 0.01)).toBe(0);
    const trimmed = burnOff(loaded, "controlled", 1);
    expect(fireHazard(trimmed, 0.8, 0.01)).toBeLessThan(fireHazard(loaded, 0.8, 0.01));
  });

  it("la edad del bosque dice cuánto hace del abandono, y solo el viejo guarda qi de madera", () => {
    const grown = advanceSuccession(abandonedField(FOREST), GOOD, 100);
    expect(minAgeSinceAbandonment(grown)).toBeGreaterThanOrEqual(60);
    expect(woodQiShare(advanceSuccession(abandonedField(FOREST), GOOD, 500))).toBe(1);
    expect(woodQiShare(grown)).toBeLessThan(1);
  });
});
