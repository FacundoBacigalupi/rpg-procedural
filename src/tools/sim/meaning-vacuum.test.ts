import { describe, expect, it } from "vitest";
import { MEANING_CALIBRATION } from "../../sim/index.ts";
import { measureVacuum } from "./meaning-vacuum.ts";

const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

describe("tools.sim.meaning-vacuum", () => {
  it("es determinista y cada presión cita fuentes causales", () => {
    const a = measureVacuum(seeds);
    expect(measureVacuum(seeds).summary).toEqual(a.summary);
    expect(a.summary["causalSources"]?.min).toBeGreaterThanOrEqual(1);
  });

  it("la presión llega a un pico alto, se habitúa a un piso sin cero y el reemplazo la apaga", () => {
    const s = measureVacuum(seeds).summary;
    const m = (k: string) => s[`pressure.${k}`]?.mean ?? Number.NaN;
    expect(m("m1")).toBeLessThan(0.2);
    expect(m("m9")).toBeGreaterThan(0.6);
    expect(m("m9")).toBeLessThanOrEqual(1);
    expect(m("m96")).toBeLessThan(m("m18"));
    expect(m("m96")).toBeGreaterThan(MEANING_CALIBRATION.floor * 0.5 * 0.5);
    expect(s["afterReplacement"]?.max).toBe(0);
  });
});
