import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import { dailyWeather } from "../weather/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import {
  HAIL_CHANCE,
  HAIL_LOSS,
  HAIL_MELT_C,
  HAIL_RECOVERY_DAYS,
  hailChance,
  hailPossible,
  hailStanding,
  harvestSeason,
} from "./harvest.ts";

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
const tropics: ClimateNormals = {
  ...temperate,
  cell: "c:2",
  latDeg: 5,
  annualMeanC: 26,
  seasonalRangeC: 3,
  annualPrecipMm: 2000,
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("cosecha por estación", () => {
  it("el año entero rinde como el parejo (media 1 sobre el año normalizado)", () => {
    const f = harvestSeason(temperate, clock, Rng.root(3));
    const year = Array.from({ length: YEAR_DAYS }, (_, d) => f(d));
    expect(mean(year)).toBeCloseTo(1, 5);
  });

  it("en clima templado el verano rinde y el invierno no", () => {
    const f = harvestSeason(temperate, clock, Rng.root(3));
    const day = (d: number) => dailyWeather(temperate, clock, d, Rng.root(3));
    const winter = Array.from({ length: YEAR_DAYS }, (_, d) => d).filter(
      (d) => day(d).tempMeanC < 0,
    );
    const summer = Array.from({ length: YEAR_DAYS }, (_, d) => d).filter(
      (d) => day(d).tempMeanC > 18,
    );
    expect(winter.length).toBeGreaterThan(20);
    expect(summer.length).toBeGreaterThan(20);
    expect(winter.every((d) => f(d) === 0)).toBe(true);
    expect(mean(summer.map(f))).toBeGreaterThan(1.5);
  });

  it("en el trópico rinde parejo todo el año", () => {
    const f = harvestSeason(tropics, clock, Rng.root(3));
    const year = Array.from({ length: YEAR_DAYS }, (_, d) => f(d));
    expect(Math.min(...year)).toBeGreaterThan(0.3);
    expect(Math.max(...year)).toBeLessThan(2);
  });

  it("es determinista y no depende del orden en que se piden los días", () => {
    const a = harvestSeason(temperate, clock, Rng.root(3));
    const b = harvestSeason(temperate, clock, Rng.root(3));
    const v = a(200);
    b(10);
    b(300);
    expect(b(200)).toBe(v);
    expect(harvestSeason(temperate, clock, Rng.root(4))(200)).not.toBe(v);
  });

  it("el granizo solo cae con lluvia fuerte y calor, y el campo se recupera en días", () => {
    const f = harvestSeason(tropics, clock, Rng.root(3));
    const w = (d: number) => dailyWeather(tropics, clock, d, Rng.root(3));
    const days = Array.from({ length: YEAR_DAYS }, (_, d) => d);
    expect(days.some((d) => hailPossible(w(d)))).toBe(true);
    const cold = { ...w(0), precip: { kind: "rain" as const, mm: 30 }, tempMaxC: 10 };
    const dry = { ...w(0), precip: { kind: "none" as const, mm: 0 }, tempMaxC: 30 };
    expect(hailPossible(cold)).toBe(false);
    expect(hailPossible(dry)).toBe(false);
    expect(hailStanding(0)).toBeCloseTo(1 - HAIL_LOSS, 9);
    expect(hailStanding(HAIL_RECOVERY_DAYS)).toBe(1);
    expect(hailStanding(1)).toBeGreaterThan(hailStanding(0));
    // determinista
    const g = harvestSeason(tropics, clock, Rng.root(3));
    expect(days.map(g)).toEqual(days.map(f));
  });

  it("calibración: el granizo se derrite con calor y es raro en el trópico", () => {
    const w = dailyWeather(temperate, clock, 0, Rng.root(3));
    const storm = { ...w, precip: { kind: "rain" as const, mm: 30 } };
    expect(hailChance({ ...storm, tempMaxC: 20 })).toBeCloseTo(HAIL_CHANCE, 9);
    expect(hailChance({ ...storm, tempMaxC: HAIL_MELT_C })).toBe(0);
    expect(hailChance({ ...storm, tempMaxC: 26 })).toBeLessThan(HAIL_CHANCE);
    // esperados por año (suma de chances) en 20 años: templado < 1, trópico < 4
    const perYear = (n: ClimateNormals) => {
      const rng = Rng.root(1);
      let sum = 0;
      for (let d = 0; d < 20 * YEAR_DAYS; d++) {
        const day = dailyWeather(n, clock, d, rng);
        if (hailPossible(day)) sum += hailChance(day);
      }
      return sum / 20;
    };
    expect(perYear(temperate)).toBeLessThan(1);
    expect(perYear(tropics)).toBeLessThan(4);
    expect(perYear(tropics)).toBeGreaterThan(0);
  });
});

describe("años buenos y malos por la oscilación", () => {
  it("un año seco rinde menos que uno mojado, sobre la misma normalización", () => {
    const dry = harvestSeason(temperate, clock, Rng.root(3), () => ({
      tempOffsetC: 0,
      precipFactor: 0.4,
    }));
    const wet = harvestSeason(temperate, clock, Rng.root(3), () => ({
      tempOffsetC: 0,
      precipFactor: 1.6,
    }));
    const total = (f: (d: number) => number) =>
      mean(Array.from({ length: YEAR_DAYS }, (_, d) => f(d)));
    expect(total(dry)).toBeLessThan(total(wet));
    expect(total(harvestSeason(temperate, clock, Rng.root(3)))).toBeCloseTo(1, 5);
  });
});
