import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { LocalMap } from "../world/index.ts";
import { dailyWeather } from "./daily.ts";
import { anomalyOfMap, rainBetween, weatherAt } from "./local.ts";

const base: LocalMap = {
  cell: "c:1" as never,
  lonDeg: 0,
  neighbors: [[]],
  crossSeconds: [1],
  forest: [false],
  climate: {
    cell: "c:1",
    latDeg: 45,
    axialTiltDeg: 23.4,
    annualMeanC: 9,
    seasonalRangeC: 22,
    annualPrecipMm: 800,
    windEast: 1,
    windNorth: 0.3,
  },
};
const coastal: LocalMap = { ...base, oscillation: { basin: "basin-3", teleconnection: 1 } };
const clock = EARTHLIKE_CLOCK;
const yearDays = Math.round(clock.year / clock.day);

describe("la anomalía del mapa local", () => {
  it("sin cuenca no hay anomalía y el tiempo es el de las normales", () => {
    expect(anomalyOfMap(base, clock, 5)).toBeUndefined();
    const w = weatherAt(base, clock, 5, 400 * clock.day);
    expect(w).toEqual(dailyWeather(base.climate, clock, 400, Rng.root(5)));
  });

  it("con cuenca es determinista y cambia el tiempo de algún año", () => {
    const f = anomalyOfMap(coastal, clock, 5);
    expect(f).toBeDefined();
    expect(anomalyOfMap(coastal, clock, 5)).toBe(f);
    let differs = 0;
    for (let y = 0; y < 12; y++) {
      const t = (y * yearDays + 100) * clock.day;
      const a = weatherAt(coastal, clock, 5, t);
      expect(weatherAt(coastal, clock, 5, t)).toEqual(a);
      if (JSON.stringify(a) !== JSON.stringify(weatherAt(base, clock, 5, t))) differs++;
    }
    expect(differs).toBeGreaterThan(3);
  });

  it("la lluvia entre ticks también lee la anomalía", () => {
    let differs = 0;
    for (let y = 0; y < 12; y++) {
      const from = y * yearDays * clock.day;
      const to = from + 40 * clock.day;
      if (rainBetween(coastal, clock, 5, from, to) !== rainBetween(base, clock, 5, from, to))
        differs++;
    }
    expect(differs).toBeGreaterThan(3);
  });
});
