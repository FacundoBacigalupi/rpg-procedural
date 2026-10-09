import { describe, expect, it } from "vitest";
import {
  type CellEcology,
  harvestStock,
  intakePerPredator,
  type Lineage,
  trophicStep,
} from "./trophic.ts";

const DEER: Lineage = {
  id: "deer",
  kingdom: "herbivore",
  growth: 0.01,
  mortality: 0.003,
  bodyMass: 60,
  maxIntake: 0,
  halfSaturation: 1,
  efficiency: 0,
};
const WOLF: Lineage = {
  id: "wolf",
  kingdom: "carnivore",
  growth: 0,
  mortality: 0.002,
  bodyMass: 35,
  diet: { deer: 1 },
  maxIntake: 0.05,
  halfSaturation: 50,
  efficiency: 0.2,
};
const LINEAGES = { deer: DEER, wolf: WOLF };

function run(cell: CellEcology, steps: number): CellEcology {
  let c = cell;
  for (let i = 0; i < steps; i++) c = trophicStep(c, LINEAGES, 5).next;
  return c;
}
const count = (c: CellEcology, id: string): number =>
  c.populations.find((p) => p.lineage === id)?.count ?? 0;

describe("red trófica por celda", () => {
  it("la respuesta funcional satura", () => {
    const lo = intakePerPredator(WOLF, 10, 0);
    const hi = intakePerPredator(WOLF, 1000, 0);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(WOLF.maxIntake);
    expect(intakePerPredator(WOLF, 1000, 0.9)).toBeLessThan(hi);
  });

  it("los ciervos crecen hasta que la comida los frena, sin tope escrito", () => {
    const cell: CellEcology = {
      productivity: 500,
      shelter: 0,
      populations: [{ lineage: "deer", count: 20 }],
    };
    const after = run(cell, 400);
    const n = count(after, "deer");
    expect(n).toBeGreaterThan(20);
    // Comida para ~ productivity / (masa * consumo) individuos: no se pasa mucho.
    expect(n).toBeLessThan((500 / (60 * 0.08)) * 3);
  });

  it("sin comida los herbívoros se extinguen en la celda y el paso lo informa", () => {
    let c: CellEcology = {
      productivity: 0,
      shelter: 0,
      populations: [{ lineage: "deer", count: 5 }],
    };
    const gone: string[] = [];
    for (let i = 0; i < 600 && gone.length === 0; i++) {
      const s = trophicStep(c, LINEAGES, 5);
      c = s.next;
      gone.push(...s.extinct);
    }
    expect(gone).toEqual(["deer"]);
  });

  it("los lobos comen ciervos y los ciervos se llevan la caza: más lobos, menos ciervos", () => {
    const base: CellEcology = {
      productivity: 800,
      shelter: 0,
      populations: [{ lineage: "deer", count: 150 }],
    };
    const withWolves: CellEcology = {
      ...base,
      populations: [...base.populations, { lineage: "wolf", count: 10 }],
    };
    expect(count(run(withWolves, 40), "deer")).toBeLessThan(count(run(base, 40), "deer"));
    const step = trophicStep(withWolves, LINEAGES, 5);
    expect(step.eaten["deer"]).toBeGreaterThan(0);
  });

  it("es determinista", () => {
    const cell: CellEcology = {
      productivity: 600,
      shelter: 0.3,
      populations: [
        { lineage: "deer", count: 100 },
        { lineage: "wolf", count: 6 },
      ],
    };
    expect(run(cell, 50)).toEqual(run(cell, 50));
  });

  it("cazar baja el rendimiento por hora cuando el stock baja", () => {
    const full = harvestStock(200, 10, 0.01);
    const thin = harvestStock(20, 10, 0.01);
    expect(full.perHour).toBeGreaterThan(thin.perHour);
    expect(full.caught + full.left).toBeCloseTo(200, 8);
    expect(harvestStock(0, 10, 0.01).caught).toBe(0);
  });
});
