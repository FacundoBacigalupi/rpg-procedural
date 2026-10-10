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
import {
  ENTITY,
  type GoodDef,
  PARCEL,
  type Parcel,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import {
  COMMITMENTS,
  commitmentRows,
  LOANS,
  type LoanSeed,
  loansOf,
  loansProcess,
} from "./loans.ts";

const goods = [
  { id: "copper", name: "cobre", form: "coin" },
  { id: "grain", name: "grano", form: "good", priceCopperPerKg: 4, halfLifeDays: 400 },
] as unknown as GoodDef[];
const GRAIN = ledgerUnit("good:grain");
const H = (h: string) => holderAccount(h as unknown as HolderRef);

describe("life.loans", () => {
  const clock = EARTHLIKE_CLOCK;
  function setup() {
    const truth = new WorldTruth();
    const ledger = new Ledger({ externals: { seed: [GRAIN] } });
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
        { unit: GRAIN, from: externalAccount("seed"), to: H("poor"), amount: 1000 },
      ],
    });
    return { truth, ledger };
  }
  const seed: LoanSeed = {
    id: "s1",
    lender: "rich",
    borrower: "poor",
    good: "grain",
    principal: 20000,
    rate: 0.2,
    startDay: 1,
    termDays: 10,
    guarantors: [{ household: "rich", share: 0.5 }],
  };
  const make = (seeds: readonly LoanSeed[]) =>
    loansProcess({ clock, goods, seeds, placeOf: () => ({ kind: "cell" }) as never });
  let n = 0;
  const ctxOf = (truth: WorldTruth, ledger: Ledger, day: number) =>
    ({
      truth,
      ledger,
      now: day * clock.day,
      window: clock.day,
      newId: () => makeId("commitment", ++n),
    }) as unknown as ProcessContext;

  it("sin semillas no hace nada", () => {
    const { truth, ledger } = setup();
    expect(make([]).run(ctxOf(truth, ledger, 5))).toEqual({});
  });

  it("abre con evento, desembolsa por el ledger y conserva", () => {
    const { truth, ledger } = setup();
    const r = make([seed]).run(ctxOf(truth, ledger, 1));
    expect(r.events?.map((e) => e.kind)).toEqual(["credit.loaned"]);
    expect(r.events?.[0]?.causes.length).toBeGreaterThan(0);
    const before = ledger.total(GRAIN);
    for (const p of r.postings ?? [])
      ledger.post({ tick: clock.day, eventId: makeId("event", 2), transfers: p.transfers });
    expect(ledger.total(GRAIN)).toBe(before);
    expect(ledger.balance(H("poor"), GRAIN)).toBe(21000);
    for (const c of r.changes ?? []) {
      const ch = c as { table?: string; id?: string; value?: unknown };
      if (ch.table === LOANS.name) truth.set(LOANS, ch.id as never, ch.value as never);
    }
    expect(loansOf(truth, H("poor"))).toHaveLength(1);
    // Segunda corrida el mismo día: la semilla ya es préstamo y la cuota se paga.
    const again = make([seed]).run(ctxOf(truth, ledger, 2));
    expect(again.events?.map((e) => e.kind)).toEqual(["credit.paid"]);
  });

  it("la mora ejecuta la prenda: la tierra cambia de casa y nace law.default", () => {
    const { truth, ledger } = setup();
    const right = (holder: string) => ({
      holder,
      incidents: ["alienate"],
      tenure: "owned",
      basis: "custom",
      record: { kind: "custom", witnesses: [], event: makeId("event", 1) },
    });
    truth.set(
      PARCEL,
      "parcel:1" as never,
      {
        rights: [right("poor")],
        possession: "poor",
      } as unknown as Parcel,
    );
    const s: LoanSeed = {
      ...seed,
      guarantors: [],
      collateral: [{ ref: "parcel:1", believedValue: 100, trueValue: 100, heldBy: "poor" }],
    };
    const opened = make([s]).run(ctxOf(truth, ledger, 1));
    for (const p of opened.postings ?? [])
      ledger.post({ tick: clock.day, eventId: makeId("event", 2), transfers: p.transfers });
    for (const c of opened.changes ?? []) {
      const ch = c as { table?: string; id?: string; value?: unknown };
      if (ch.table === LOANS.name) truth.set(LOANS, ch.id as never, ch.value as never);
    }
    const r = make([s]).run(ctxOf(truth, ledger, 11));
    expect(r.events?.map((e) => e.kind)).toEqual(["credit.defaulted", "law.default"]);
    const ch = (r.changes ?? []).find((c) => (c as { table?: string }).table === PARCEL.name) as
      | { value: Parcel }
      | undefined;
    expect(ch?.value.rights[0]?.holder).toBe("rich");
    expect(ch?.value.possession).toBe("rich");
  });

  it("cada préstamo tiene su Commitment y el fiador que paga queda como acreedor", () => {
    const { truth, ledger } = setup();
    const kin = makeId("agent", 3);
    truth.set(ENTITY, kin, { id: kin, originEventId: makeId("event", 1), createdAt: 0 } as never);
    truth.set(PERSON, kin, { born: -30 * clock.year, household: "kin" } as never);
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [{ unit: GRAIN, from: externalAccount("seed"), to: H("kin"), amount: 50000 }],
    });
    const s: LoanSeed = { ...seed, guarantors: [{ household: "kin", share: 1 }] };
    const apply = (r: ReturnType<ReturnType<typeof make>["run"]>) => {
      for (const p of r.postings ?? [])
        ledger.post({ tick: clock.day, eventId: makeId("event", 2), transfers: p.transfers });
      for (const c of r.changes ?? []) {
        const ch = c as { table?: string; id?: string; value?: unknown };
        if (ch.table === LOANS.name) truth.set(LOANS, ch.id as never, ch.value as never);
        if (ch.table === COMMITMENTS.name)
          truth.set(COMMITMENTS, ch.id as never, ch.value as never);
      }
    };
    apply(make([s]).run(ctxOf(truth, ledger, 1)));
    const rows = commitmentRows(truth);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.commitment.kind).toBe("loan");
    expect(rows[0]?.commitment.enforcers.map((e) => e.kind)).toContain("guarantee");
    apply(make([s]).run(ctxOf(truth, ledger, 11)));
    const after = commitmentRows(truth);
    expect(after.map((r) => r.commitment.kind).sort()).toEqual(["loan", "subrogation"]);
    const sub = after.find((r) => r.commitment.kind === "subrogation")?.commitment;
    expect(sub?.parties[0]).toEqual({ ref: "kin", role: "creditor" });
    expect(sub?.parent).toBe(rows[0]?.id);
  });

  it("sin semillas no hay filas de Commitment", () => {
    const { truth, ledger } = setup();
    make([]).run(ctxOf(truth, ledger, 3));
    expect(commitmentRows(truth)).toHaveLength(0);
  });
});
