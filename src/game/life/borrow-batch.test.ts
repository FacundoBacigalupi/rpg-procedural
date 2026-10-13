import { readFileSync } from "node:fs";
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
  CREDIT,
  draftEvent,
  ENTITY,
  type FoodDef,
  GIFT_GRAMS,
  HOUSEHOLD,
  PERSON,
  PRESSURE,
  type PressureCurve,
  type ProcessDef,
  RESERVE_GRAMS_PER_MEMBER,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { borrowProcess, repayProcess } from "./borrow.ts";
import { creditProcess } from "./credit.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";

const grain = ledgerUnit("good:grain");
const bank = makeId("household", 1);
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const foods = [{ id: "grain", name: "grano", kcalPerGram: 3.6, waterPerGram: 0 }] as FoodDef[];
const curves = JSON.parse(readFileSync("content/pressures/curves.json", "utf8")) as PressureCurve[];

function world() {
  const truth = new WorldTruth();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { seed: [grain], used: [grain] } });
  log.append({
    id: makeId("event", 1),
    tick: 0,
    kind: "seed",
    actors: [],
    place,
    data: {},
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  for (let n = 1; n <= 201; n++) {
    const agent = makeId("agent", n),
      home = makeId("household", n);
    for (const id of [agent, home])
      truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, agent, { household: home, born: -30 * clock.year });
    truth.setRaw(HOUSEHOLD.name, home, {});
  }
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        unit: grain,
        from: externalAccount("seed"),
        to: holderAccount(bank),
        amount: RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS,
      },
    ],
  });
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    rng: Rng.root(7),
    clock,
    ids: new IdAllocator({ event: 2, agent: 202, household: 202 }),
    resolution: "local",
    processes: [
      borrowProcess({
        economicBatch: true,
        foods,
        curves,
        player: makeId("agent", 999),
        placeOf: () => place,
      }),
      creditProcess({ day: clock.day, placeOf: () => place }),
    ],
    scopes: (kind) => (kind === "household" ? truth.ids(HOUSEHOLD) : ["world"]),
  });
  return { truth, log, ledger, scheduler };
}

describe("fiado en dominio económico opt-in", () => {
  it("muchos hogares hambrientos comparten reserva real del único donante", () => {
    const w = world();
    expect(() => w.scheduler.advanceTo(clock.day)).not.toThrow();
    const loans = w.log.all().filter((e) => e.kind === "household.borrowed");
    expect(loans).toHaveLength(1);
    expect(w.ledger.balance(holderAccount(bank), grain)).toBe(RESERVE_GRAMS_PER_MEMBER);
    expect(w.ledger.total(grain)).toBe(RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS);
    expect(w.truth.ids(CREDIT)).toHaveLength(1);
    const pressure = w.truth.ids(PRESSURE)[0];
    if (!pressure) throw new Error("sin presión causal");
    expect(w.truth.get(ENTITY, pressure)?.originEventId).toBe(loans[0]?.id);
    expect(loans[0]?.causes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "pressure", pressure })]),
    );
    expect(w.ledger.audit()).toEqual([]);
  });
  it("mismo seed mantiene préstamos, entidades y conservación", () => {
    const a = world(),
      b = world();
    a.scheduler.advanceTo(clock.day);
    b.scheduler.advanceTo(clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
  });
  it("la devolución reconsidera el hambre después de un consumo previo del dominio", () => {
    const { truth, log, ledger } = world();
    const debtor = makeId("agent", 2),
      home = makeId("household", 2),
      credit = makeId("commitment", 1);
    truth.set(ENTITY, credit, { id: credit, createdAt: 0, originEventId: makeId("event", 1) });
    truth.set(CREDIT, credit, {
      kind: "credit",
      creditor: makeId("agent", 1),
      debtor,
      unit: grain,
      principal: 1000,
      owed: 1000,
      lent: 0,
      due: 30 * clock.day,
      status: "open",
      history: [makeId("event", 1)],
    });
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [
        { unit: grain, from: externalAccount("seed"), to: holderAccount(home), amount: 40000 },
      ],
    });
    const consumer: ProcessDef = {
      id: "life.before_repay",
      system: "life",
      scope: "world",
      cadence: { local: "day" },
      representation: "individual",
      phase: "act",
      reads: [],
      writes: [],
      serialDomain: ECONOMIC_SERIAL_DOMAIN,
      serialGroup: () => ECONOMIC_SERIAL_GROUP,
      run: () => ({
        events: [
          {
            kind: "test.consumed",
            actors: [debtor],
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
                unit: grain,
                from: holderAccount(home),
                to: externalAccount("used"),
                amount: 39000,
              },
            ],
          },
        ],
      }),
    };
    const scheduler = new Scheduler({
      truth,
      log,
      ledger,
      rng: Rng.root(7),
      clock,
      ids: new IdAllocator({ event: 2 }),
      resolution: "local",
      processes: [
        consumer,
        repayProcess({
          economicBatch: true,
          foods,
          player: makeId("agent", 999),
          placeOf: () => place,
        }),
      ],
      scopes: () => truth.ids(HOUSEHOLD),
    });
    scheduler.advanceTo(clock.day);
    expect(log.all().some((event) => event.kind === "household.repaid")).toBe(false);
    expect(ledger.balance(holderAccount(home), grain)).toBe(1000);
    expect(truth.get(CREDIT, credit)?.owed).toBe(1000);
    expect(ledger.audit()).toEqual([]);
  });
  it("omitir la opción mantiene procesos sin dominio y la devolución usa el mismo grupo al elegirlo", () => {
    const base = { foods, player: makeId("agent", 999), placeOf: () => place };
    expect(borrowProcess({ ...base, curves }).serialDomain).toBeUndefined();
    expect(repayProcess(base).serialDomain).toBeUndefined();
    expect(repayProcess({ ...base, economicBatch: true }).serialDomain).toBe(
      borrowProcess({ ...base, curves, economicBatch: true }).serialDomain,
    );
  });
});
