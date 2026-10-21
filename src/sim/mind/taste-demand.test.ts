import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { TASTE_DEMAND_SWING, tasteDemandFactor } from "./taste-demand.ts";
import type { Preference, TasteDef } from "./tastes.ts";

const origin = makeId("event", 1);
const def = (id: string, domain: string, demandGoods: string[]): TasteDef =>
  ({
    id,
    species: "human",
    domain,
    name: id,
    temperament: {},
    body: {},
    acquiredTaste: false,
    novelty: 0,
    social: false,
    common: 0,
    goods: [],
    demandGoods,
  }) as TasteDef;
const pref = (item: string, domain: string, valence: number, strength: number): Preference => ({
  item,
  domain,
  valence,
  strength,
  originEventIds: [origin],
  acquired: false,
});

const defs = [
  def("spicy", "food.flavor", ["chili", "spices"]),
  def("tea", "food.drink", ["tea"]),
  def("go", "pastime", ["tea"]),
];

describe("tasteDemandFactor", () => {
  it("sin gusto que toque el bien no mueve nada", () => {
    expect(tasteDemandFactor([], defs, "chili")).toBe(1);
    expect(tasteDemandFactor([pref("spicy", "food.flavor", 0.8, 0.8)], defs, "tea")).toBe(1);
  });

  it("lo que gusta sube la reserva y lo que da asco la baja, dentro del tope", () => {
    const up = tasteDemandFactor([pref("spicy", "food.flavor", 0.9, 0.9)], defs, "chili");
    const down = tasteDemandFactor([pref("spicy", "food.flavor", -0.9, 0.9)], defs, "chili");
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
    expect(up).toBeLessThanOrEqual(1 + TASTE_DEMAND_SWING);
    expect(down).toBeGreaterThanOrEqual(1 - TASTE_DEMAND_SWING);
  });

  it("los pasatiempos no mueven la compra de un bien", () => {
    expect(tasteDemandFactor([pref("go", "pastime", 1, 1)], defs, "tea")).toBe(1);
  });

  it("varios gustos sobre el mismo bien se promedian por fuerza, sin multiplicarse", () => {
    const both = tasteDemandFactor(
      [pref("tea", "food.drink", 1, 1), pref("spicy", "food.flavor", 1, 1)],
      [def("spicy", "food.flavor", ["tea"]), defs[1] as TasteDef],
      "tea",
    );
    expect(both).toBe(1 + TASTE_DEMAND_SWING);
    const mixed = tasteDemandFactor(
      [pref("spicy", "food.flavor", 1, 0.5), pref("tea", "food.drink", -1, 0.5)],
      [def("spicy", "food.flavor", ["tea"]), defs[1] as TasteDef],
      "tea",
    );
    expect(mixed).toBe(1);
  });
});
