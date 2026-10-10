import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CellId, type PlaceRef, Sfc32 } from "../../core/index.ts";
import {
  distortMold,
  type LocationRumor,
  moldDistance,
  moldUsefulness,
  type PriceRumor,
  roundedAmount,
} from "./rumor-molds.ts";

const cell = (n: number): PlaceRef => ({ kind: "cell", cell: `cell:${n}` as CellId });
const price: PriceRumor = { mold: "price", good: "rice", market: cell(1), amount: 137 };
const loc: LocationRumor = { mold: "location", what: "herb", where: cell(1), vague: false };
const rng = (n: number) => new Sfc32(n, 3, 5, 7);
const calm = { memory: 1, drama: 0, hurry: 0, nearby: [cell(2), cell(3)] };
const wild = { memory: 0, drama: 1, hurry: 1, nearby: [cell(2), cell(3)] };

describe("rumor molds", () => {
  it("sin ruido no cambia nada", () => {
    expect(distortMold(price, calm, rng(1))).toEqual({ rumor: price, changes: [] });
    expect(distortMold(loc, calm, rng(1))).toEqual({ rumor: loc, changes: [] });
  });

  it("roundedAmount redondea a 2 cifras", () => {
    expect(roundedAmount(137)).toBe(140);
    expect(roundedAmount(4.4)).toBe(4);
    expect(roundedAmount(0.2)).toBe(1);
  });

  it("precio: con ruido se redondea y se infla; el lugar se corre solo a uno conocido", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (seed) => {
        const p = distortMold(price, wild, rng(seed)).rumor as PriceRumor;
        expect(p.amount).toBeGreaterThanOrEqual(1);
        const l = distortMold(loc, wild, rng(seed)).rumor as LocationRumor;
        expect([cell(1), cell(2), cell(3)]).toContainEqual(l.where);
      }),
    );
    const out = distortMold(price, wild, rng(3));
    expect(out.rumor).not.toEqual(price);
  });

  it("es determinista y la distancia mide la deformación", () => {
    expect(distortMold(loc, wild, rng(9))).toEqual(distortMold(loc, wild, rng(9)));
    expect(moldDistance(price, price)).toBe(0);
    expect(moldDistance(price, { ...price, amount: 274 })).toBe(1);
    expect(moldDistance(loc, { ...loc, vague: true })).toBeCloseTo(0.3);
    expect(moldDistance(loc, { ...loc, where: cell(2) })).toBeCloseTo(0.7);
  });

  it("un lugar vago sirve la mitad", () => {
    expect(moldUsefulness({ ...loc, vague: true }, 0.8)).toBe(0.4);
    expect(moldUsefulness(price, 0.8)).toBe(0.8);
  });

  it("un atributo se cuenta tal cual y su distancia es del valor", () => {
    const a = { mold: "attr", about: "p1", attr: "alive", value: true } as const;
    expect(distortMold(a, wild, rng(2))).toEqual({ rumor: a, changes: [] });
    expect(moldDistance(a, a)).toBe(0);
    expect(moldDistance(a, { ...a, value: false })).toBe(1);
    expect(moldDistance(a, { ...a, about: "p2" })).toBe(1);
  });
});

describe("rumor de oficio", () => {
  const trade = { mold: "attr", about: "household:h1", attr: "trade", value: "bake" } as const;
  it("con memoria plena se cuenta tal cual; sin memoria se confunde solo con un oficio que conoce", () => {
    expect(distortMold(trade, { ...calm, trades: ["weave"] }, rng(1)).rumor).toEqual(trade);
    let drifted = 0;
    for (let i = 0; i < 40; i++) {
      const out = distortMold(trade, { ...wild, trades: ["weave", "bake"] }, rng(i));
      expect(["bake", "weave"]).toContain(out.rumor.mold === "attr" ? out.rumor.value : "");
      if (out.changes.includes("drifted")) drifted++;
    }
    expect(drifted).toBeGreaterThan(0);
    expect(distortMold(trade, wild, rng(2)).rumor).toEqual(trade);
  });
});
