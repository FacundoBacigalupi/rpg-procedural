import { describe, expect, it } from "vitest";
import type { Seed, Tick } from "../../core/index.ts";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { ClimateNormals, LocalMap } from "../world/index.ts";
import { dailyWeather, seasonWave, skyClearness, tempAt, yearPhase } from "./daily.ts";
import { bearingFactor, rainBetween, walkingFactor } from "./local.ts";

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

describe("walkingFactor", () => {
  const dry = dailyWeather(temperate, clock, 100, Rng.root(1 as never));
  const base = { ...dry, precip: { kind: "none" as const, mm: 0 }, windMs: 2, tempMaxC: 15 };

  it("un día seco y templado no frena", () => {
    expect(walkingFactor(base)).toBe(1);
  });

  it("la lluvia, la nieve, el viento y el frío frenan, con tope", () => {
    const rain = walkingFactor({ ...base, precip: { kind: "rain", mm: 20 } });
    const flood = walkingFactor({ ...base, precip: { kind: "rain", mm: 500 } });
    const snow = walkingFactor({ ...base, precip: { kind: "snow", mm: 15 } });
    expect(rain).toBeGreaterThan(1);
    expect(flood).toBeLessThanOrEqual(1.4);
    expect(snow).toBeGreaterThan(rain);
    expect(walkingFactor({ ...base, windMs: 14 })).toBeGreaterThan(1);
    expect(walkingFactor({ ...base, tempMaxC: -15 })).toBeGreaterThan(1);
  });
});

describe("bearingFactor", () => {
  const dry = dailyWeather(temperate, clock, 100, Rng.root(1 as never));
  const clear = { ...dry, precip: { kind: "none" as const, mm: 0 } };

  it("de día claro y a campo abierto no suma nada", () => {
    expect(bearingFactor(clear, 1, false)).toBe(1);
  });

  it("la oscuridad, el bosque y la precipitación suman, y se acumulan", () => {
    const night = bearingFactor(clear, 0, false);
    const forest = bearingFactor(clear, 1, true);
    const rain = bearingFactor({ ...clear, precip: { kind: "rain", mm: 5 } }, 1, false);
    expect(night).toBeGreaterThan(1);
    expect(forest).toBeGreaterThan(1);
    expect(rain).toBeGreaterThan(1);
    expect(bearingFactor({ ...clear, precip: { kind: "rain", mm: 5 } }, 0, true)).toBeGreaterThan(
      Math.max(night, forest, rain),
    );
  });
});

describe("rainBetween", () => {
  const map = { cell: "c:1", lonDeg: 0, climate: temperate } as unknown as LocalMap;
  const seed = 7 as Seed;
  const day = clock.day;

  it("suma la lluvia de los días y es aditiva", () => {
    const a = rainBetween(map, clock, seed, 0 as Tick, (10 * day) as Tick);
    const b = rainBetween(map, clock, seed, (10 * day) as Tick, (20 * day) as Tick);
    const ab = rainBetween(map, clock, seed, 0 as Tick, (20 * day) as Tick);
    expect(ab).toBeGreaterThanOrEqual(a);
    expect(ab).toBeLessThanOrEqual(a + b + 40);
    expect(rainBetween(map, clock, seed, (5 * day) as Tick, (5 * day) as Tick)).toBe(0);
  });

  it("un año entero llueve cerca de lo normal y el desierto casi nada", () => {
    const wet = rainBetween(map, clock, seed, 0 as Tick, (YEAR_DAYS * day) as Tick);
    expect(wet).toBeGreaterThan(0);
    const dry = { ...map, climate: desert } as unknown as LocalMap;
    const short = rainBetween(dry, clock, seed, 0 as Tick, (30 * day) as Tick);
    expect(short).toBeLessThan(rainBetween(map, clock, seed, 0 as Tick, (120 * day) as Tick));
  });

  it("no mira más de 60 días atrás", () => {
    const far = rainBetween(map, clock, seed, 0 as Tick, (400 * day) as Tick);
    const near = rainBetween(map, clock, seed, (340 * day) as Tick, (400 * day) as Tick);
    expect(far).toBe(near);
  });
});
