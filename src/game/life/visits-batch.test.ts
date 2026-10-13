import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
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
  DIVINER_ROLE,
  draftEvent,
  ENTITY,
  PERSON,
  type ProcessDef,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { visitsProcess } from "./divine.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";

const clock = EARTHLIKE_CLOCK;
const client = makeId("agent", 1);
const diviner = makeId("agent", 2);
const recipient = makeId("agent", 3);
const coin = ledgerUnit("coin:copper");
const place = { kind: "cell", cell: makeId("cell", 1) } as const;

function setup(seed: number, coins: number, batch: boolean, give = true, reverse = false) {
  const truth = new WorldTruth();
  const log = new EventLog();
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
  for (const id of [client, diviner, recipient]) {
    truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, id, { born: -40 * clock.year });
  }
  truth.setRaw(DIVINER_ROLE.name, diviner, { record: { hits: 1, misses: 0 } });
  const ledger = new Ledger({ externals: { seed: [coin] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: coin, from: externalAccount("seed"), to: holderAccount(client), amount: coins },
    ],
  });
  const visits = visitsProcess({
    economicBatch: batch,
    clock,
    methods: [],
    concerns: [],
    placeOf: () => place,
    player: recipient,
  });
  // A prior economic debit isolates the reservation seam; act's give leaf is tested separately.
  const debit: ProcessDef = {
    id: "life.fixture_give",
    system: "life",
    scope: "world",
    phase: "act",
    representation: "individual",
    cadence: { local: "day" },
    reads: [],
    writes: [],
    serialDomain: ECONOMIC_SERIAL_DOMAIN,
    serialGroup: () => ECONOMIC_SERIAL_GROUP,
    run(ctx) {
      if ((ctx.ledger?.balance(holderAccount(client), coin) ?? 0) < 1) return {};
      return {
        events: [
          {
            kind: "fixture.given",
            actors: [client, recipient],
            place,
            data: {},
            emissions: {},
            causes: [{ kind: "event", event: makeId("event", 1) }],
          },
        ],
        postings: [
          {
            event: draftEvent(0),
            transfers: [
              { unit: coin, from: holderAccount(client), to: holderAccount(recipient), amount: 1 },
            ],
          },
        ],
      };
    },
  };
  const processes = give ? [debit, visits] : [visits];
  const scheduler = new Scheduler({
    rng: Rng.root(seed),
    clock,
    truth,
    ledger,
    log,
    ids: new IdAllocator({ event: 2, agent: 4 }),
    resolution: "local",
    processes: reverse ? processes.toReversed() : processes,
  });
  return { truth, log, ledger, scheduler };
}

// Find a deterministic existing opportunity, without forcing the world's visit hazard.
function willingSeed(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const w = setup(seed, 1, false, false);
    w.scheduler.advanceTo(clock.day);
    if (w.log.all().some((e) => e.kind === "divination.consult")) return seed;
  }
  throw new Error("ninguna visita en los seeds de la regresión");
}

describe("reservas de consultas callejeras", () => {
  it("reproduce el débito tardío sin dominio y evita prometer el último cobre dos veces", () => {
    const seed = willingSeed();
    const old = setup(seed, 1, false);
    expect(() => old.scheduler.advanceTo(clock.day)).toThrow(
      "life.visits: asiento rechazado: agent:1 no tiene 1 de coin:copper (tiene 0; event:3)",
    );
    const fixed = setup(seed, 1, true);
    fixed.scheduler.advanceTo(clock.day);
    expect(fixed.log.all().map((e) => e.kind)).toEqual(["seed", "fixture.given"]);
    expect(fixed.ledger.balance(holderAccount(client), coin)).toBe(0);
    expect(fixed.ledger.balance(holderAccount(recipient), coin)).toBe(1);
    expect(fixed.ledger.balance(holderAccount(diviner), coin) ?? 0).toBe(0);
    expect(fixed.ledger.total(coin)).toBe(1);
  });

  it("con medios para ambos conserva pago y causa, sin depender del registro de procesos", () => {
    const seed = willingSeed();
    const snapshots = [false, true].map((reverse) => {
      const w = setup(seed, 2, true, true, reverse);
      w.scheduler.advanceTo(clock.day);
      const consult = w.log.all().find((e) => e.kind === "divination.consult");
      expect(consult?.data).toMatchObject({ paid: { unit: coin, amount: 1 } });
      expect(consult?.causes).toEqual([
        { kind: "state", entity: client, key: "divination.worry.money" },
      ]);
      expect(w.ledger.balance(holderAccount(client), coin)).toBe(0);
      expect(w.ledger.balance(holderAccount(diviner), coin)).toBe(1);
      expect(w.ledger.balance(holderAccount(recipient), coin)).toBe(1);
      expect(w.ledger.total(coin)).toBe(2);
      return { events: w.log.all(), accounts: w.ledger.holdings(holderAccount(client)) };
    });
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

  it("sin competencia mantiene resultados legacy y el descriptor opt-in", () => {
    const seed = willingSeed();
    const states = [false, true].map((batch) => {
      const w = setup(seed, 1, batch, false);
      w.scheduler.advanceTo(clock.day);
      return { events: w.log.all(), purse: w.ledger.holdings(holderAccount(client)) };
    });
    expect(states[0]).toEqual(states[1]);
    const def = visitsProcess({
      clock,
      methods: [],
      concerns: [],
      placeOf: () => place,
      player: recipient,
    });
    expect(def.serialDomain).toBeUndefined();
    expect(def.serialGroup).toBeUndefined();
  });
});
