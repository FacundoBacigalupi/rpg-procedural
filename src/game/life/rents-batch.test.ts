import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK as clock,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  draftEvent,
  ENTITY,
  type GoodDef,
  goodUnit,
  PARCEL,
  type Parcel,
  PERSON,
  type ProcessDef,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";
import { RENTS, type RentSeed, rentsProcess } from "./rents.ts";

// perfil2-economic-rents: `life.rents` acepta `economicBatch` (opt-in). Sin él, el canon lee la
// fase original y puede cobrar un saldo que otro consumo del dominio ya gastó en el mismo paso.
const good = { id: "copper", name: "cobre", form: "coin" } as unknown as GoodDef;
const unit = goodUnit(good);
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const seedEv = makeId("event", 1);
const a1 = makeId("agent", 1),
  a2 = makeId("agent", 2),
  owner = makeId("household", 1),
  tenant = makeId("household", 2);
const rentSeed: RentSeed = {
  id: "r1",
  landlord: owner,
  tenant,
  parcel: "parcel:1",
  good: "copper",
  perDay: 3,
  startDay: 0,
  termDays: 5,
};

function world(coins: number) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { seed: [unit], used: [unit] } });
  log.append({
    id: seedEv,
    tick: 0,
    kind: "seed",
    actors: [],
    place,
    data: {},
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  for (const [agent, home] of [
    [a1, owner],
    [a2, tenant],
  ] as const) {
    for (const id of [agent, home])
      truth.set(ENTITY, id, { id, createdAt: 0, originEventId: seedEv });
    truth.set(PERSON, agent, { household: home, born: -30 * clock.year } as never);
  }
  truth.set(PARCEL, "parcel:1" as never, { rights: [], possession: owner } as unknown as Parcel);
  ledger.post({
    tick: 0,
    eventId: seedEv,
    transfers: [
      { unit, from: externalAccount("seed"), to: holderAccount(tenant as never), amount: coins },
    ],
  });
  return { truth, log, ledger };
}

/** Consumo del dominio económico que, desde el día 2, vacía la caja del arrendatario antes del canon. */
function drain(amount: number): ProcessDef {
  return {
    id: "life.a_drain",
    system: "life",
    scope: "world",
    cadence: { local: "day" },
    representation: "individual",
    phase: "act",
    reads: [],
    writes: [],
    serialDomain: ECONOMIC_SERIAL_DOMAIN,
    serialGroup: () => ECONOMIC_SERIAL_GROUP,
    run: (ctx) =>
      ctx.now < 2 * clock.day ||
      (ctx.ledger?.balance(holderAccount(tenant as never), unit) ?? 0) < amount
        ? {}
        : {
            events: [
              {
                kind: "test.consumed",
                actors: [a2],
                place,
                data: {},
                emissions: {},
                causes: [{ kind: "seed" }],
              },
            ],
            postings: [
              {
                event: draftEvent(0),
                transfers: [
                  {
                    unit,
                    from: holderAccount(tenant as never),
                    to: externalAccount("used"),
                    amount,
                  },
                ],
              },
            ],
          },
  };
}

function run(coins: number, batch: boolean, drainAmount: number) {
  const w = world(coins);
  const rents = rentsProcess({
    clock,
    goods: [good],
    seeds: [rentSeed],
    placeOf: () => place,
    ...(batch ? { economicBatch: true } : {}),
  });
  const scheduler = new Scheduler({
    truth: w.truth,
    log: w.log,
    ledger: w.ledger,
    rng: Rng.root(7),
    clock,
    ids: new IdAllocator({ event: 2, commitment: 1 }),
    resolution: "local",
    processes: [drain(drainAmount), rents],
    scopes: (kind) =>
      kind === "agent" ? [a1, a2] : kind === "household" ? [owner, tenant] : ["world"],
  });
  let error: Error | undefined;
  try {
    scheduler.advanceTo(2 * clock.day);
  } catch (e) {
    error = e as Error;
  }
  const bal = (h: string) => w.ledger.balance(holderAccount(h as never), unit);
  const row = w.truth.ids(RENTS).map((id) => w.truth.get(RENTS, id as never))[0];
  return { w, error, bal, row, kinds: w.log.all().map((e) => e.kind) };
}

describe("life.rents: opción económica", () => {
  it("omitir la opción deja el canon sin dominio; con ella comparte el de las acciones", () => {
    const make = (b: boolean) =>
      rentsProcess({
        clock,
        goods: [good],
        seeds: [rentSeed],
        placeOf: () => place,
        economicBatch: b,
      });
    expect(make(false).serialDomain).toBeUndefined();
    expect(make(false).serialGroup).toBeUndefined();
    expect(make(true).serialDomain).toBe(ECONOMIC_SERIAL_DOMAIN);
    expect(make(true).serialGroup).toBeDefined();
  });

  it("sin dominio: cobra un saldo que el consumo ya gastó y el asiento revienta", () => {
    const { error } = run(3, false, 3);
    expect(error?.message).toContain("no tiene");
  });

  it("con dominio y saldo insuficiente: ve la caja vacía, no paga y no rompe el ledger", () => {
    const { w, error, bal, row, kinds } = run(3, true, 3);
    expect(error).toBeUndefined();
    expect(kinds).not.toContain("property.rent_paid");
    expect(bal(tenant)).toBe(0);
    expect(bal(owner)).toBe(0);
    expect(row?.paid).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
  });

  it("con dominio y saldo suficiente: consumo y canon pagan los dos, conservando", () => {
    const { w, error, bal, row, kinds } = run(6, true, 3);
    expect(error).toBeUndefined();
    expect(kinds).toContain("property.rent_paid");
    expect(row?.paid).toBe(3);
    expect(bal(owner)).toBe(3);
    expect(bal(tenant)).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
  });

  it("determinismo: dos corridas iguales dejan el mismo registro", () => {
    const a = run(6, true, 3);
    const b = run(6, true, 3);
    expect(b.row).toEqual(a.row);
    expect(b.kinds).toEqual(a.kinds);
  });
});
