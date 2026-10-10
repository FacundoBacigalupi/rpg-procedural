import { describe, expect, it } from "vitest";
import { MOLD_HINT_MOOD, moldHintMood, tradeAbout } from "./moldgossip.ts";

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
