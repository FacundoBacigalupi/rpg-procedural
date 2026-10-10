import { describe, expect, it } from "vitest";
import type { AgentId, HolderRef } from "../../core/index.ts";
import type { GoodDef } from "../../sim/index.ts";
import { dealSwaps } from "./converse.ts";

const me = "agent:1" as AgentId;
const speaker = "agent:2" as AgentId;
const larder = "household:a" as unknown as HolderRef;
const goods = [
  { id: "pipeweed", form: "good" },
  { id: "copper", form: "coin" },
] as unknown as GoodDef[];
const byId = (id: string) => goods.find((g) => g.id === id);

describe("dealSwaps (entregar lo tratado)", () => {
  it("lo que el oyente recibe entra a su despensa, de donde lo toma consume", () => {
    const swaps = dealSwaps(
      { gets: { good: "pipeweed", grams: 3 }, gives: null },
      byId,
      larder,
      me,
      speaker,
    );
    expect(swaps).toEqual([{ unit: "good:pipeweed", from: speaker, to: larder, amount: 3 }]);
  });

  it("las monedas salen de la bolsa de quien trata, no de la despensa", () => {
    const swaps = dealSwaps(
      { gets: { good: "pipeweed", grams: 3 }, gives: { good: "copper", grams: 5 } },
      byId,
      larder,
      me,
      speaker,
    );
    expect(swaps).toEqual([
      { unit: "coin:copper", from: me, to: speaker, amount: 5 },
      { unit: "good:pipeweed", from: speaker, to: larder, amount: 3 },
    ]);
  });

  it("sin trato o con un bien desconocido no mueve nada", () => {
    expect(dealSwaps(undefined, byId, larder, me, speaker)).toEqual([]);
    expect(
      dealSwaps({ gets: { good: "nope", grams: 1 }, gives: null }, byId, larder, me, speaker),
    ).toEqual([]);
  });
});
