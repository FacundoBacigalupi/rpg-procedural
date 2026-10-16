import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
} from "../../core/index.ts";
import { ENTITY, type GoodDef, PERSON, type ProcessContext, WorldTruth } from "../../sim/index.ts";
import { LOANS, type LoanRow, type LoanSeed, loansProcess } from "./loans.ts";

const goods = [
  { id: "grain", name: "grano", form: "good", priceCopperPerKg: 4, halfLifeDays: 400 },
  { id: "salt", name: "sal", form: "good", priceCopperPerKg: 8, halfLifeDays: 4000 },
] as unknown as GoodDef[];
const GRAIN = ledgerUnit("good:grain");
const SALT = ledgerUnit("good:salt");
const H = (h: string) => holderAccount(h as unknown as HolderRef);
const clock = EARTHLIKE_CLOCK;

function setup(poorSalt: number) {
  const truth = new WorldTruth();
  const ledger = new Ledger({ externals: { seed: [GRAIN, SALT] } });
  for (const [n, home] of [
    [1, "rich"],
    [2, "poor"],
  ] as const) {
    const id = makeId("agent", n);
    truth.set(ENTITY, id, { id, originEventId: makeId("event", 1), createdAt: 0 } as never);
    truth.set(PERSON, id, { born: -30 * clock.year, household: home } as never);
  }
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: GRAIN, from: externalAccount("seed"), to: H("rich"), amount: 100000 },
      { unit: GRAIN, from: externalAccount("seed"), to: H("poor"), amount: 5000 },
      { unit: SALT, from: externalAccount("seed"), to: H("poor"), amount: poorSalt },
    ],
  });
  return { truth, ledger };
}

const seed: LoanSeed = {
  id: "k1",
  lender: "rich",
  borrower: "poor",
  good: "grain",
  principal: 1000,
  rate: 0.2,
  startDay: 1,
  termDays: 4,
  inKind: { good: "salt", ratio: 0.5 },
};
let n = 0;
function run(seeds: readonly LoanSeed[], poorSalt: number, days: number) {
  n = 0;
  const { truth, ledger } = setup(poorSalt);
  const proc = loansProcess({
    clock,
    goods,
    seeds,
    placeOf: () => ({ kind: "cell" }) as never,
  });
  const kinds: string[] = [];
  const data: { inKind?: unknown; kindSeized?: number; kindLoss?: number }[] = [];
  const totals0 = [ledger.total(GRAIN), ledger.total(SALT)];
  for (let d = 1; d <= days; d++) {
    const r = proc.run({
      truth,
      ledger,
      now: d * clock.day,
      window: clock.day,
      newId: () => makeId("commitment", ++n),
    } as unknown as ProcessContext);
    for (const e of r.events ?? []) {
      kinds.push(e.kind);
      data.push(e.data as (typeof data)[number]);
    }
    for (const p of r.postings ?? [])
      ledger.post({
        tick: d * clock.day,
        eventId: makeId("event", 100 + d),
        transfers: p.transfers,
      });
    for (const c of r.changes ?? []) {
      const ch = c as { table?: string; id?: string; value?: unknown };
      if (ch.table === LOANS.name) truth.set(LOANS, ch.id as never, ch.value as never);
    }
  }
  const row = truth.get(LOANS, [...truth.ids(LOANS)][0] as never) as LoanRow | undefined;
  return { ledger, kinds, data, row, totals0 };
}

describe("life.loans interés en especie", () => {
  it("anota el interés en credit.loaned y paga principal en grano e interés en sal, conservando", () => {
    const r = run([seed], 500, 6);
    expect(r.data[0]?.inKind).toEqual({ unit: SALT, ratio: 0.5, interest: 100 });
    expect(r.row?.status).toBe("repaid");
    expect(r.row?.paid).toBe(1000);
    expect(r.row?.inKind?.paidKind).toBe(100);
    expect(r.ledger.balance(H("rich"), SALT)).toBe(100);
    expect(r.ledger.total(GRAIN)).toBe(r.totals0[0]);
    expect(r.ledger.total(SALT)).toBe(r.totals0[1]);
  });

  it("la mora ejecuta el interés en especie con lo que haya y anota la pérdida", () => {
    const r = run([seed], 30, 8);
    const d = r.data.find((_, i) => r.kinds[i] === "credit.defaulted");
    expect(
      (d?.kindSeized as number) +
        (d?.kindLoss as number) +
        (r.row?.inKind?.paidKind ?? 0) -
        (d?.kindSeized as number),
    ).toBe(100);
    expect(r.ledger.balance(H("rich"), SALT)).toBe(30);
    expect(d?.kindLoss).toBe(70);
    expect(r.ledger.balance(H("poor"), SALT)).toBeGreaterThanOrEqual(0);
    expect(r.row?.status).toBe("defaulted");
    expect(r.ledger.total(SALT)).toBe(r.totals0[1]);
  });

  it("sin inKind no cambia el evento ni la fila; determinista", () => {
    const { inKind: _i, ...plain } = seed;
    const a = run([plain], 500, 3);
    expect(JSON.stringify(a.data)).not.toContain("inKind");
    expect(JSON.stringify(a.row)).not.toContain("inKind");
    const b = run([seed], 500, 6);
    expect(JSON.stringify(run([seed], 500, 6))).toBe(JSON.stringify(b));
  });
});
