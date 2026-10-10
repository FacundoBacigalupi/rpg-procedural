import { describe, expect, it } from "vitest";
import type { PlaceRef } from "../../core/index.ts";
import {
  keepMold,
  MOLD_HINT_MOOD,
  moldHintMood,
  moldKey,
  moldPriceEdge,
  trustScale,
} from "./moldgossip.ts";

const market: PlaceRef = { kind: "settlement", settlement: "s1" } as unknown as PlaceRef;
const price = (amount: number) => ({ mold: "price", good: "rice", market, amount }) as const;
const heard = (amount: number, confidence: number) => ({
  rumor: price(amount),
  confidence,
  hops: 1,
  heardAt: 0,
  teller: null,
});

describe("chisme de moldes", () => {
  it("la confianza en quien cuenta escala lo que se cree, con piso y techo", () => {
    expect(trustScale(1)).toBe(1);
    expect(trustScale(0)).toBe(0.6);
    expect(trustScale(-1)).toBe(0.2);
    expect(trustScale(-5)).toBe(0.2);
  });

  it("la clave no depende del valor, solo de qué cosa es", () => {
    expect(moldKey(price(10))).toBe(moldKey(price(99)));
  });

  it("de una misma cosa se queda con la versión más creída", () => {
    const a = keepMold(undefined, heard(10, 0.8));
    const b = keepMold(a, heard(20, 0.4));
    expect(b.items).toHaveLength(1);
    expect(b.items[0]?.rumor).toEqual(price(10));
    const c = keepMold(b, heard(30, 0.9));
    expect(c.items[0]?.rumor).toEqual(price(30));
  });

  it("un atributo o�do tiene clave por persona y atributo, no por valor", () => {
    const a = { mold: "attr", about: "p1", attr: "alive", value: true } as const;
    const b = { ...a, value: false };
    expect(moldKey(a)).toBe(moldKey(b));
    const book = keepMold(undefined, { ...heard(1, 0.6), rumor: b });
    expect(book.items[0]?.rumor).toEqual(b);
  });
});

describe("la decisión lee lo que cree de oídas", () => {
  const cave = { kind: "place", place: "place:cave" } as unknown as PlaceRef;
  const where = (vague: boolean) =>
    ({ mold: "location", what: "herb", where: cave, vague }) as const;
  const book = (r: ReturnType<typeof where> | ReturnType<typeof price>, confidence: number) => ({
    items: [{ rumor: r, confidence, hops: 1, heardAt: 0, teller: null }],
    told: [],
  });
  const go = { id: "move:place:cave", verb: "move", target: "place:cave" };

  it("ir hacia donde cree que hay algo suma por utilidad; un lugar vago, la mitad", () => {
    expect(moldHintMood(go, book(where(false), 0.8))).toBeCloseTo(0.8 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(go, book(where(true), 0.8))).toBeCloseTo(0.4 * MOLD_HINT_MOOD, 6);
  });

  it("comerciar el bien con precio oído suma; otro destino o sin libro, nada", () => {
    const buy = { id: "trade:ana+rice", verb: "trade", target: "ana" };
    expect(moldHintMood(buy, book(price(10), 0.5))).toBeCloseTo(0.5 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(buy, book(price(10), 0.5), { goodName: () => "pan" })).toBe(0);
    expect(moldHintMood({ ...go, target: "place:mill" }, book(where(false), 1))).toBe(0);
    expect(moldHintMood(go, undefined)).toBe(0);
  });

  it("valora el precio oído contra el creído: barato o caro empuja, igual no", () => {
    expect(moldPriceEdge(5, 10)).toEqual({ side: "buy", edge: 0.5 });
    expect(moldPriceEdge(15, 10)).toEqual({ side: "sell", edge: 0.5 });
    expect(moldPriceEdge(10, 10).edge).toBe(0);
    expect(moldPriceEdge(10, undefined)).toEqual({ side: "none", edge: 1 });
    const buy = { id: "trade:ana+rice", verb: "trade", target: "ana" };
    const o = { believedPerKg: () => 10 };
    const at = { beliefs: undefined, day: 0 };
    expect(moldHintMood(buy, book(price(5), 1), o, at)).toBeCloseTo(0.5 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood(buy, book(price(10), 1), o, at)).toBe(0);
  });
});
