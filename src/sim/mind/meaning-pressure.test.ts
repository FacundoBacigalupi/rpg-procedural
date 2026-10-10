import { describe, expect, it } from "vitest";
import { makeId, type Tick } from "../../core/index.ts";
import type { GoalVacuum } from "./goal-vacuum.ts";
import { meaningPressureFromVacuum } from "./meaning-pressure.ts";

const source = (goalId: string, at: number, weight: number, event: number) => ({
  goalId,
  at: at as Tick,
  weight,
  origin: makeId("event", event),
  cause: makeId("event", event + 1),
});
const vacuum = (since: number, sources: GoalVacuum["sources"]): GoalVacuum => ({
  since: since as Tick,
  elapsed: 0 as Tick,
  sources,
});

describe("sim.mind.meaning-pressure", () => {
  it("devuelve presión cero sin vacío o antes de su inicio", () => {
    expect(meaningPressureFromVacuum(undefined, 900 as Tick, 1200, 6)).toEqual({
      pressure: 0,
      elapsedMonths: 0,
      sources: [],
    });
    expect(
      meaningPressureFromVacuum(vacuum(901, [source("core:x", 901, 1, 1)]), 900 as Tick, 1200, 6),
    ).toEqual({ pressure: 0, elapsedMonths: 0, sources: [] });
  });

  it("crece continuamente según meses del año planetario y satura la fuente más fuerte", () => {
    const done = vacuum(100, [source("core:x", 100, 0.8, 10)]);
    const half = meaningPressureFromVacuum(done, 400 as Tick, 1200, 6);
    expect(half.elapsedMonths).toBe(3);
    expect(half.pressure).toBe(0.4);
    expect(half.sources).toEqual(done.sources);

    const beforeBoundary = meaningPressureFromVacuum(done, 499 as Tick, 1200, 6);
    expect(beforeBoundary.elapsedMonths).toBe(3.99);
    expect(beforeBoundary.pressure).toBeCloseTo(0.532, 6);
    const full = meaningPressureFromVacuum(done, 700 as Tick, 1200, 6);
    expect(full.pressure).toBe(0.8);
    expect(full.elapsedMonths).toBe(6);
  });

  it("conserva fuentes canónicas sin sumar duplicados y no filtra evidencia futura", () => {
    const first = source("core:z", 100, 0.5, 20);
    const second = source("core:a", 100, 0.8, 30);
    const future = source("core:future", 901, 1, 40);
    const input = vacuum(100, [first, future, first, second]);
    const result = meaningPressureFromVacuum(input, 400 as Tick, 1200, 6);
    expect(result.pressure).toBe(0.4);
    expect(result.sources).toEqual([second, first]);
    expect(result).toEqual(
      meaningPressureFromVacuum(vacuum(100, [...input.sources].reverse()), 400 as Tick, 1200, 6),
    );
  });

  it("exige una duración positiva y un año entero positivo", () => {
    const done = vacuum(100, [source("core:x", 100, 0.8, 10)]);
    expect(() => meaningPressureFromVacuum(done, 400 as Tick, 0, 6)).toThrow(RangeError);
    expect(() => meaningPressureFromVacuum(done, 400 as Tick, 1200, 0)).toThrow(RangeError);
  });
});
