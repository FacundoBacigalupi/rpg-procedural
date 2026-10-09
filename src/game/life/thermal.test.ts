import { describe, expect, it } from "vitest";
import { stepCore, TEMPERATE, thermalDeath } from "../../sim/index.ts";
import { seasonalClothing, thermalProcess } from "./thermal.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };

describe("life.thermal", () => {
  it("la ropa de estación abriga más cuanto más frío", () => {
    expect(seasonalClothing(-10).clo).toBeGreaterThan(seasonalClothing(20).clo);
    expect(seasonalClothing(40).clo).toBeGreaterThanOrEqual(0.5);
  });

  it("con ropa de estación el clima templado deja el núcleo en lo normal", () => {
    let core = 37;
    for (let i = 0; i < 96; i++) {
      core = stepCore(core, 70, TEMPERATE, seasonalClothing(TEMPERATE.airC), 1, 1, 0.25).coreC;
    }
    expect(Math.abs(core - 37)).toBeLessThan(0.5);
    expect(thermalDeath(core)).toBeNull();
  });

  it("es un proceso diario de la vida", () => {
    const p = thermalProcess({
      clock,
      map: {} as never,
      spaces: { spaces: [] } as never,
      seed: 1 as never,
      placeOf: () => ({ kind: "cell", cell: "cell:1" }) as never,
    });
    expect(p.id).toBe("life.thermal");
    expect(p.cadence.local).toBe("day");
  });
});
