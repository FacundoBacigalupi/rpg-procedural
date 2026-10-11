import { describe, expect, it } from "vitest";
import { makeId, type Tick } from "../../core/index.ts";
import type { GoalVacuum } from "./goal-vacuum.ts";
import {
  MEANING_CALIBRATION as C,
  calibratedMeaningPressure,
  habituation,
} from "./meaning-calibration.ts";

const YEAR = 1200;
const month = YEAR / 12;
const vacuum: GoalVacuum = {
  since: 0 as Tick,
  elapsed: 0 as Tick,
  sources: [
    {
      goalId: "core:x",
      at: 0 as Tick,
      weight: 0.8,
      origin: makeId("event", 1),
      cause: makeId("event", 2),
    },
  ],
};
const at = (m: number) => Math.round(m * month) as Tick;

describe("sim.mind.meaning-calibration", () => {
  it("sube en rampa, queda en meseta y se habitúa hasta el piso sin curarse", () => {
    const p = (m: number) => calibratedMeaningPressure(vacuum, at(m), YEAR).pressure;
    expect(p(C.rampMonths / 2)).toBeCloseTo(0.4, 5);
    expect(p(C.rampMonths)).toBe(0.8);
    expect(p(C.rampMonths + C.plateauMonths)).toBe(0.8);
    expect(p(C.rampMonths + C.plateauMonths + C.fadeMonths / 2)).toBeLessThan(0.8);
    const end = p(C.rampMonths + C.plateauMonths + C.fadeMonths);
    expect(end).toBeCloseTo(0.8 * C.floor, 5);
    expect(p(1000)).toBeCloseTo(0.8 * C.floor, 5);
  });

  it("el reemplazo con causa apaga gradualmente; sin causa válida o antes del vacío no cuenta", () => {
    const rep = { at: at(12), cause: makeId("event", 9) };
    const half = calibratedMeaningPressure(vacuum, at(12 + C.reliefMonths / 2), YEAR, rep);
    const none = calibratedMeaningPressure(vacuum, at(12 + C.reliefMonths / 2), YEAR);
    expect(half.relief).toBeCloseTo(0.5, 5);
    expect(half.pressure).toBeCloseTo(none.pressure / 2, 5);
    expect(calibratedMeaningPressure(vacuum, at(12 + C.reliefMonths), YEAR, rep).pressure).toBe(0);
    const bad = { at: at(12), cause: "nope" as never };
    expect(calibratedMeaningPressure(vacuum, at(20), YEAR, bad).relief).toBe(0);
    const early = { at: -5 as Tick, cause: makeId("event", 9) };
    expect(calibratedMeaningPressure(vacuum, at(20), YEAR, early).relief).toBe(0);
  });

  it("sin vacío no hay presión y la calibración inválida se rechaza", () => {
    expect(calibratedMeaningPressure(undefined, at(5), YEAR)).toMatchObject({
      pressure: 0,
      relief: 0,
    });
    expect(() => habituation(5, { ...C, floor: 2 })).toThrow(RangeError);
  });
});
