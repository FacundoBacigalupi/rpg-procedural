import { describe, expect, it } from "vitest";
import {
  MOLD_HINT_MOOD,
  moldCraftsmen,
  moldHintMood,
  tradeAbout,
  tradeWantFromNeeds,
} from "./moldgossip.ts";

const book = (value: string, confidence: number) => ({
  items: [
    {
      rumor: { mold: "attr", about: tradeAbout("h1"), attr: "trade", value } as const,
      confidence,
      hops: 1,
      heardAt: 0,
      teller: null,
    },
  ],
  told: [],
});
const hire = { id: "hire:household:h1", verb: "hire", target: tradeAbout("h1") };

describe("hogares creídos artesanos", () => {
  it("lista los que ejercen un oficio que necesita, sin repetir; apagado, nada", () => {
    const o = { tradeWant: (t: string) => (t === "forge" ? 0.5 : 0) };
    expect(moldCraftsmen(book("forge", 1), o)).toEqual([tradeAbout("h1")]);
    expect(moldCraftsmen(book("weave", 1), o)).toEqual([]);
    expect(moldCraftsmen(book("forge", 1), {})).toEqual([]);
    expect(moldCraftsmen(undefined, o)).toEqual([]);
  });
});

describe("tradeWant desde la necesidad del hogar", () => {
  it("cada oficio lee la necesidad que cubre, acotada; sin necesidad u oficio ajeno, 0", () => {
    const want = tradeWantFromNeeds({ tool: 0.7, roof: 3, clothing: Number.NaN });
    expect(want("forge")).toBe(0.7);
    expect(want("thatch")).toBe(1);
    expect(want("weave")).toBe(0);
    expect(want("farm")).toBe(0);
    expect(want("toString")).toBe(0);
    expect(tradeWantFromNeeds({ pantry: 0.4 }, { cook: "pantry" })("cook")).toBe(0.4);
  });

  it("alimenta moldCraftsmen y moldHintMood", () => {
    const o = { tradeWant: tradeWantFromNeeds({ tool: 0.5 }) };
    expect(moldCraftsmen(book("forge", 1), o)).toEqual([tradeAbout("h1")]);
    expect(moldCraftsmen(book("weave", 1), o)).toEqual([]);
  });
});

describe("decidir sobre el oficio oído", () => {
  const o = { tradeWant: (t: string) => (t === "forge" ? 0.5 : 0) };

  it("contratar o comprar al que se cree artesano empuja por necesidad y confianza", () => {
    expect(moldHintMood(hire, book("forge", 0.8), o)).toBeCloseTo(0.4 * MOLD_HINT_MOOD, 6);
    expect(moldHintMood({ ...hire, verb: "trade" }, book("forge", 1), o)).toBeCloseTo(
      0.5 * MOLD_HINT_MOOD,
      6,
    );
  });

  it("no empuja sin necesidad, con otro hogar, otro verbo o apagado", () => {
    expect(moldHintMood(hire, book("weave", 1), o)).toBe(0);
    expect(moldHintMood({ ...hire, target: tradeAbout("h2") }, book("forge", 1), o)).toBe(0);
    expect(moldHintMood({ ...hire, verb: "move" }, book("forge", 1), o)).toBe(0);
    expect(moldHintMood(hire, book("forge", 1))).toBe(0);
  });
});
