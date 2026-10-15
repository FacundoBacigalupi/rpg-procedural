import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import { wetDayChance } from "./daily.ts";
import { actualRain, foreseenRainChance, rainedToday, sharedBlockDays } from "./rain-forecast.ts";

const clock = EARTHLIKE_CLOCK;
const normals: ClimateNormals = {
  cell: "c:1",
  latDeg: 45,
  axialTiltDeg: 23.4,
  annualMeanC: 9,
  seasonalRangeC: 22,
  annualPrecipMm: 800,
  windEast: 1,
  windNorth: 0.3,
};

describe("pronóstico popular de la lluvia", () => {
  it("es determinista y no recibe el tiempo de los días que pronostica", () => {
    const a = foreseenRainChance(normals, 100, 3, true);
    expect(foreseenRainChance(normals, 100, 3, true)).toBe(a);
    // Sólo toma las normales, el día, el horizonte y lo que vio hoy: ni generador ni reloj.
    expect(foreseenRainChance.length).toBe(4);
  });

  it("llover hoy sube mañana si el bloque sigue y no cambia nada si se acaba", () => {
    const mid = 99; // quedan 2 días del bloque
    const edge = 101; // último día del bloque
    expect(sharedBlockDays(mid, 3)).toBe(2);
    expect(sharedBlockDays(edge, 3)).toBe(0);
    expect(foreseenRainChance(normals, mid, 1, true)).toBeGreaterThan(
      foreseenRainChance(normals, mid, 1, false),
    );
    expect(foreseenRainChance(normals, edge, 1, true)).toBe(
      foreseenRainChance(normals, edge, 1, false),
    );
    expect(foreseenRainChance(normals, edge, 1, true)).toBeCloseTo(
      wetDayChance(normals.annualPrecipMm),
      2,
    );
  });

  it("más días, más chance; el desierto casi no espera lluvia", () => {
    const desert = { ...normals, annualPrecipMm: 30 };
    expect(foreseenRainChance(normals, 101, 7, false)).toBeGreaterThan(
      foreseenRainChance(normals, 101, 1, false),
    );
    expect(foreseenRainChance(desert, 101, 3, false)).toBeLessThan(0.2);
  });

  it("acierta mejor que el clima solo mañana (Brier) cuando el bloque sigue", () => {
    let brier = 0;
    let brierClim = 0;
    let n = 0;
    const clim = wetDayChance(normals.annualPrecipMm);
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = Rng.root(seed);
      for (let day = 30; day < 30 + 720; day++) {
        if (sharedBlockDays(day, 1) < 1) continue;
        const guess = foreseenRainChance(normals, day, 1, rainedToday(normals, clock, rng, day));
        const truth = actualRain(normals, clock, rng, day, 1) ? 1 : 0;
        brier += (guess - truth) ** 2;
        brierClim += (clim - truth) ** 2;
        n++;
      }
    }
    expect(brier / n).toBeLessThan(brierClim / n);
  });

  it("está calibrado: lo que dice a 3 días pasa con esa frecuencia", () => {
    let said = 0;
    let happened = 0;
    let n = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = Rng.root(seed);
      for (let day = 30; day < 30 + 720; day++) {
        said += foreseenRainChance(normals, day, 3, rainedToday(normals, clock, rng, day));
        happened += actualRain(normals, clock, rng, day, 3) ? 1 : 0;
        n++;
      }
    }
    expect(Math.abs(said / n - happened / n)).toBeLessThan(0.05);
  });
});
