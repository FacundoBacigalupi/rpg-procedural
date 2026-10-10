import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { ENTITY, PERSON, RUMORS, WorldTruth } from "../../sim/index.ts";
import { debtorRepairProcess, repairDebtorRumors } from "./debtorrepair.ts";

const a = (n: number) => makeId("agent", n);
const stain = (kind: "default" | "fraud", by: number, confidence: number) => ({
  root: makeId("event", by * 10),
  content: { kind, by: a(by), victim: a(9), severity: 1 },
  at: 1,
  heardAt: 2,
  confidence,
  hops: 0,
  variant: `v${by}`,
  parent: null,
  teller: null,
  voices: 1,
});

describe("debtorrepair", () => {
  it("pura: rebaja solo los rumores del deudor y descarta los que quedan casi en cero", () => {
    const r = {
      items: [stain("default", 1, 0.8), stain("fraud", 2, 0.8), stain("fraud", 1, 0.08)],
      told: [],
    };
    const out = repairDebtorRumors(r as never, a(1), 0.5);
    expect(out?.items.map((h) => h.confidence)).toEqual([0.4, 0.8]);
    expect(repairDebtorRumors(r as never, a(3), 0.5)).toBe(r);
  });

  it("pago completo: el acreedor repara y el que no oyó no cambia; pago parcial no hace nada", () => {
    const truth = new WorldTruth();
    for (const n of [1, 2, 3]) {
      truth.set(ENTITY, a(n), {
        id: a(n),
        originEventId: makeId("event", 1),
        createdAt: 0,
      } as never);
      truth.set(PERSON, a(n), { household: `h${n}` } as never);
    }
    truth.set(RUMORS, a(2), { items: [stain("default", 1, 0.8)], told: [] } as never);
    truth.set(RUMORS, a(3), { items: [stain("default", 1, 0.8)], told: [] } as never);
    const paid = (status: string) =>
      ({
        id: makeId("event", 60),
        tick: 10,
        kind: "credit.paid",
        actors: [a(1), a(2)],
        data: { loan: "c1", status },
      }) as never;
    const ctx = (recent: unknown[]) =>
      ({ truth, now: 11, recent, rng: { fork: () => ({ chance: () => false }) } }) as never;
    const p = debtorRepairProcess({ placeOf: () => ({ kind: "cell" }) as never });
    expect(p.run(ctx([paid("active")]))).toEqual({});
    const r = p.run(ctx([paid("repaid")]));
    const ch = (r.changes ?? []) as unknown as {
      id: string;
      value: { items: { confidence: number }[] };
    }[];
    expect(ch).toHaveLength(1);
    expect(ch[0]?.id).toBe(a(2));
    expect(ch[0]?.value.items[0]?.confidence).toBeCloseTo(0.16, 6);
    expect(r.events?.[0]?.causes).toEqual([{ kind: "event", event: makeId("event", 60) }]);
  });
});
