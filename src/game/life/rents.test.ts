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
import { offenseOf } from "./deeds.ts";
import {
  matchRents,
  RENTS,
  type RentSeed,
  rentDuePerDay,
  rentsOf,
  rentsProcess,
  SHARES,
  sharecropHarvestProcess,
} from "./rents.ts";

const goods = [{ id: "copper", name: "cobre", form: "coin" }] as unknown as GoodDef[];
const COIN = ledgerUnit("coin:copper");
const H = (h: string) => holderAccount(h as unknown as HolderRef);

describe("life.rents", () => {
  const clock = EARTHLIKE_CLOCK;
  function setup(tenantCoins: number) {
    const truth = new WorldTruth();
    const ledger = new Ledger({ externals: { seed: [COIN, ledgerUnit("good:grain")] } });
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

  it("el mercado arma ofertas y buscadores desde el estado y abre el arriendo", () => {
    const { truth, ledger } = setup(100);
    truth.set(
      PARCEL,
      "parcel:1" as never,
      {
        landUse: "field",
        rights: [{ holder: "owner", incidents: ["alienate", "use"], tenure: "freehold" }],
        possession: "owner",
      } as unknown as Parcel,
    );
    const proc = rentsProcess({
      clock,
      goods,
      seeds: [],
      market: { everyDays: 5, good: "copper", askPerDay: 3, termDays: 10 },
      placeOf: () => ({ kind: "cell" }) as never,
    });
    expect(proc.run(ctxOf(truth, ledger, 3))).toEqual({});
    const r = proc.run(ctxOf(truth, ledger, 5));
    expect(r.events?.map((e) => e.kind)).toEqual(["property.leased"]);
    expect(r.events?.[0]?.data).toMatchObject({ parcel: "parcel:1", perDay: 3 });
  });

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

  it("mora sostenida: evento con causas, desalojo y fama vía deeds", () => {
    const { truth, ledger } = setup(1);
    const long: RentSeed = { ...seed, termDays: 50 };
    const proc = rentsProcess({
      clock,
      goods,
      seeds: [long],
      evictAfterDays: 2,
      placeOf: () => ({ kind: "cell" }) as never,
    });
    const kinds: string[] = [];
    let last: ReturnType<typeof proc.run> = {};
    for (const d of [1, 2, 3]) {
      last = proc.run(ctxOf(truth, ledger, d));
      for (const c of last.changes ?? []) {
        const ch = c as { table?: string; id?: string; value?: unknown };
        if (ch.table === RENTS.name) truth.set(RENTS, ch.id as never, ch.value as never);
      }
      kinds.push(...(last.events ?? []).map((e) => e.kind));
    }
    expect(kinds).toContain("property.rent_default");
    const ev = (last.events ?? []).find((e) => e.kind === "property.rent_default");
    expect(ev?.causes.length).toBe(2);
    const parcel = (last.changes ?? []).find(
      (c) => (c as { table?: string }).table === PARCEL.name,
    ) as { value: Parcel } | undefined;
    expect(parcel?.value.possession).toBe("owner");
    const [row] = [...truth.ids(RENTS)].map((id) => truth.get(RENTS, id));
    expect(row?.status).toBe("defaulted");
    expect(
      offenseOf({ kind: "property.rent_default", actors: ["agent:2", "agent:1"] } as never)?.kind,
    ).toBe("default");
  });

  it("aparcería: al cosechar el aparcero entrega la parte, con causas, y el resto es atraso", () => {
    const { truth, ledger } = setup(1);
    const GRAIN = ledgerUnit("good:grain");
    const grain = [{ id: "grain", name: "grano", form: "bulk" }] as unknown as GoodDef[];
    const crop: RentSeed = {
      ...seed,
      good: "grain",
      kind: "sharecrop",
      inputs: { seed: true, oxen: false, tools: false },
      termDays: 50,
    };
    const proc = rentsProcess({ clock, goods: grain, seeds: [crop], placeOf: () => ({}) as never });
    const r0 = proc.run(ctxOf(truth, ledger, 1));
    for (const c of r0.changes ?? []) {
      const ch = c as { table?: string; id?: string; value?: unknown };
      if (ch.table === RENTS.name) truth.set(RENTS, ch.id as never, ch.value as never);
    }
    const [row] = [...truth.ids(RENTS)].map((id) => truth.get(RENTS, id));
    expect(row?.share?.fraction).toBeCloseTo(0.35);
    expect(proc.run(ctxOf(truth, ledger, 2))).toEqual({});
    const harvest = (grams: number) =>
      ({
        id: makeId("event", 9),
        kind: "routine.harvested",
        actors: [makeId("agent", 2)],
        data: { good: row?.unit, grams },
      }) as never;
    const hp = sharecropHarvestProcess({ placeOf: () => ({}) as never });
    const give = (n: number) =>
      ledger.post({
        tick: 0,
        eventId: makeId("event", 2),
        transfers: [{ unit: GRAIN, from: externalAccount("seed"), to: H("tenant"), amount: n }],
      });
    // Con la despensa vacía todo es atraso; con 100 de grano entrega 35 de una cosecha de 100.
    const ctx = (recent: unknown[]) =>
      ({ ...ctxOf(truth, ledger, 3), recent }) as unknown as ProcessContext;
    const first = hp.run(ctx([harvest(100)]));
    expect(first.events?.[0]?.kind).toBe("property.rent_paid");
    const sh = (first.changes as unknown as { value: { arrears: number } }[])[0]?.value;
    expect(sh?.arrears).toBe(35);
    truth.set(SHARES, [...truth.ids(RENTS)][0] as never, sh as never);
    give(100);
    const total = ledger.total(GRAIN);
    const second = hp.run(ctx([harvest(100)]));
    for (const p of second.postings ?? [])
      ledger.post({ tick: 1, eventId: makeId("event", 3), transfers: p.transfers });
    expect(ledger.balance(H("owner"), GRAIN)).toBe(70);
    expect(ledger.total(GRAIN)).toBe(total);
    expect(second.events?.[0]?.causes.length).toBe(2);
  });

  it("aparcería: tras 3 cosechas seguidas con atraso hay mora, evento y desalojo", () => {
    const { truth, ledger } = setup(1);
    const grain = [{ id: "grain", name: "grano", form: "bulk" }] as unknown as GoodDef[];
    const crop: RentSeed = { ...seed, good: "grain", kind: "sharecrop", termDays: 50 };
    const proc = rentsProcess({ clock, goods: grain, seeds: [crop], placeOf: () => ({}) as never });
    const apply = (r: { readonly changes?: readonly unknown[] | undefined }) => {
      for (const c of r.changes ?? []) {
        const ch = c as { table?: string; id?: string; value?: unknown };
        if (ch.table === RENTS.name) truth.set(RENTS, ch.id as never, ch.value as never);
        if (ch.table === SHARES.name) truth.set(SHARES, ch.id as never, ch.value as never);
      }
    };
    apply(proc.run(ctxOf(truth, ledger, 1)));
    const id = [...truth.ids(RENTS)][0] as string;
    const unit = truth.get(RENTS, id as never)?.unit;
    const hp = sharecropHarvestProcess({ placeOf: () => ({}) as never });
    const harvest = {
      id: makeId("event", 9),
      kind: "routine.harvested",
      actors: [makeId("agent", 2)],
      data: { good: unit, grams: 100 },
    };
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = hp.run({
        ...ctxOf(truth, ledger, 3),
        recent: [harvest],
      } as unknown as ProcessContext);
      kinds.push(...(r.events ?? []).map((e) => e.kind));
      apply(r);
    }
    expect(kinds.filter((k) => k === "property.rent_default")).toHaveLength(1);
    apply(proc.run(ctxOf(truth, ledger, 4)));
    expect(truth.get(RENTS, id as never)?.status).toBe("defaulted");
  });
});

