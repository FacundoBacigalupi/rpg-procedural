import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng, type Seed, type Tick } from "../../core/index.ts";
import { RecipeDef } from "./recipe.ts";
import { type Hands, handsOf, qualityOf, runSession } from "./session.ts";

const flatbread = RecipeDef.parse({
  id: "flatbread",
  name: "pan plano",
  craft: "cooking",
  inputs: [{ good: "grain", grams: 400 }],
  output: { good: "flatbread", ratio: 1.3 },
  prepMinutes: 20,
  heat: { target: 220, minutes: 25, scorchAt: 280 },
});

const rng = (seed: number) => Rng.root(seed as Seed);
const at = 1000 as Tick;
const master: Hands = { control: 0.95, senses: 0.95, judgment: 0.95 };
const novice: Hands = { control: 0.15, senses: 0.15, judgment: 0.1 };

const run = (hands: Hands, seed: number) =>
  runSession({ recipe: flatbread, hands, rng: rng(seed), who: "agent:1", tick: at });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

describe("recetas", () => {
  it("rechaza una receta que quema antes del punto o repite insumos", () => {
    expect(() =>
      RecipeDef.parse({ ...flatbread, heat: { ...flatbread.heat, scorchAt: 200 } }),
    ).toThrow();
    expect(() =>
      RecipeDef.parse({ ...flatbread, inputs: [...flatbread.inputs, ...flatbread.inputs] }),
    ).toThrow();
  });
});

describe("sesión de oficio", () => {
  it("es determinista: misma mano, misma semilla y mismo tick dan lo mismo", () => {
    expect(run(novice, 7)).toEqual(run(novice, 7));
  });

  it("el maestro cocina mejor que el novato, de media", () => {
    const m = mean(seeds.map((s) => run(master, s).quality));
    const n = mean(seeds.map((s) => run(novice, s).quality));
    expect(m).toBeGreaterThan(n + 0.12);
  });

  it("el novato se pasa o se queda corto: el fracaso tiene forma", () => {
    const states = seeds.map((s) => run(novice, s).work);
    expect(states.some((w) => w.scorch > 0.2 || w.doneness > 1.2 || w.doneness < 0.8)).toBe(true);
  });

  it("el maestro juzga mejor su producto que el novato", () => {
    const err = (h: Hands) =>
      mean(
        seeds.map((s) => {
          const r = run(h, s);
          return Math.abs(r.perceivedQuality - r.quality);
        }),
      );
    expect(err(master)).toBeLessThan(err(novice));
  });

  it("lo quemado rinde menos", () => {
    expect(qualityOf({ temperature: 300, doneness: 1, scorch: 1 })).toBeLessThan(
      qualityOf({ temperature: 220, doneness: 1, scorch: 0 }),
    );
  });

  it("siempre termina, con tiempo, calidad y rinde acotados", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (control, senses, judgment, seed) => {
          const r = run({ control, senses, judgment }, seed);
          expect(r.quality).toBeGreaterThanOrEqual(0);
          expect(r.quality).toBeLessThanOrEqual(1);
          expect(r.perceivedQuality).toBeGreaterThanOrEqual(0);
          expect(r.perceivedQuality).toBeLessThanOrEqual(1);
          expect(r.yield).toBeGreaterThan(0);
          expect(r.yield).toBeLessThanOrEqual(flatbread.output.ratio);
          expect(r.seconds).toBeGreaterThan(flatbread.prepMinutes * 60);
          expect(Number.isFinite(r.seconds)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("handsOf sube con la habilidad y se queda en 0-1", () => {
    const low = handsOf(0, {});
    const high = handsOf(1, { control: 3, perception: 3, intellect: 3 });
    expect(high.control).toBeGreaterThan(low.control);
    expect(high.control).toBeLessThanOrEqual(1);
    expect(handsOf(0, { control: -9 }).control).toBeGreaterThanOrEqual(0);
  });
});
