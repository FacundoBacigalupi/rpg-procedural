import { describe, expect, it } from "vitest";
import type { Tick } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import { type Commitment, PERSON, type ProcessContext, RELATIONS } from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import { COMMITMENTS, CONTAGION_STATE } from "./loans.ts";
import { workoutProcess } from "./workout.ts";

const loan = (qty: number): Commitment =>
  ({
    id: "commitment:1",
    status: "active",
    obligations: [
      {
        id: "o1",
        debtor: "h:b",
        creditor: "h:a",
        duty: { kind: "deliver", unit: "coin", qty },
        performed: 0,
        state: "pending",
        dueDay: 5,
      },
    ],
    guarantees: [{ kind: "collateral", ref: "lot:1", held: "debtor" }],
    term: { startDay: 0, endDay: 5 },
    history: [],
  }) as unknown as Commitment;

function run(trust: number, grain: number, qty = 100) {
  const rows: Record<string, unknown> = { "commitment:1": loan(qty) };
  const people: Record<string, unknown> = {
    "agent:a": { household: "h:a" },
    "agent:b": { household: "h:b" },
  };
  const truth = {
    ids: (t: { name: string }) =>
      t.name === COMMITMENTS.name
        ? Object.keys(rows)
        : t.name === PERSON.name
          ? Object.keys(people)
          : [],
    get: (t: { name: string }, id: string) =>
      t.name === COMMITMENTS.name
        ? rows[id]
        : t.name === PERSON.name
          ? people[id]
          : t.name === CONTAGION_STATE.name
            ? { failed: id === "agent:b" }
            : t.name === RELATIONS.name
              ? { toward: { "agent:b": { dims: { trust } } } }
              : undefined,
  } as never;
  const ledger = {
    balance: (a: unknown, u: string) =>
      a === holderAccount("h:b" as never) && u === "coin" ? grain : 0,
  };
  const ctx = {
    truth,
    ledger,
    now: 10 as Tick,
    newId: () => "commitment:2",
  } as unknown as ProcessContext;
  return workoutProcess({
    unit: "coin",
    placeOf: () => "here" as never,
    day: 1,
    lots: new Map([["lot:1", { unit: "coin", amount: grain }]]),
  }).run(ctx) as unknown as {
    events: { kind: string; causes: unknown[] }[];
    postings?: { transfers: { amount: number; from: string; to: string }[] }[];
  };
}

describe("salida de la deuda del hogar caído", () => {
  it("ejecuta la garantía si la cubre: posting del deudor al acreedor", () => {
    const r = run(0.9, 150);
    expect(r.events[0]?.kind).toBe("credit.seized");
    expect(r.events[0]?.causes.length).toBeGreaterThan(0);
    expect(r.postings?.[0]?.transfers[0]?.amount).toBe(100);
  });
  it("renegocia si no la cubre y hay fama; ejecuta si la fama es mala", () => {
    expect(run(0.9, 40).events[0]?.kind).toBe("credit.restructured");
    const bad = run(0, 40);
    expect(bad.events[0]?.kind).toBe("credit.seized");
    expect(bad.postings?.[0]?.transfers[0]?.amount).toBe(40);
  });
  it("apagado por defecto", () => {
    expect(optInParts({})).toEqual({});
  });
});
