import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, makeId } from "../../core/index.ts";
import { ENTITY, PERSON, PERSON_CULTURE, WorldTruth } from "../../sim/index.ts";
import { deriveUsury } from "./usuryderive.ts";

const a = makeId("agent", 1) as AgentId;
const b = makeId("agent", 2) as AgentId;
const ev = makeId("event", 1) as EventId;

function world(variantA: string, variantB: string) {
  const t = new WorldTruth();
  for (const [id, home, v] of [
    [a, "h1", variantA],
    [b, "h1", variantB],
  ] as const) {
    t.set(PERSON, id, { household: home } as never);
    t.set(ENTITY, id, {} as never);
    t.set(PERSON_CULTURE, id, {
      holdings: { "norms.interest": { variant: v, shown: v, strength: v === "ban" ? 0.9 : 0.4 } },
      identity: [],
      originEventId: ev,
    } as never);
  }
  return t;
}

describe("usura derivada del mundo", () => {
  const opts = deriveUsury({
    traitId: "norms.interest",
    prohibitedVariants: ["ban"],
    goodsHeld: (_t, home) => (home === "h1" ? 3 : 0),
    wagePerDay: 2,
  });

  it("prohíbe según el peso de lo que sostiene el hogar", () => {
    expect(opts.prohibits(world("ban", "free"), "h1")).toBe(true);
    expect(opts.prohibits(world("free", "free"), "h1")).toBe(false);
    expect(opts.prohibits(world("ban", "ban"), "h2")).toBe(false);
  });

  it("disfraces según lo que tiene a mano", () => {
    const av = opts.available;
    if (typeof av !== "function") throw new Error("debía ser función");
    const t = new WorldTruth();
    expect(av(t, "h1")).toEqual(["buyback", "inflated_price", "gift", "labor"]);
    expect(av(t, "h2")).toEqual(["labor"]);
  });
  it("sin contexto conserva la llamada legacy de dos argumentos", () => {
    let args = 0;
    const options = deriveUsury({
      traitId: "norms.interest",
      prohibitedVariants: [],
      goodsHeld(...input) {
        args = input.length;
        return 0;
      },
    });
    if (typeof options.available !== "function") throw new Error("sin callback");
    expect(options.available(new WorldTruth(), "h1")).toEqual([]);
    expect(args).toBe(2);
  });

  it("la tasación creída es determinista y acotada por el error", () => {
    const t = new WorldTruth();
    const bv = opts.suspicion?.believedValue;
    if (!bv) throw new Error("sin suspicion");
    expect(bv(t, a, 10)).toBe(bv(t, a, 10));
    expect(Math.abs(bv(t, b, 10) - 10)).toBeLessThanOrEqual(10 * 0.3 * 0.5 + 1e-9);
  });
});
