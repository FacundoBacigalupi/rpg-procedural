import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EntityRef, Ledger, makeId } from "../../core/index.ts";
import { WorldTruth } from "../world/index.ts";
import { type PressureSource, readPressures, withHazards } from "./book.ts";
import { hazardOf, type PressureCurve } from "./curves.ts";

const curve: PressureCurve = {
  id: "hunger",
  name: "hambre",
  floor: 0.15,
  threshold: 0.6,
  steepness: 8,
  maxHazard: 0.05,
};

describe("hazardOf", () => {
  it("no hay descarga por debajo del piso", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.149, noNaN: true }), (v) => {
        expect(hazardOf(curve, v)).toBe(0);
      }),
    );
  });

  it("crece con la presión y nunca pasa el máximo", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          expect(hazardOf(curve, lo)).toBeLessThanOrEqual(hazardOf(curve, hi));
          expect(hazardOf(curve, hi)).toBeLessThanOrEqual(curve.maxHazard);
        },
      ),
    );
  });

  it("una chispa baja el umbral y la oportunidad lo escala", () => {
    expect(hazardOf(curve, 0.4, { spark: 0.2 })).toBeGreaterThan(hazardOf(curve, 0.4));
    expect(hazardOf(curve, 0.9, { opportunity: 0 })).toBe(0);
  });
});

describe("readPressures", () => {
  const hh = (n: number) => makeId("household", n) as unknown as EntityRef;
  const source = (values: Record<number, number>): PressureSource => ({
    kind: "hunger",
    read: () =>
      Object.entries(values).map(([n, value]) => ({
        kind: "hunger",
        scope: { kind: "household", ref: hh(Number(n)) },
        value,
        sources: [{ kind: "state", entity: hh(Number(n)), key: "larder" }],
        discharges: [{ process: "x.migrate", threshold: 0.6, hazard: 0, blockers: [] }],
        system: "economy",
      })),
  });
  const input = { truth: new WorldTruth(), ledger: new Ledger({ externals: {} }), now: 100 };

  it("recalcular da lo mismo y sale en orden canónico", () => {
    const a = readPressures([source({ 10: 0.2, 2: 0.9 })], input);
    const b = readPressures([source({ 2: 0.9, 10: 0.2 })], input);
    expect(a).toEqual(b);
    expect(a.map((p) => p.scope.ref)).toEqual([hh(2), hh(10)]);
  });

  it("la tendencia sale de la lectura anterior, por día", () => {
    const prev = new Map([[`hunger@${hh(2)}`, { value: 0.5, at: 0 }]]);
    const [p] = readPressures([source({ 2: 0.7 })], input, { previous: prev, day: 50 });
    expect(p?.trend).toBeCloseTo(0.1);
  });

  it("rechaza valores fuera de 0..1", () => {
    expect(() => readPressures([source({ 1: 1.5 })], input)).toThrow(RangeError);
  });

  it("withHazards pone el hazard de la curva del tipo en cada descarga", () => {
    const [p] = withHazards(readPressures([source({ 1: 0.9 })], input), [curve]);
    expect(p?.discharges[0]?.hazard).toBe(hazardOf(curve, 0.9));
  });
});
