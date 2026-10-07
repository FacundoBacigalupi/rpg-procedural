import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  dayNumber,
  dayPhase,
  daysInYear,
  EARTHLIKE_CLOCK,
  firstDayOfYear,
  floorDiv,
  floorMod,
  formatTick,
  fromCalendar,
  lunation,
  moonPhase,
  type PlanetClock,
  planetClock,
  TIME_SCALES,
  toCalendar,
  windowDuration,
  windowIndex,
  windowStart,
  yearPhase,
} from "./index.ts";

const E = EARTHLIKE_CLOCK;
const DAY = 86_400;

// Relojes de planetas raros: días largos o cortos, años de pocos días, una o dos lunas.
const clock: fc.Arbitrary<PlanetClock> = fc
  .record({
    day: fc.integer({ min: 3_600, max: 400_000 }),
    daysPerYear: fc.double({ min: 1, max: 2_000, noNaN: true }),
    moons: fc.array(
      fc.record({
        synodicPeriod: fc.integer({ min: 1, max: 10_000_000 }),
        newMoonAt: fc.integer({ min: -1e9, max: 1e9 }),
      }),
      { maxLength: 2 },
    ),
  })
  .map(({ day, daysPerYear, moons }) =>
    planetClock({ day, year: Math.max(day, Math.round(day * daysPerYear)), moons }),
  );

// Ticks de hasta ±30 millones de años terrestres: holgado para la historia profunda.
const tick = fc.integer({ min: -1e15, max: 1e15 });

describe("división entera", () => {
  it("floorDiv y floorMod son exactas, también con negativos y cerca del límite", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 1, max: 1e12 }),
        (a, b) => {
          const q = floorDiv(a, b);
          const r = floorMod(a, b);
          expect(r >= 0 && r < b).toBe(true);
          expect(BigInt(q) * BigInt(b) + BigInt(r)).toBe(BigInt(a));
        },
      ),
      { numRuns: 5000 },
    );
    expect([floorDiv(-1, DAY), floorMod(-1, DAY)]).toEqual([-1, DAY - 1]);
    expect(floorDiv(Number.MAX_SAFE_INTEGER, 3)).toBe(3002399751580330);
  });
});

