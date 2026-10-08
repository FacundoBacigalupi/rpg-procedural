import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import { dailyWeather, seasonWave, skyClearness, tempAt, yearPhase } from "./daily.ts";

const clock = EARTHLIKE_CLOCK;
const YEAR_DAYS = Math.round(clock.year / clock.day);

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
const desert: ClimateNormals = {
  ...temperate,
  cell: "c:2",
  latDeg: 25,
  annualMeanC: 24,
  annualPrecipMm: 60,
};
const polar: ClimateNormals = {
  ...temperate,
  cell: "c:3",
  latDeg: 75,
  annualMeanC: -14,
  annualPrecipMm: 250,
};

const years = (n: ClimateNormals, count: number, seed = 7) => {
  const rng = Rng.root(seed);
  const out = [];
  for (let d = 0; d < count * YEAR_DAYS; d++) out.push(dailyWeather(n, clock, d, rng));
  return out;
};

describe("tiempo diario", () => {
  it("es determinista y no depende de qué días se pidieron antes", () => {
    const a = dailyWeather(temperate, clock, 400, Rng.root(1));
    const rng = Rng.root(1);
    for (let d = 0; d < 400; d++) dailyWeather(temperate, clock, d, rng);
    expect(dailyWeather(temperate, clock, 400, rng)).toEqual(a);
    expect(dailyWeather(temperate, clock, 400, Rng.root(2))).not.toEqual(a);
  });

  it("el promedio de varios años coincide con las normales", () => {
    const days = years(temperate, 20);
    const mean = days.reduce((s, w) => s + w.tempMeanC, 0) / days.length;
    const rain = days.reduce((s, w) => s + w.precip.mm, 0) / 20;
    expect(mean).toBeGreaterThan(temperate.annualMeanC - 0.7);
    expect(mean).toBeLessThan(temperate.annualMeanC + 0.7);
    expect(rain).toBeGreaterThan(temperate.annualPrecipMm * 0.85);
    expect(rain).toBeLessThan(temperate.annualPrecipMm * 1.15);
  });

  it("el verano es más cálido que el invierno y el sur invierte las estaciones", () => {
    const north = years(temperate, 5);
    const south = years({ ...temperate, cell: "c:4", latDeg: -45 }, 5);
    const at = (ws: typeof north, phase: number) => {
      const xs = ws.filter((w) => Math.abs(yearPhase(clock, w.day) - phase) < 0.04);
      return xs.reduce((s, w) => s + w.tempMeanC, 0) / xs.length;
    };
    expect(at(north, 0.27)).toBeGreaterThan(at(north, 0.77) + 15);
    expect(at(south, 0.27)).toBeLessThan(at(south, 0.77) - 15);
    expect(seasonWave(clock, 0, 45)).toBe(-seasonWave(clock, 0, -45));
  });

  it("nada imposible: no nieva con calor ni llueve con helada fuerte", () => {
    for (const n of [temperate, desert, polar]) {
      for (const w of years(n, 10)) {
        if (w.precip.kind === "snow") expect(w.tempMeanC).toBeLessThanOrEqual(-1);
        if (w.precip.kind === "rain") expect(w.tempMeanC).toBeGreaterThan(2);
        if (w.precip.mm === 0) expect(w.precip.kind).toBe("none");
        expect(w.tempMinC).toBeLessThanOrEqual(w.tempMaxC);
        expect(w.cloud).toBeGreaterThanOrEqual(0);
        expect(w.cloud).toBeLessThanOrEqual(1);
      }
    }
  });

  it("el desierto llueve poco y la zona polar nieva", () => {
    const dry = years(desert, 20).reduce((s, w) => s + w.precip.mm, 0) / 20;
    expect(dry).toBeLessThan(90);
    const snow = years(polar, 5).filter((w) => w.precip.kind === "snow").length;
    const rain = years(polar, 5).filter((w) => w.precip.kind === "rain").length;
    expect(snow).toBeGreaterThan(rain * 5);
  });

  it("la lluvia viene en rachas (más que si cada día fuera independiente)", () => {
    const days = years(temperate, 20).map((w) => w.precip.mm > 0);
    const p = days.filter(Boolean).length / days.length;
    let both = 0;
    for (let i = 1; i < days.length; i++) if (days[i] && days[i - 1]) both++;
    expect(both / days.length).toBeGreaterThan(p * p * 1.5);
  });

  it("la anomalía con causa corre la temperatura y la lluvia", () => {
    const rng = Rng.root(3);
    let dry = 0;
    let base = 0;
    for (let d = 0; d < 10 * YEAR_DAYS; d++) {
      dry += dailyWeather(temperate, clock, d, rng, { tempOffsetC: 0, precipFactor: 0.4 }).precip
        .mm;
      base += dailyWeather(temperate, clock, d, rng).precip.mm;
    }
    expect(dry).toBeLessThan(base * 0.6);
  });

  it("de día hace más calor que de madrugada y las nubes quitan luz", () => {
    const w = dailyWeather(temperate, clock, 100, Rng.root(5));
    expect(tempAt(w, 15)).toBeGreaterThan(tempAt(w, 3));
    expect(skyClearness({ ...w, cloud: 0, precip: { kind: "none", mm: 0 } })).toBe(1);
    expect(skyClearness({ ...w, cloud: 1, precip: { kind: "rain", mm: 5 } })).toBeLessThan(0.5);
  });
});
