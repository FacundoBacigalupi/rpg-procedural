import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK as clock,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  draftEvent,
  ENTITY,
  type GoodDef,
  PARCEL,
  type Parcel,
  PERSON,
  type ProcessDef,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { RENTS, type RentSeed, rentsProcess, SHARES, sharecropHarvestProcess } from "./rents.ts";

// perfil2-rents-sharecrop-reads: la liquidación de aparcería corre en perceive, de a un proceso,
// después del commit de act. Con el scheduler real ve los saldos que act ya gastó en el mismo paso.
const grain = [{ id: "grain", name: "grano", form: "bulk" }] as unknown as GoodDef[];
const GRAIN = ledgerUnit("good:grain");
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const seedEv = makeId("event", 1);
const a1 = makeId("agent", 1);
const a2 = makeId("agent", 2);
const crop: RentSeed = {
  id: "r1",
  landlord: makeId("household", 1),
  tenant: makeId("household", 2),
  parcel: "parcel:1",
  good: "grain",
  perDay: 0,
  startDay: 0,
  termDays: 50,
  kind: "sharecrop",
};
const H = (h: string) => holderAccount(h as never);

/** Act del aparcero: cosecha 100 el día 2 y en el mismo paso gasta `spend` de su despensa. */
function farmer(spend: number): ProcessDef {
  return {
    id: "life.a_farmer",
    system: "life",
    scope: "world",
    cadence: { local: "day" },
    representation: "individual",
    phase: "act",
    reads: [],
    writes: [],
    run: (ctx) =>
      ctx.now < 2 * clock.day || ctx.now >= 3 * clock.day
        ? {}
        : {
            events: [
              {
                kind: "routine.harvested",
                actors: [a2],
                place,
                data: { good: GRAIN, grams: 100 },
                emissions: {},
                causes: [{ kind: "seed" }],
              },
            ],
            postings:
              spend <= 0
                ? []
                : [
                    {
                      event: draftEvent(0),
                      transfers: [
                        {
                          unit: GRAIN,
                          from: H(makeId("household", 2)),
                          to: externalAccount("used"),
                          amount: spend,
                        },
                      ],
                    },
                  ],
          },
  };
}

function run(spend: number) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { seed: [GRAIN], used: [GRAIN] } });
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
    [a1, makeId("household", 1)],
    [a2, makeId("household", 2)],
  ] as const) {
    truth.set(ENTITY, agent, { id: agent, createdAt: 0, originEventId: seedEv });
    truth.set(PERSON, agent, { household: home, born: -30 * clock.year } as never);
  }
  truth.set(PARCEL, "parcel:1" as never, { rights: [], possession: "owner" } as unknown as Parcel);
  ledger.post({
    tick: 0,
    eventId: seedEv,
    transfers: [
      { unit: GRAIN, from: externalAccount("seed"), to: H(makeId("household", 2)), amount: 60 },
    ],
  });
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    rng: Rng.root(7),
    clock,
    ids: new IdAllocator({ event: 2, commitment: 1 }),
    resolution: "local",
    processes: [
      farmer(spend),
      rentsProcess({ clock, goods: grain, seeds: [crop], placeOf: () => place }),
      sharecropHarvestProcess({ placeOf: () => place }),
    ],
    scopes: (kind) => (kind === "agent" ? [a1, a2] : ["world"]),
  });
  scheduler.advanceTo(4 * clock.day);
  const id = truth.ids(RENTS)[0] as string;
  return {
    share: truth.get(SHARES, id as never),
    due: Math.floor(100 * (truth.get(RENTS, id as never)?.share?.fraction ?? 0)),
    owner: ledger.balance(H(makeId("household", 1)), GRAIN) ?? 0,
    tenant: ledger.balance(H(makeId("household", 2)), GRAIN) ?? 0,
    audit: ledger.audit(),
    kinds: log.all().map((e) => e.kind),
  };
}

describe("life.rents.harvest: lecturas en el scheduler real", () => {
  it("declara ENTITY entre sus lecturas", () => {
    expect(sharecropHarvestProcess({ placeOf: () => place }).reads).toContain(ENTITY.name);
  });

  it("ve el saldo que act dejó en el mismo paso: paga lo que queda y el resto es atraso", () => {
    const r = run(50);
    expect(r.audit).toEqual([]);
    expect(r.kinds).toContain("property.rent_paid");
    expect(r.owner).toBeLessThanOrEqual(10);
    expect(r.owner + r.tenant).toBe(10);
    expect(r.share?.paid).toBe(r.owner);
    expect(r.share?.arrears).toBe(r.due - (r.share?.paid ?? 0));
  });

  it("con la despensa intacta paga la parte completa", () => {
    const r = run(0);
    expect(r.audit).toEqual([]);
    expect(r.owner).toBe(r.due);
    expect(r.share?.arrears).toBe(0);
  });

  it("determinismo: dos corridas iguales dejan lo mismo", () => {
    expect(run(50)).toEqual(run(50));
  });
});
