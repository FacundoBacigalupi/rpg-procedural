import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadContent, Rng, type Seed } from "../../core/index.ts";
import { BIOMES, generatePlanet } from "../../worldgen/index.ts";
import { cellElements } from "./field.ts";
import { interact, sum, tension } from "./interact.ts";
import {
  ELEMENT_SYSTEMS,
  type ElementSystemDef,
  elementIndex,
  systemProblems,
  varySystem,
} from "./system.ts";

const base = loadContent(
  [ELEMENT_SYSTEMS],
  [
    {
      kind: "elements",
      file: "content/elements/five-phases.json",
      data: JSON.parse(readFileSync("content/elements/five-phases.json", "utf8")),
    },
  ],
).all(ELEMENT_SYSTEMS)[0] as ElementSystemDef;

const idx = (id: string) => elementIndex(base, id);
const vec = (o: Record<string, number>) => {
  const v = new Array<number>(base.elements.length).fill(0);
  for (const [id, x] of Object.entries(o)) v[idx(id)] = x;
  return v;
};
const rng = (seed: number) => Rng.root(seed as Seed);
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const amounts = fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), {
  minLength: 5,
  maxLength: 5,
});
const kinds = ["clash", "infusion", "mixing", "absorption", "field", "refining"] as const;
const contexts = fc.record({
  kind: fc.constantFrom(...kinds),
  coupling: fc.double({ min: 0, max: 1, noNaN: true }),
  duration: fc.double({ min: 0, max: 200, noNaN: true }),
});

describe("el sistema de cinco fases", () => {
  it("pasa el validador y se parece al ciclo clásico", () => {
    expect(systemProblems(base)).toEqual([]);
    const w = idx("water");
    const f = idx("fire");
    expect((base.K[w] as number[])[f]).toBeGreaterThan(0);
    expect((base.K[f] as number[])[w]).toBe(0);
    expect((base.G[idx("wood")] as number[])[f]).toBeGreaterThan(0);
  });

  it("el validador rechaza un elemento que vence a todos y uno que no nace de nada", () => {
    const n = base.elements.length;
    const K = base.K.map((row) => [...row]);
    for (let b = 1; b < n; b++) (K[0] as number[])[b] = 0.5;
    expect(systemProblems({ ...base, K }).some((p) => p.includes("vence a todos"))).toBe(true);
    const G = base.G.map((row) => [...row]);
    for (let a = 0; a < n; a++) (G[a] as number[])[0] = 0;
    expect(systemProblems({ ...base, G }).some((p) => p.includes("no nace"))).toBe(true);
  });

  it("varySystem cambia intensidades, no la forma, y siempre valida", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
        const v = varySystem(base, rng(seed));
        expect(systemProblems(v)).toEqual([]);
        for (const [a, row] of base.K.entries()) {
          for (const [b, x] of row.entries()) {
            expect(x > 0).toBe(((v.K[a] as number[])[b] as number) > 0);
          }
        }
        expect(varySystem(base, rng(seed))).toEqual(v);
      }),
      { numRuns: 200 },
    );
  });

  it("dar la vuelta entera al ciclo de generación pierde esencia (sin móvil perpetuo)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const law = varySystem(base, rng(seed));
      let v: readonly number[] = vec({ wood: 100 });
      for (let hop = 0; hop < 5; hop++) {
        const r = interact(v, vec({}), { kind: "infusion", coupling: 1, duration: 1 }, law);
        expect(sum(r.passiveAfter)).toBeLessThan(sum(v));
        v = r.passiveAfter;
      }
      expect(sum(v)).toBeLessThan(100);
    }
  });
});

