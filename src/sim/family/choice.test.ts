import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadContent, makeId, Rng } from "../../core/index.ts";
import {
  around,
  CONDITION_TRIES,
  conditionTemperament,
  temperamentDistance,
  temperamentFit,
  validateTemperament,
} from "./choice.ts";
import { expressInnate, founderGenome, TRAITS } from "./genome.ts";

const content = loadContent(
  [TRAITS],
  [
    {
      kind: "traits",
      file: "t.json",
      data: JSON.parse(readFileSync("content/traits/human.json", "utf8")),
    },
  ],
);
const traits = content.all(TRAITS);
const origin = makeId("event", 1);

function baby(seed: number) {
  const genome = founderGenome(traits, Rng.root(seed).fork("genetics"), origin);
  const innate = expressInnate(traits, genome, "female", Rng.root(seed).fork("development"));
  return { genome, innate };
}

describe("temperamento elegido", () => {
  it("valida ejes inexistentes, ajenos al temperamento e imposibles", () => {
    expect(validateTemperament({ boldness: around(0.5, 0.2) }, traits)).toEqual([]);
    expect(validateTemperament({ nope: { min: 0, max: 1 } }, traits)).toHaveLength(1);
    expect(validateTemperament({ intellect: { min: 0, max: 1 } }, traits)[0]).toMatch(
      /no es un eje de temperamento/,
    );
    expect(validateTemperament({ boldness: { min: 2, max: 3 } }, traits)[0]).toMatch(/fuera de/);
  });

  it("lo que ya cumple es del mundo y no se toca", () => {
    const { genome, innate } = baby(7);
    const spec = { boldness: { min: -1, max: 1 } };
    const r = conditionTemperament(traits, genome, innate, "female", spec, Rng.root(1));
    expect(r.choices).toEqual([
      { trait: "boldness", how: "world", tries: 0, value: innate["boldness"] },
    ]);
    expect(r.innate).toEqual(innate);
    expect(r.genome).toEqual(genome);
  });

  it("condiciona el genoma y deja el resto de los ejes como estaban", () => {
    const { genome, innate } = baby(3);
    const spec = { boldness: { min: 0.7, max: 0.9 } };
    const r = conditionTemperament(traits, genome, innate, "female", spec, Rng.root(9));
    expect(temperamentDistance(r.innate, spec)).toBe(0);
    expect(r.choices[0]?.how).toMatch(/world|conditioned|fixed/);
    for (const t of traits) {
      if (t.id === "boldness") continue;
      expect(r.innate[t.id]).toBe(innate[t.id]);
      expect(r.genome.additive[t.id]).toBe(genome.additive[t.id]);
    }
  });

  it("un rango en el borde del eje se fija con novel_setup", () => {
    const { genome, innate } = baby(5);
    const spec = { boldness: { min: 1, max: 1 } };
    const r = conditionTemperament(traits, genome, innate, "female", spec, Rng.root(2));
    expect(r.innate["boldness"]).toBe(1);
    const c = r.choices[0];
    expect(c?.how).toBe("fixed");
    expect(c?.cause).toBe("novel_setup");
    expect(c?.tries).toBe(CONDITION_TRIES);
  });

  it("es determinista y cada eje tiene su stream", () => {
    const { genome, innate } = baby(11);
    const both = { boldness: { min: 0.6, max: 0.8 }, warmth: { min: -0.9, max: -0.6 } };
    const run = (spec: Record<string, { min: number; max: number }>) =>
      conditionTemperament(traits, genome, innate, "male", spec, Rng.root(4));
    expect(run(both)).toEqual(run(both));
    expect(run(both).innate["boldness"]).toBe(run({ boldness: both.boldness }).innate["boldness"]);
  });

  it("siempre cumple el pedido y el puntaje es 1 al cumplirlo (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.double({ min: -0.9, max: 0.9, noNaN: true }),
        (seed, center) => {
          const { genome, innate } = baby(seed);
          const spec = { curiosity: around(center, 0.1) };
          const r = conditionTemperament(traits, genome, innate, "female", spec, Rng.root(seed));
          expect(temperamentDistance(r.innate, spec)).toBe(0);
          expect(temperamentFit(r.innate, spec)).toBe(1);
          expect(temperamentFit(innate, spec)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 60 },
    );
  });
});
