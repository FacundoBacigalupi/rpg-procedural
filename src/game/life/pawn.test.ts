import { describe, expect, it } from "vitest";
import type { Tick } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import { openPawn, type ProcessContext } from "../../sim/index.ts";
import { COMMITMENTS } from "./loans.ts";
import { pawnOpenProcess, pawnProcess } from "./pawn.ts";

const DAY = 1;
function run(now: number, coin: number) {
  const c = openPawn({
    id: "commitment:1",
    pawner: "h:a",
    broker: "h:b",
    ref: "lot:1",
    unit: "coin",
    believedValue: 100,
    day: 0,
    originEventId: "e0",
  });
  if (!c) throw new Error("sin empeño");
  const truth = {
    ids: (t: { name: string }) => (t.name === COMMITMENTS.name ? ["commitment:1"] : []),
    get: (t: { name: string }) => (t.name === COMMITMENTS.name ? c.commitment : undefined),
  } as never;
  const ledger = {
    balance: (a: unknown, u: string) =>
      a === holderAccount("h:a" as never) && u === "coin"
        ? coin
        : a === holderAccount("h:b" as never) && u === "ring"
          ? 1
          : 0,
  };
  const ctx = { truth, ledger, now: now as Tick } as unknown as ProcessContext;
  return pawnProcess({
    unit: "coin",
    placeOf: () => "here" as never,
    day: DAY,
    lots: new Map([["lot:1", { unit: "ring", amount: 1 }]]),
    priceOf: (u) => (u === "ring" ? 100 : 1),
  }).run(ctx) as unknown as {
    events?: { kind: string; causes: unknown[] }[];
    postings?: { transfers: { amount: number; from: string; to: string }[] }[];
  };
}

describe("casa de empeño", () => {
  it("el dueño con saldo recupera el lote pagando lo debido", () => {
    const r = run(10, 80);
    expect(r.events?.[0]?.kind).toBe("credit.pawn_redeemed");
    expect(r.events?.[0]?.causes.length).toBeGreaterThan(0);
    expect(r.postings?.[0]?.transfers.map((t) => t.amount)).toEqual([50, 1]);
  });
  it("sin saldo no pasa nada dentro del plazo; vencido el lote es de la casa", () => {
    expect(run(10, 10).events).toBeUndefined();
    const r = run(40, 10);
    expect(r.events?.[0]?.kind).toBe("credit.pawn_forfeited");
    expect(r.postings).toEqual([]);
  });
});

describe("abrir el empeño desde el verbo give", () => {
  const ev = (manner: string[], grams = 1) =>
    ({
      id: "e1",
      kind: "action.give",
      actors: ["p:a", "p:b"],
      data: { manner, effect: { kind: "give", to: "p:b", good: "ring", grams } },
    }) as never;
  function open(manner: string[], cash: number) {
    const truth = {
      ids: () => [],
      get: (t: { name: string }, id: string) =>
        t.name === "person" || t.name.includes("person") ? { id } : undefined,
    } as never;
    const ledger = {
      balance: (a: unknown, u: string) =>
        a === holderAccount("p:b" as never) && u === "coin" ? cash : 0,
    };
    const ctx = {
      truth,
      ledger,
      now: 5 as Tick,
      recent: [ev(manner)],
      newId: () => "commitment:9",
    } as unknown as ProcessContext;
    return pawnOpenProcess({
      unit: "coin",
      placeOf: () => "here" as never,
      day: DAY,
      open: { prices: { ring: 100 }, rate: 0.1 },
    }).run(ctx) as unknown as {
      events?: { kind: string; causes: unknown[]; data: { advance?: number; owed?: number } }[];
      postings?: { transfers: { amount: number }[] }[];
      changes?: unknown[];
    };
  }
  it("tasa con lo creído, adelanta del bolsillo de la casa y abre el compromiso", () => {
    const r = open(["pawn"], 80);
    expect(r.events?.[0]?.kind).toBe("credit.pawn_opened");
    expect(r.events?.[0]?.data.advance).toBe(50);
    expect(r.events?.[0]?.data.owed).toBe(55);
    expect(r.postings?.[0]?.transfers[0]?.amount).toBe(50);
    expect(r.changes?.length).toBe(2);
  });
  it("sin efectivo la casa devuelve el lote; sin modo pawn no pasa nada", () => {
    const r = open(["pawn"], 10);
    expect(r.events?.[0]?.kind).toBe("credit.pawn_refused");
    expect(r.postings?.[0]?.transfers[0]?.amount).toBe(1);
    expect(open([], 80).events).toBeUndefined();
  });
});
