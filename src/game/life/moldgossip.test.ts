import { describe, expect, it } from "vitest";
import type { PlaceRef } from "../../core/index.ts";
import { keepMold, moldKey } from "./moldgossip.ts";

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
