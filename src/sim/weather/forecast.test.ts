import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import {
  actualMinC,
  expectedMeanC,
  FORECAST_MEMORY_DAYS,
  foreseenMinC,
  persistence,
  TYPICAL_HALF_RANGE_C,
} from "./forecast.ts";

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

function rmse(horizon: number, misread: number, seeds: readonly number[]): number {
  let sum = 0;
  let count = 0;
  for (const seed of seeds) {
    const rng = Rng.root(seed);
    for (let day = 100; day < 100 + 360; day += 3) {
      const guess = foreseenMinC(normals, clock, rng, day, horizon, misread);
      const truth = actualMinC(normals, clock, rng, day, horizon);
      sum += (guess - truth) ** 2;
      count++;
    }
  }
  return Math.sqrt(sum / count);
}

/** Lo mismo sin mirar el cielo de hoy: solo la estación esperada. */
function climatologyRmse(horizon: number, seeds: readonly number[]): number {
  let sum = 0;
  let count = 0;
  for (const seed of seeds) {
    const rng = Rng.root(seed);
    for (let day = 100; day < 100 + 360; day += 3) {
      let min = Number.POSITIVE_INFINITY;
      for (let k = 1; k <= horizon; k++) {
        min = Math.min(min, expectedMeanC(normals, clock, day + k) - TYPICAL_HALF_RANGE_C);
      }
      sum += (min - actualMinC(normals, clock, rng, day, horizon)) ** 2;
      count++;
    }
  }
  return Math.sqrt(sum / count);
}

describe("pronóstico popular del frío", () => {
  const seeds = [1, 2, 3, 4, 5];

  it("la desviación de hoy se desvanece con los días", () => {
    expect(persistence(0)).toBe(1);
    expect(persistence(FORECAST_MEMORY_DAYS / 2)).toBe(0.5);
    expect(persistence(FORECAST_MEMORY_DAYS)).toBe(0);
    expect(persistence(30)).toBe(0);
  });

  it("acierta mejor que la estación sola a uno y a tres días", () => {
    expect(rmse(1, 0, seeds)).toBeLessThan(climatologyRmse(1, seeds));
    expect(rmse(3, 0, seeds)).toBeLessThan(climatologyRmse(3, seeds));
  });

  it("quien lee mal el termómetro arrastra el error: la creencia se separa de la verdad", () => {
    const exact = rmse(2, 0, seeds);
    const off = rmse(2, 3, seeds);
    expect(off).toBeGreaterThan(exact);
    const rng = Rng.root(9);
    expect(foreseenMinC(normals, clock, rng, 150, 1, 3)).toBeGreaterThan(
      foreseenMinC(normals, clock, rng, 150, 1, 0),
    );
  });

  it("es determinista", () => {
    const a = foreseenMinC(normals, clock, Rng.root(4), 200, 3);
    expect(foreseenMinC(normals, clock, Rng.root(4), 200, 3)).toBe(a);
  });
});