describe("calendario de la verdad", () => {
  it("ida y vuelta: fromCalendar(toCalendar(t)) = t", () => {
    fc.assert(
      fc.property(clock, tick, (c, t) => {
        const d = toCalendar(c, t);
        expect(d.dayOfYear >= 0 && d.dayOfYear < daysInYear(c, d.year)).toBe(true);
        expect(d.secondOfDay >= 0 && d.secondOfDay < c.day).toBe(true);
        expect(fromCalendar(c, d)).toBe(t);
        expect(firstDayOfYear(c, d.year) + d.dayOfYear).toBe(dayNumber(c, t));
      }),
      { numRuns: 3000 },
    );
  });

  it("los años tienen floor o ceil de los días por año, y sus días suman lo justo", () => {
    fc.assert(
      fc.property(clock, fc.integer({ min: -1e6, max: 1e6 }), fc.nat(500), (c, y0, span) => {
        let total = 0;
        for (let y = y0; y < y0 + span; y++) {
          const n = daysInYear(c, y);
          expect(n === Math.floor(c.year / c.day) || n === Math.ceil(c.year / c.day)).toBe(true);
          total += n;
        }
        expect(total).toBe(firstDayOfYear(c, y0 + span) - firstDayOfYear(c, y0));
        // El error acumulado contra el año exacto es menos de un día, sin importar cuántos años.
        expect(Math.abs(total * c.day - span * c.year)).toBeLessThan(c.day);
      }),
    );
  });

  it("en la Tierra de referencia hay 97 bisiestos cada 400 años, como en el gregoriano", () => {
    // 400 años trópicos son 146096,875 días; el gregoriano usa 146097.
    expect(firstDayOfYear(E, 400) - firstDayOfYear(E, 0)).toBe(146_097);
    const leap = [];
    for (let y = 0; y < 12; y++) if (daysInYear(E, y) === 366) leap.push(y);
    // El año 0 empieza en la medianoche del día 0, así que es el primero en llevarse el día extra.
    expect(leap).toEqual([0, 4, 8]);
  });

  it("los días empiezan a medianoche y el último segundo del año es del año", () => {
    const start1 = firstDayOfYear(E, 1) * DAY;
    expect(toCalendar(E, start1)).toEqual({ year: 1, dayOfYear: 0, secondOfDay: 0 });
    expect(toCalendar(E, start1 - 1)).toEqual({ year: 0, dayOfYear: 365, secondOfDay: DAY - 1 });
    expect(toCalendar(E, -1)).toEqual({ year: -1, dayOfYear: 364, secondOfDay: DAY - 1 });
  });

  it("valores dorados", () => {
    expect(formatTick(E, 0)).toBe("año 0, día 1, 00:00:00");
    expect(formatTick(E, 123_456_789)).toBe("año 3, día 333, 21:33:09");
    expect(formatTick(E, -1)).toBe("año -1, día 365, 23:59:59");
    expect(toCalendar(E, 10_000_000_000_000)).toEqual({
      year: 316_887,
      dayOfYear: 238,
      secondOfDay: 64_000,
    });
  });

  it("rechaza fechas y relojes inválidos", () => {
    expect(() => toCalendar(E, 1.5)).toThrow(RangeError);
    expect(() => toCalendar(E, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => fromCalendar(E, { year: 1, dayOfYear: 365, secondOfDay: 0 })).toThrow(RangeError);
    expect(() => fromCalendar(E, { year: 0, dayOfYear: 366, secondOfDay: 0 })).toThrow(RangeError);
    expect(() => fromCalendar(E, { year: 0, dayOfYear: 0, secondOfDay: DAY })).toThrow(RangeError);
    expect(() => planetClock({ day: 0, year: 10, moons: [] })).toThrow(RangeError);
    expect(() => planetClock({ day: 10, year: 5, moons: [] })).toThrow(RangeError);
    expect(() => planetClock({ day: 10, year: 50.5, moons: [] })).toThrow(RangeError);
    expect(() =>
      planetClock({ day: 10, year: 50, moons: [{ synodicPeriod: -1, newMoonAt: 0 }] }),
    ).toThrow(RangeError);
    expect(() => moonPhase(E, 1, 0)).toThrow(RangeError);
  });
});

describe("fases", () => {
  it("están en [0, 1) y repiten con su período", () => {
    fc.assert(
      fc.property(clock, tick, (c, t) => {
        for (const p of [yearPhase(c, t), dayPhase(c, t)]) expect(p >= 0 && p < 1).toBe(true);
        expect(yearPhase(c, t + c.year)).toBe(yearPhase(c, t));
        expect(dayPhase(c, t)).toBe(toCalendar(c, t).secondOfDay / c.day);
        c.moons.forEach((m, i) => {
          const p = moonPhase(c, i, t);
          expect(p >= 0 && p < 1).toBe(true);
          expect(moonPhase(c, i, t + m.synodicPeriod)).toBe(p);
          expect(lunation(c, i, t + m.synodicPeriod)).toBe(lunation(c, i, t) + 1);
        });
      }),
      { numRuns: 2000 },
    );
  });

  it("la luna de referencia: nueva en 0, llena a mitad del período", () => {
    const P = 2_551_443;
    expect(moonPhase(E, 0, 0)).toBe(0);
    expect(moonPhase(E, 0, (P - 1) / 2)).toBeCloseTo(0.5, 6);
    expect([lunation(E, 0, -1), lunation(E, 0, 0), lunation(E, 0, P)]).toEqual([-1, 0, 1]);
    expect(yearPhase(E, Math.floor(E.year / 4))).toBeCloseTo(0.25, 7);
  });
});

describe("ventanas por escala", () => {
  it("cada tick cae en exactamente una ventana, sin huecos ni solapes", () => {
    fc.assert(
      fc.property(clock, tick, fc.constantFrom(...TIME_SCALES), (c, t, scale) => {
        const k = windowIndex(c, scale, t);
        const start = windowStart(c, scale, k);
        const next = windowStart(c, scale, k + 1);
        expect(start <= t && t < next).toBe(true);
        expect(windowDuration(c, scale, k)).toBe(next - start);
        expect(windowIndex(c, scale, start)).toBe(k);
        expect(windowIndex(c, scale, next)).toBe(k + 1);
      }),
      { numRuns: 4000 },
    );
  });

  it("las estaciones son cuartos de la órbita que suman el año exacto", () => {
    fc.assert(
      fc.property(clock, fc.integer({ min: -1e6, max: 1e6 }), (c, y) => {
        const first = windowIndex(c, "season", y * c.year);
        expect(first).toBe(4 * y);
        let sum = 0;
        for (let k = first; k < first + 4; k++) {
          const d = windowDuration(c, "season", k);
          expect(d === Math.floor(c.year / 4) || d === Math.ceil(c.year / 4)).toBe(true);
          sum += d;
        }
        expect(sum).toBe(c.year);
      }),
    );
  });

  it("los días de ventana coinciden con los del calendario", () => {
    fc.assert(
      fc.property(clock, tick, (c, t) => {
        expect(windowIndex(c, "day", t)).toBe(dayNumber(c, t));
        expect(windowIndex(c, "year", t)).toBe(floorDiv(t, c.year));
      }),
    );
  });
});
