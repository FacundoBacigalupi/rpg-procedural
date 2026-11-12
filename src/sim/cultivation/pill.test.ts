// La regla del canje de píldoras (novel2-pills-exchange): quién, qué, si queda y si alcanza.
import { describe, expect, it } from "vitest";
import { type PillDef, pillExchange } from "./pill.ts";

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
