import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SOIL_FLOOR, SOIL_START, soilAfter } from "./soil.ts";

const FULL_DAY = 20 * 8 * 110;

describe("suelo", () => {
  it("con la cosecha plena de siempre se queda donde empezó", () => {
    expect(soilAfter(SOIL_START, FULL_DAY, FULL_DAY, 1)).toBeCloseTo(SOIL_START, 10);
    expect(soilAfter(SOIL_START, 100 * FULL_DAY, FULL_DAY, 100)).toBeCloseTo(SOIL_START, 10);
  });

  it("sin cosecha se recupera hacia 1 y sin pasarse", () => {
    let f = 0.5;
    for (let d = 0; d < 400; d++) f = soilAfter(f, 0, FULL_DAY, 1);
    expect(f).toBeGreaterThan(0.98);
    expect(f).toBeLessThanOrEqual(1);
  });

  it("exprimirlo lo baja, con piso", () => {
    let f = SOIL_START;
    for (let d = 0; d < 2000; d++) f = soilAfter(f, 4 * FULL_DAY, FULL_DAY, 1);
    expect(f).toBeLessThan(SOIL_START - 0.2);
    expect(f).toBeGreaterThanOrEqual(SOIL_FLOOR);
  });

  it("más cosecha nunca deja más fertilidad", () => {
    fc.assert(
      fc.property(
        fc.double({ min: SOIL_FLOOR, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true }),
        (f, a, b, days) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(soilAfter(f, hi * FULL_DAY * days, FULL_DAY, days)).toBeLessThanOrEqual(
            soilAfter(f, lo * FULL_DAY * days, FULL_DAY, days) + 1e-12,
          );
        },
      ),
    );
  });

  it("un tramo largo da lo mismo que sus días uno por uno", () => {
    let f = 0.8;
    for (let d = 0; d < 10; d++) f = soilAfter(f, FULL_DAY, FULL_DAY, 1);
    expect(soilAfter(0.8, 10 * FULL_DAY, FULL_DAY, 10)).toBeCloseTo(f, 9);
  });
});