describe("matchRents", () => {
  it("empareja por fondos, un arriendo por hogar, sin autoarriendo", () => {
    const offers = [
      { landlord: "h1", parcel: "parcel:2", good: "copper", askPerDay: 3, termDays: 30 },
      { landlord: "h1", parcel: "parcel:1", good: "copper", askPerDay: 3, termDays: 30 },
    ];
    const seekers = [
      { tenant: "h1", maxPerDay: 9, funds: 999 },
      { tenant: "h2", maxPerDay: 3, funds: 50 },
      { tenant: "h3", maxPerDay: 2, funds: 500 },
      { tenant: "h4", maxPerDay: 5, funds: 30 },
    ];
    const seeds = matchRents(offers, seekers, 10);
    expect(seeds.map((s) => [s.parcel, s.tenant])).toEqual([
      ["parcel:1", "h2"],
      ["parcel:2", "h4"],
    ]);
    expect(matchRents(offers, seekers, 10)).toEqual(seeds);
  });

  it("regatea hasta el piso y el id lleva el día para repetir el par", () => {
    const offers = [
      {
        landlord: "h1",
        parcel: "parcel:1",
        good: "copper",
        askPerDay: 10,
        termDays: 30,
        floorPerDay: 7,
      },
    ];
    const a = matchRents(offers, [{ tenant: "h2", maxPerDay: 8, funds: 500 }], 10);
    expect(a[0]?.perDay).toBe(8);
    expect(matchRents(offers, [{ tenant: "h2", maxPerDay: 6, funds: 500 }], 10)).toEqual([]);
    const b = matchRents(offers, [{ tenant: "h2", maxPerDay: 20, funds: 500 }], 50);
    expect(b[0]?.perDay).toBe(10);
    expect(b[0]?.id).not.toBe(a[0]?.id);
  });
});
