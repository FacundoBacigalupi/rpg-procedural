import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import { type DebtBelief, observeCreditPayment, observeDebt } from "./debtknowledge.ts";

const debtor = "agent:1" as AgentId;
const creditor = "agent:2" as AgentId;
const origin = "event:1" as EventId;
const paid = "event:2" as EventId;
const belief: DebtBelief = {
  commitment: "commitment:1",
  kind: "credit",
  role: "debtor",
  other: creditor,
  debtorRef: debtor,
  creditorRef: creditor,
  unit: "grain",
  total: 100,
  remaining: 100,
  status: "active",
  originEventId: origin,
  learnedAt: 1000,
  confidence: 1,
  sources: [origin],
};

describe("invariantes del libro subjetivo", () => {
  it("un pago inválido no puede aumentar, saldar ni contaminar saldo o fuentes", () => {
    const book = { items: [belief] };
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const fulfilled of [false, true]) {
        expect(
          observeDebt(book, {
            kind: "paid",
            commitment: belief.commitment,
            amount,
            event: paid,
            at: 1200,
            fulfilled,
          }),
        ).toEqual(book);
      }
    }
    for (const remaining of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        observeDebt(book, {
          kind: "paid",
          commitment: belief.commitment,
          amount: 20,
          knownRemaining: remaining,
          event: paid,
          at: 1200,
          fulfilled: false,
        }),
      ).toEqual(book);
      expect(
        observeDebt(book, {
          kind: "resolved",
          commitment: belief.commitment,
          remaining,
          status: "defaulted",
          event: paid,
          at: 1200,
        }),
      ).toEqual(book);
    }
  });

  it("el nacimiento no acepta cantidad inválida ni deja una fuente huérfana en el libro", () => {
    for (const quantity of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const field of ["total", "remaining"] as const) {
        expect(
          observeDebt(undefined, { kind: "opened", belief: { ...belief, [field]: quantity } })
            .items,
        ).toEqual([]);
      }
    }
  });

  it("repagar conserva lo conocido, ignora otras roles y el replay no transfiere el pago a otra entrada", () => {
    const second = { ...belief, commitment: "commitment:2", openedAt: 2 };
    const third = {
      ...belief,
      commitment: "commitment:3",
      role: "creditor" as const,
      other: debtor,
    };
    const book = { items: [{ ...belief, openedAt: 1 }, second, third] };
    const next = observeCreditPayment(book, debtor, debtor, creditor, "grain", 150, paid, 1200);
    const mine = next.items.filter((b) => b.role === "debtor");
    expect(mine.reduce((n, b) => n + b.remaining, 0)).toBe(50);
    expect(next.items[2]).toEqual(third);
    expect(next.items.every((b) => b.remaining >= 0 && Number.isFinite(b.remaining))).toBe(true);
    expect(observeCreditPayment(next, debtor, debtor, creditor, "grain", 150, paid, 1200)).toEqual(
      next,
    );
    expect(book.items[0]?.remaining).toBe(100);
    expect(mine.every((b) => b.originEventId === origin)).toBe(true);
    expect(mine.every((b) => b.sources.filter((e) => e === paid).length === 1)).toBe(true);
  });
});
