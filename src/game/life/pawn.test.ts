import { describe, expect, it } from "vitest";
import type { Tick } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import { openPawn, type ProcessContext } from "../../sim/index.ts";
import { COMMITMENTS } from "./loans.ts";
import { pawnProcess } from "./pawn.ts";

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
