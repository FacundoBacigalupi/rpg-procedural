import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import {
  anomalyOfDay,
  MAX_PERIOD_YEARS,
  MIN_PERIOD_YEARS,
  oscillationAnomaly,
  oscillationCause,
  oscillationFor,
  oscillationValue,
} from "./oscillation.ts";

describe("oscilaciones oceánicas", () => {
  it("es determinista y el período cae en 2-7 años", () => {
    const a = oscillationFor("pacific", Rng.root(5));
    expect(oscillationFor("pacific", Rng.root(5))).toEqual(a);
    for (const b of ["a", "b", "c", "d", "e"]) {
      const o = oscillationFor(b, Rng.root(9));
      expect(o.periodYears).toBeGreaterThanOrEqual(MIN_PERIOD_YEARS);
      expect(o.periodYears).toBeLessThanOrEqual(MAX_PERIOD_YEARS);
    }
  });

  it("la misma fase seca un lado de la cuenca y moja el otro", () => {
    const o = oscillationFor("p", Rng.root(3));
    let year = 0;
    while (Math.abs(oscillationValue(o, year)) < 0.3) year++;
    const east = oscillationAnomaly(o, year, 1);
    const west = oscillationAnomaly(o, year, -1);
    expect((east.precipFactor - 1) * (west.precipFactor - 1)).toBeLessThan(0);
    expect(oscillationCause(o, year).phase).not.toBe("neutral");
  });

  it("hay años buenos y malos y el promedio queda cerca de lo normal", () => {
    const o = oscillationFor("p", Rng.root(11));
    const f = Array.from({ length: 140 }, (_, y) => oscillationAnomaly(o, y, 0.8).precipFactor);
    expect(Math.min(...f)).toBeLessThan(0.9);
    expect(Math.max(...f)).toBeGreaterThan(1.1);
    expect(f.reduce((s, x) => s + x, 0) / f.length).toBeGreaterThan(0.95);
    expect(f.reduce((s, x) => s + x, 0) / f.length).toBeLessThan(1.05);
  });

  it("anomalyOfDay usa el año del reloj", () => {
    const o = oscillationFor("p", Rng.root(2));
    const yd = Math.round(EARTHLIKE_CLOCK.year / EARTHLIKE_CLOCK.day);
    const at = anomalyOfDay(o, EARTHLIKE_CLOCK, 1);
    expect(at(yd * 3 + 5)).toEqual(oscillationAnomaly(o, 3, 1));
  });
});
