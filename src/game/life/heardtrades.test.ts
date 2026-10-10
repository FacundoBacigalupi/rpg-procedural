import { describe, expect, it } from "vitest";
import { heardTradesOf } from "./heardtrades.ts";
import { tradeAbout } from "./moldgossip.ts";

const item = (home: string, value: string, confidence = 1, heardAt = 0) => ({
  rumor: { mold: "attr", about: tradeAbout(home), attr: "trade", value } as const,
  confidence,
  hops: 1,
  heardAt,
  teller: null,
});
const names = new Map([["forge", "herrería"]]);

describe("oficio oído como creencia", () => {
  it("usa el nombre del oficio y de la casa por quien conoce; sin ids; salta la propia y las recetas ajenas", () => {
    const book = {
      items: [item("h1", "forge", 0.3), item("own", "forge"), item("h2", "unknown")],
      told: [],
    };
    const out = heardTradesOf(book, "own", names, (h) => (h === "h1" ? "Marta" : undefined));
    expect(out).toEqual([{ trade: "herrería", who: "Marta", sure: false }]);
    expect(JSON.stringify(out)).not.toMatch(/household|h1|forge/);
    expect(heardTradesOf(undefined, undefined, names, () => undefined)).toEqual([]);
  });
});
