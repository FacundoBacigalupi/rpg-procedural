// La regla del canje de píldoras (novel2-pills-exchange): quién, qué, si queda y si alcanza.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { PillDef, pillExchange, REFINE_ODDS, refineBatch, refineReleasedQi } from "./pill.ts";

const qi: PillDef = {
  id: "qi-gathering",
  good: "pill-qi-gathering",
  effect: "gather",
  qi: 20,
  purity: 0.7,
  points: 10,
};

describe("pillExchange", () => {
  it("da la píldora a quien es de la secta, tiene puntos y queda alguna", () => {
    expect(pillExchange(qi, true, 10, 1)).toEqual({ kind: "given", cost: 10 });
  });
  it("niega por orden: no ser de la secta, no haber tal píldora, no quedar, no alcanzar", () => {
    expect(pillExchange(qi, false, 99, 9)).toMatchObject({ refused: "not_member" });
    expect(pillExchange(undefined, true, 99, 9)).toMatchObject({ refused: "no_pill" });
    expect(pillExchange({ ...qi, points: undefined }, true, 99, 9)).toMatchObject({
      refused: "no_pill",
    });
    expect(pillExchange(qi, true, 99, 0)).toMatchObject({ refused: "no_stock" });
    expect(pillExchange(qi, true, 9, 9)).toMatchObject({ refused: "no_points" });
  });
});

describe("refineReleasedQi (novel2-alch-qi)", () => {
  const pill = (qi?: number): PillDef =>
    PillDef.parse({
      id: "p",
      good: "pill-p",
      effect: qi === undefined ? "break" : "gather",
      ...(qi === undefined ? { prep: 0.2 } : { qi }),
      purity: 0.7,
      recipe: { herb: "h", grams: 20 },
    });
  it("vuelve el qi de lo quemado y lo que la píldora no se lleva", () => {
    expect(refineReleasedQi(pill(20), { attempts: 5, made: 3, used: 100 }, 1)).toBe(40);
    expect(refineReleasedQi(pill(15), { attempts: 2, made: 2, used: 40 }, 1)).toBe(10);
  });
  it("las de romper no llevan qi: vuelve entero", () => {
    expect(refineReleasedQi(pill(), { attempts: 2, made: 2, used: 40 }, 2)).toBe(80);
  });
});

describe("refineBatch (novel2-alch-refine)", () => {
  const recipe = { ...qi, recipe: { herb: "spirit-grass", grams: 20 } };
  it("hace un intento por cada tanda de gramos y gasta los de todos", () => {
    const r = refineBatch(recipe, 105, 0.5, Rng.root(1).fork("refine"));
    expect(r.attempts).toBe(5);
    expect(r.used).toBe(100);
    expect(r.made).toBeGreaterThanOrEqual(0);
    expect(r.made).toBeLessThanOrEqual(5);
  });
  it("una mano mejor saca más píldoras de lo mismo", () => {
    const made = (hand: number) =>
      refineBatch(recipe, 20_000, hand, Rng.root(7).fork("refine")).made;
    expect(made(1)).toBeGreaterThan(made(0));
    expect(made(0) / 1000).toBeCloseTo(REFINE_ODDS[0], 1);
    expect(made(1) / 1000).toBeCloseTo(REFINE_ODDS[1], 1);
  });
  it("sin receta o sin gramos para un intento, nada", () => {
    expect(refineBatch(qi, 1000, 1, Rng.root(1).fork("refine"))).toEqual({
      attempts: 0,
      made: 0,
      used: 0,
    });
    expect(refineBatch(recipe, 19, 1, Rng.root(1).fork("refine"))).toEqual({
      attempts: 0,
      made: 0,
      used: 0,
    });
  });
  it("cada receta del contenido nombra una hierba que existe y no lleva más qi que sus hierbas", () => {
    const herbs = new Map(
      (
        JSON.parse(readFileSync("content/herbs/xianxia.json", "utf8")) as {
          id: string;
          qiPerGram: number;
        }[]
      ).map((h) => [h.id, h]),
    );
    const pills = JSON.parse(readFileSync("content/pills/xianxia.json", "utf8")) as PillDef[];
    for (const p of pills) {
      if (!p.recipe) continue;
      const herb = herbs.get(p.recipe.herb);
      expect(herb).toBeDefined();
      // novel2-alch-qi: el qi de la píldora sale de sus hierbas.
      expect(p.qi ?? 0).toBeLessThanOrEqual(p.recipe.grams * (herb?.qiPerGram ?? 0));
    }
    expect(pills.every((p) => PillDef.safeParse(p).success)).toBe(true);
  });
});
