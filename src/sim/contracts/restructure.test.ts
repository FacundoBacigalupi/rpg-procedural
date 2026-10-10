import { describe, expect, it } from "vitest";
import { type Commitment, commitmentOwed } from "./commitment.ts";
import { restructure, seize } from "./restructure.ts";

const loan: Commitment = {
  id: "c1",
  kind: "loan",
  basis: "agreement",
  parties: [],
  obligations: [
    {
      id: "o1",
      debtor: "d",
      creditor: "a",
      duty: { kind: "deliver", unit: "silver", qty: 100 },
      dueDay: 10,
      state: "pending",
      performed: 20,
    },
  ],
  guarantees: [
    { kind: "collateral", ref: "field", held: "creditor" },
    { kind: "collateral", ref: "ox", held: "creditor" },
  ],
  enforcers: [],
  status: "defaulted",
  term: { startDay: 0, endDay: 10 },
  originEventId: "e0",
  history: [],
};

describe("reestructuración y ejecución de garantías", () => {
  it("reestructurar alarga plazo y perdona, dejando el viejo settled", () => {
    const r = restructure(loan, {
      day: 12,
      newId: "c2",
      extendDays: 30,
      forgive: 0.25,
      inReturn: "trabajo",
      originEventId: "e1",
    });
    if (!r) throw new Error("sin resultado");
    expect(r.old.status).toBe("settled");
    expect(r.next.parent).toBe("c1");
    expect(r.forgiven).toBeCloseTo(20);
    expect(r.next.obligations[0]?.dueDay).toBe(42);
    expect(commitmentOwed(r.next)).toBeCloseTo(60);
  });

  it("ejecutar toma solo hasta cubrir y conserva", () => {
    const out = seize(
      loan,
      new Map([
        ["field", 50],
        ["ox", 100],
      ]),
    );
    expect(out.taken).toBeCloseTo(80);
    expect(out.remaining).toBeCloseTo(0);
    expect(out.commitment.status).toBe("fulfilled");
    expect(out.lines[1]?.left).toBeCloseTo(70);
    expect(out.commitment.guarantees.map((g) => g.kind === "collateral" && g.ref)).toEqual(["ox"]);
  });

  it("si no alcanza queda el saldo", () => {
    const out = seize(loan, new Map([["field", 30]]));
    expect(out.remaining).toBeCloseTo(50);
    expect(out.commitment.status).toBe("defaulted");
  });
});