describe("interact", () => {
  it("conserva la esencia en cualquier contacto", () => {
    fc.assert(
      fc.property(
        amounts,
        amounts,
        contexts,
        fc.integer({ min: 1, max: 9999 }),
        (a, b, ctx, seed) => {
          const law = varySystem(base, rng(seed));
          const r = interact(a, b, ctx, law);
          const after = sum(r.activeAfter) + sum(r.passiveAfter) + r.released;
          expect(close(sum(a) + sum(b), after)).toBe(true);
          for (const x of [...r.activeAfter, ...r.passiveAfter])
            expect(x).toBeGreaterThanOrEqual(0);
          expect(r.released).toBeGreaterThanOrEqual(-1e-9);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("conserva también con contenedor y control impreciso, y es determinista", () => {
    fc.assert(
      fc.property(
        amounts,
        amounts,
        contexts,
        fc.integer({ min: 1, max: 9999 }),
        (a, b, ctx, seed) => {
          const full = { ...ctx, container: { capacity: 50, vent: 3, volume: 3000 } };
          const run = () =>
            interact(
              a,
              b,
              { ...full, control: { precision: 0.3, rng: rng(seed).fork("control") } },
              base,
            );
          const r = run();
          const after = sum(r.activeAfter) + sum(r.passiveAfter) + r.released;
          expect(close(sum(a) + sum(b), after)).toBe(true);
          expect(run()).toEqual(r);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("la taza de agua no apaga el incendio, y el incendio arrasa una defensa chica", () => {
    const cup = interact(
      vec({ water: 5 }),
      vec({ fire: 500 }),
      { kind: "clash", coupling: 1, duration: 1 },
      base,
    );
    expect(cup.passiveAfter[idx("fire")] as number).toBeGreaterThan(450);
    expect(cup.activeAfter[idx("water")] as number).toBeLessThan(5);

    const shield = interact(
      vec({ fire: 40 }),
      vec({ water: 10 }),
      { kind: "clash", coupling: 1, duration: 4 },
      base,
    );
    expect(shield.passiveAfter[idx("water")] as number).toBeLessThan(1);
    expect(shield.activeAfter[idx("fire")] as number).toBeGreaterThan(30);
  });

  it("el agua vence al fuego de tamaño parecido y el choque libera esencia y calor", () => {
    const r = interact(
      vec({ water: 25 }),
      vec({ fire: 40 }),
      { kind: "clash", coupling: 0.9, duration: 1 },
      base,
    );
    expect(r.passiveAfter[idx("fire")] as number).toBeLessThan(40 - 10);
    expect(r.released).toBeGreaterThan(15);
    expect(r.physical.heat).not.toBe(0);
  });

  it("la ventaja crece con la proporción de manera monótona", () => {
    let last = -1;
    for (let water = 1; water <= 200; water += 3) {
      const r = interact(
        vec({ water }),
        vec({ fire: 100 }),
        { kind: "clash", coupling: 1, duration: 1 },
        base,
      );
      const left = 100 - (r.passiveAfter[idx("fire")] as number);
      expect(left).toBeGreaterThanOrEqual(last - 1e-9);
      last = left;
    }
  });

  it("generar convierte con pérdida y respeta el volumen del pasivo", () => {
    const r = interact(
      vec({ wood: 100 }),
      vec({}),
      { kind: "infusion", coupling: 1, duration: 1 },
      base,
    );
    expect(r.passiveAfter[idx("fire")] as number).toBeCloseTo(
      (100 - (r.activeAfter[idx("wood")] as number)) * (1 - base.generationLoss),
      9,
    );
    const small = interact(
      vec({ wood: 100 }),
      vec({}),
      { kind: "infusion", coupling: 1, duration: 1, container: { capacity: 99, volume: 10 } },
      base,
    );
    expect(sum(small.passiveAfter)).toBeLessThanOrEqual(10 + 1e-9);
  });

  it("dos fuegos no pelean: suman carga, no cantidad", () => {
    const r = interact(
      vec({ fire: 50 }),
      vec({ fire: 50 }),
      { kind: "clash", coupling: 1, duration: 1 },
      base,
    );
    expect(r.released).toBe(0);
    expect(r.physical.resonance).toBeGreaterThan(0);
  });

  it("un contenedor superado suelta lo que tenía, sin perder nada", () => {
    const hot = interact(
      vec({ water: 30 }),
      vec({ fire: 30 }),
      { kind: "mixing", coupling: 0.1, duration: 1, container: { capacity: 0.5 } },
      base,
    );
    expect(hot.ruptured).toBe(true);
    expect(sum(hot.passiveAfter)).toBe(0);
    expect(close(60, sum(hot.activeAfter) + hot.released)).toBe(true);
    const sturdy = interact(
      vec({ water: 30 }),
      vec({ fire: 30 }),
      { kind: "mixing", coupling: 0.1, duration: 1, container: { capacity: 10_000 } },
      base,
    );
    expect(sturdy.ruptured).toBe(false);
  });

  it("rechaza vectores y contextos inválidos", () => {
    const ctx = { kind: "clash", coupling: 1, duration: 1 } as const;
    expect(() => interact([1], vec({}), ctx, base)).toThrow(RangeError);
    expect(() => interact(vec({ fire: -1 }), vec({}), ctx, base)).toThrow(RangeError);
    expect(() => interact(vec({}), vec({}), { ...ctx, coupling: 2 }, base)).toThrow(RangeError);
  });
});

describe("tensión", () => {
  it("una mezcla en ciclo de generación tiene menos que una de pares que se vencen", () => {
    const chain = tension(vec({ wood: 50, fire: 50 }), base);
    const opposed = tension(vec({ water: 50, fire: 50 }), base);
    expect(chain).toBeLessThan(opposed);
    expect(chain).toBeLessThan(0);
    expect(tension(vec({}), base)).toBe(0);
  });
});

describe("el qi de las celdas", () => {
  it("el vector de cada celda suma exactamente su esencia", () => {
    const biomes = loadContent(
      [BIOMES],
      [
        {
          kind: "biomes",
          file: "content/biomes/whittaker.json",
          data: JSON.parse(readFileSync("content/biomes/whittaker.json", "utf8")),
        },
      ],
    ).all(BIOMES);
    const planet = generatePlanet({ seed: 7, biomes, frequency: 8 });
    const e = planet.essence;
    let total = 0;
    for (let c = 0; c < e.level.length; c++) {
      const v = cellElements(e, c, base);
      expect(sum(v)).toBe(e.level[c]);
      expect(cellElements(e, c, base)).toEqual(v);
      total += sum(v);
    }
    expect(total).toBe(e.budget);
  });
});
