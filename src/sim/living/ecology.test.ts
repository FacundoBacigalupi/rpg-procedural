import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import {
  dailyProductivity,
  initialCell,
  LINEAGES,
  lineageOf,
  pickTrajectory,
  TRAJECTORIES,
} from "./ecology.ts";
import { trophicStep } from "./trophic.ts";

const file = (kind: string, name: string) => {
  const path = `content/${kind}/${name}`;
  return { kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) };
};

describe("ecología de la celda", () => {
  it("hace falta clima cálido y agua para producir", () => {
    const o = { annualPrecipMm: 800, soilFertility: 0.9, hexes: 7 };
    expect(dailyProductivity({ ...o, tempMeanC: -5 })).toBe(0);
    expect(dailyProductivity({ ...o, tempMeanC: 18 })).toBeGreaterThan(
      dailyProductivity({ ...o, tempMeanC: 8 }),
    );
    expect(dailyProductivity({ ...o, tempMeanC: 18, annualPrecipMm: 100 })).toBeLessThan(
      dailyProductivity({ ...o, tempMeanC: 18 }),
    );
  });
});

describe("contenido de linajes", () => {
  const content = loadContent(
    [LINEAGES, TRAJECTORIES],
    [file("lineages", "temperate.json"), file("trajectories", "temperate.json")],
  );
  const defs = content.all(LINEAGES);

  it("las trayectorias eligen por lluvia", () => {
    const t = content.all(TRAJECTORIES);
    expect(pickTrajectory(t, 200)?.id).toBe("steppe");
    expect(pickTrajectory(t, 700)?.id).toBe("woodland");
    expect(pickTrajectory(t, 1500)?.id).toBe("wet_forest");
  });

  it("veinte años de red trófica con comida normal no extinguen a nadie ni explotan", () => {
    const lineages = Object.fromEntries(defs.map((d) => [d.id, lineageOf(d)]));
    const productivity = dailyProductivity({
      tempMeanC: 10,
      annualPrecipMm: 800,
      soilFertility: 0.9,
      hexes: 7,
    });
    let cell = initialCell(defs, {
      annualMeanC: 10,
      annualPrecipMm: 800,
      hexes: 7,
      shelter: 0.5,
      productivity,
    });
    const start = Object.fromEntries(cell.populations.map((p) => [p.lineage, p.count]));
    for (let d = 0; d < 20 * 73; d++) cell = trophicStep(cell, lineages, 5).next;
    for (const p of cell.populations) {
      expect(p.count).toBeGreaterThan(0);
      expect(p.count).toBeLessThan((start[p.lineage] ?? 1) * 20);
    }
  });
});
