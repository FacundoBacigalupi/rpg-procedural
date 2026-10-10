import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { ENTITY, PERSON, RUMORS, WorldTruth } from "../../sim/index.ts";
import { fraudCaution, usuryGossipProcess } from "./usurygossip.ts";

const a = (n: number) => makeId("agent", n);

function setup() {
  const truth = new WorldTruth();
  for (const n of [1, 2, 3, 4]) {
    truth.set(ENTITY, a(n), { id: a(n), originEventId: makeId("event", 1), createdAt: 0 } as never);
    truth.set(PERSON, a(n), { household: `h${n}` } as never);
  }
  return truth;
}
const ruled = (upheld: boolean) =>
  ({
    id: makeId("event", 50),
    tick: 10,
    kind: "credit.usury_ruled",
    actors: [a(1), a(2)],
    data: { upheld, evidence: [{ observer: a(3), impliedRate: 0.5 }] },
  }) as never;
const ctxOf = (truth: WorldTruth, recent: unknown[]) =>
  ({
    truth,
    now: 11,
    recent,
    rng: { fork: () => ({ chance: () => false }) },
  }) as never;

describe("usurygossip", () => {
  const p = usuryGossipProcess({ placeOf: () => ({ kind: "cell" }) as never });

  it("fallo que procede: deudor y testigo creen el fraude del prestamista", () => {
    const truth = setup();
    const r = p.run(ctxOf(truth, [ruled(true)]));
    for (const c of r.changes ?? []) {
      const ch = c as unknown as { id: string; value: never };
      truth.set(RUMORS, ch.id as never, ch.value);
    }
    expect(fraudCaution(truth, a(1), a(2))).toBeCloseTo(1 - 0.9 * 0.8, 6);
    expect(fraudCaution(truth, a(3), a(2))).toBeCloseTo(1 - 0.8 * 0.8, 6);
    expect(fraudCaution(truth, a(4), a(2))).toBe(1);
  });

  it("fallo que no procede: sin rumor ni cambios", () => {
    expect(p.run(ctxOf(setup(), [ruled(false)]))).toEqual({});
  });
});
