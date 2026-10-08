import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import { harvestSeason } from "./harvest.ts";
import { SOIL_FLOOR, SOIL_START, soilAfter } from "./soil.ts";

const FULL_DAY = 20 * 8 * 110;

describe("suelo", () => {
  it("con la cosecha plena de siempre se queda donde empezó", () => {
    expect(soilAfter(SOIL_START, FULL_DAY, FULL_DAY, 1)).toBeCloseTo(SOIL_START, 10);
    expect(soilAfter(SOIL_START, 100 * FULL_DAY, FULL_DAY, 100)).toBeCloseTo(SOIL_START, 10);
  });

  it("sin cosecha se recupera hacia 1 y sin pasarse", () => {
    let f = 0.5;
    for (let d = 0; d < 400; d++) f = soilAfter(f, 0, FULL_DAY, 1);
    expect(f).toBeGreaterThan(0.98);
    expect(f).toBeLessThanOrEqual(1);
  });

  it("exprimirlo lo baja, con piso", () => {
    let f = SOIL_START;
    for (let d = 0; d < 2000; d++) f = soilAfter(f, 4 * FULL_DAY, FULL_DAY, 1);
    expect(f).toBeLessThan(SOIL_START - 0.2);
    expect(f).toBeGreaterThanOrEqual(SOIL_FLOOR);
  });

  it("más cosecha nunca deja más fertilidad", () => {
    fc.assert(
      fc.property(
        fc.double({ min: SOIL_FLOOR, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true }),
        (f, a, b, days) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(soilAfter(f, hi * FULL_DAY * days, FULL_DAY, days)).toBeLessThanOrEqual(
            soilAfter(f, lo * FULL_DAY * days, FULL_DAY, days) + 1e-12,
          );
        },
      ),
    );
  });

  it("un tramo largo da lo mismo que sus días uno por uno", () => {
    let f = 0.8;
    for (let d = 0; d < 10; d++) f = soilAfter(f, FULL_DAY, FULL_DAY, 1);
    expect(soilAfter(0.8, 10 * FULL_DAY, FULL_DAY, 10)).toBeCloseTo(f, 9);
  });
});

describe("suelo medido por clima (Hito 1c, cierre PR b)", () => {
  // Medido el 2026-10-08 con un trabajador-día de 10 h × 110 g/h contra la estación de cada clima,
  // 30 años (se descartan los primeros 5): con la mano de obra de siempre la fertilidad media queda
  // en 0,90-0,93 y oscila en el año 0,01 (trópico), 0,06 (mediterráneo), 0,13 (templado), 0,20
  // (estepa) y 0,26 (taiga): el invierno la repone y el verano la gasta. Con el triple de mano de
  // obra la media baja solo a ~0,80: el suelo es casi inerte y se recupera en ~100 días, mucho más
  // rápido que un barbecho real (años). Calibración abierta contra cultivo real (ROADMAP).
  const clock = EARTHLIKE_CLOCK;
  const yearDays = Math.round(clock.year / clock.day);
  const temperate: ClimateNormals = {
    cell: "c:1",
    latDeg: 45,
    axialTiltDeg: 23.4,
    annualMeanC: 9,
    seasonalRangeC: 22,
    annualPrecipMm: 800,
    windEast: 1,
    windNorth: 0.3,
  };
  const climates: Record<string, ClimateNormals> = {
    tropico: { ...temperate, latDeg: 5, annualMeanC: 26, seasonalRangeC: 3, annualPrecipMm: 2000 },
    templado: temperate,
    taiga: { ...temperate, latDeg: 60, annualMeanC: 0, seasonalRangeC: 30, annualPrecipMm: 500 },
  };

  function measure(n: ClimateNormals, labor: number) {
    const season = harvestSeason(n, clock, Rng.root(7));
    let f = SOIL_START;
    const kept: number[] = [];
    for (let d = 0; d < 30 * yearDays; d++) {
      f = soilAfter(f, labor * 10 * 110 * season(d) * f, 10 * 110, 1);
      if (d >= 5 * yearDays) kept.push(f);
    }
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    return { mean, swing: Math.max(...kept) - Math.min(...kept) };
  }

  it("con la mano de obra de siempre queda cerca del asiento y oscila más donde hay invierno", () => {
    const tropics = measure(climates["tropico"] as ClimateNormals, 1);
    const mild = measure(climates["templado"] as ClimateNormals, 1);
    const cold = measure(climates["taiga"] as ClimateNormals, 1);
    for (const m of [tropics, mild, cold]) {
      expect(m.mean).toBeGreaterThan(0.88);
      expect(m.mean).toBeLessThan(0.95);
    }
    expect(tropics.swing).toBeLessThan(0.03);
    expect(mild.swing).toBeGreaterThan(0.08);
    expect(cold.swing).toBeGreaterThan(mild.swing);
  });

  it("más manos en el campo bajan la fertilidad media, sin llegar al piso", () => {
    for (const n of Object.values(climates)) {
      const one = measure(n, 1).mean;
      const three = measure(n, 3).mean;
      expect(three).toBeLessThan(one - 0.08);
      expect(three).toBeGreaterThan(SOIL_FLOOR + 0.3);
    }
  });
});
