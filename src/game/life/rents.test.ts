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
  rentIncomePerDay,
  WorldTruth,
} from "../../sim/index.ts";
import { RENTS, type RentSeed, rentDuePerDay, rentsOf, rentsProcess } from "./rents.ts";

const goods = [{ id: "copper", name: "cobre", form: "coin" }] as unknown as GoodDef[];
const COIN = ledgerUnit("coin:copper");
const H = (h: string) => holderAccount(h as unknown as HolderRef);

describe("life.rents", () => {
  const clock = EARTHLIKE_CLOCK;
  function setup(tenantCoins: number) {
    const truth = new WorldTruth();
    const ledger = new Ledger({ externals: { seed: [COIN] } });
    for (const [n, home] of [
      [1, "owner"],
      [2, "tenant"],
    ] as const) {
      const id = makeId("agent", n);
      truth.set(ENTITY, id, { id, originEventId: makeId("event", 1), createdAt: 0 } as never);
      truth.set(PERSON, id, { born: -30 * clock.year, household: home } as never);
    }
    truth.set(
      PARCEL,
      "parcel:1" as never,
      { rights: [], possession: "owner" } as unknown as Parcel,
    );
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [
        { unit: COIN, from: externalAccount("seed"), to: H("tenant"), amount: tenantCoins },
      ],
    });
    return { truth, ledger };
  }
  const seed: RentSeed = {
    id: "r1",
    landlord: "owner",
    tenant: "tenant",
    parcel: "parcel:1",
    good: "copper",
    perDay: 3,
    startDay: 1,
    termDays: 3,
  };
  const make = (seeds: readonly RentSeed[]) =>
    rentsProcess({ clock, goods, seeds, placeOf: () => ({ kind: "cell" }) as never });
  let n = 0;
  const ctxOf = (truth: WorldTruth, ledger: Ledger, day: number) =>
    ({
      truth,
      ledger,
      now: day * clock.day,
      window: clock.day,
      newId: () => makeId("commitment", ++n),
    }) as unknown as ProcessContext;
  const run = (truth: WorldTruth, ledger: Ledger, day: number) => {
    const r = make([seed]).run(ctxOf(truth, ledger, day));
    for (const p of r.postings ?? [])
      ledger.post({
        tick: day * clock.day,
        eventId: makeId("event", 100 + day),
        transfers: p.transfers,
      });
    for (const c of r.changes ?? []) {
      const ch = c as { table?: string; id?: string; value?: unknown };
      if (ch.table === RENTS.name) truth.set(RENTS, ch.id as never, ch.value as never);
    }
    return r;
  };

  it("sin semillas no hace nada", () => {
    const { truth, ledger } = setup(100);
    expect(make([]).run(ctxOf(truth, ledger, 5))).toEqual({});
  });

  it("abre, cobra por ledger conservando y alimenta la renta del hogar", () => {
    const { truth, ledger } = setup(100);
    const total = ledger.total(COIN);
    expect(run(truth, ledger, 1).events?.map((e) => e.kind)).toEqual(["property.leased"]);
    expect(rentIncomePerDay(rentsOf(truth, "owner"), 2)).toBe(3);
    expect(run(truth, ledger, 2).events?.map((e) => e.kind)).toEqual(["property.rent_paid"]);
    expect(ledger.balance(H("owner"), COIN)).toBe(3);
    expect(ledger.total(COIN)).toBe(total);
    run(truth, ledger, 3);
    run(truth, ledger, 4);
    const [row] = [...truth.ids(RENTS)].map((id) => truth.get(RENTS, id));
    expect(row?.status).toBe("fulfilled");
    expect(row?.commitment.status).toBe("fulfilled");
    expect(rentsOf(truth, "owner")).toEqual([]);
  });

  it("el canon es gasto fijo del arrendatario y la parcela pasa a su uso", () => {
    const { truth, ledger } = setup(100);
    const r = run(truth, ledger, 1);
    const ch = (r.changes ?? []).find((c) => (c as { table?: string }).table === PARCEL.name) as
      | { value: Parcel }
      | undefined;
    expect(ch?.value.possession).toBe("tenant");
    expect(ch?.value.rights.at(-1)?.incidents).toEqual(["use", "fruits"]);
    expect(rentDuePerDay(truth, "tenant", 2)).toBe(3);
    expect(rentDuePerDay(truth, "tenant", 5)).toBe(0);
    expect(rentDuePerDay(truth, "owner", 2)).toBe(0);
  });

  it("sin fondos queda atraso y mora", () => {
    const { truth, ledger } = setup(4);
    for (const d of [1, 2, 3, 4]) run(truth, ledger, d);
    const [row] = [...truth.ids(RENTS)].map((id) => truth.get(RENTS, id));
    expect(row?.paid).toBe(4);
    expect(row?.arrears).toBe(5);
    expect(row?.status).toBe("defaulted");
  });
});
