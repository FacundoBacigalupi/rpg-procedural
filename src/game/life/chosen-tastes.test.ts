import { describe, expect, it } from "vitest";
import { type EventId, makeId } from "../../core/index.ts";
import type { TasteDef } from "../../sim/index.ts";
import { chosenTastesOf } from "./create.ts";

const origin = makeId("event", 1) as EventId;
const defs = [
  { id: "bitter_tea", domain: "food" },
  { id: "grain", domain: "food" },
] as unknown as TasteDef[];

describe("los gustos pedidos del setup", () => {
  it("se resuelven contra el catálogo con el origen citado", () => {
    const got = chosenTastesOf(
      [{ domain: "food", item: "bitter_tea", valence: 0.8, strength: 0.7, because: "parent" }],
      defs,
      origin,
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ item: "bitter_tea", acquired: true, source: "chosen" });
    expect(got[0]?.originEventIds).toEqual([origin]);
  });

  it("lo que el mundo no conoce falla con la razón, no se ignora", () => {
    expect(() =>
      chosenTastesOf(
        [{ domain: "food", item: "caviar", valence: 1, strength: 0.5, because: "innate" }],
        defs,
        origin,
      ),
    ).toThrow(/caviar/);
    expect(chosenTastesOf([], defs, origin)).toEqual([]);
  });
});
