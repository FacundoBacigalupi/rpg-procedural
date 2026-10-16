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
  CREDIT,
  draftEvent,
  ENTITY,
  goodUnit,
  LOCATION,
  PERSON,
  type ProcessDef,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";
import { lendProcess, repayDoseProcess } from "./lend.ts";
import { pawnDecideProcess } from "./pawndecide.ts";

// perfil2-economic-lend-pawn: `life.lend`, `life.repay_dose` y `life.pawn_decide` aceptan
// `economicBatch` (opt-in, mismo dominio que el fiado y las acciones). `world.ts` todavía no la
// cablea (perfil2-economic-lend-pawn-wire).
const good = { id: "poppy", name: "amapola", form: "good" } as never;
const unit = goodUnit(good);
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const loc = { hex: 3 } as never;
const seed = makeId("event", 1);
const a1 = makeId("agent", 1),
  a2 = makeId("agent", 2),
  h1 = makeId("household", 1),
  h2 = makeId("household", 2);

function world(stockAt: string, amount: number) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { seed: [unit], used: [unit] } });
  log.append({
    id: seed,
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
    [a1, h1],
    [a2, h2],
  ] as const) {
    for (const id of [agent, home])
      truth.set(ENTITY, id, { id, createdAt: 0, originEventId: seed });
    truth.set(PERSON, agent, { household: home, born: -30 * clock.year } as never);
    truth.set(LOCATION, agent, loc);
  }
  ledger.post({
    tick: 0,
    eventId: seed,
    transfers: [
      { unit, from: externalAccount("seed"), to: holderAccount(stockAt as never), amount },
    ],
  });
  return { truth, log, ledger };
}

/** Un consumo del dominio económico que vacía `from` en la primera hora, antes que el proceso probado. */
function drain(from: string, amount: number, cadence: "hour" | "day" = "hour"): ProcessDef {
  return {
    id: "life.a_drain",
    system: "life",
    scope: "world",
    cadence: { local: cadence },
    representation: "individual",
    phase: "act",
    reads: [],
    writes: [],
    serialDomain: ECONOMIC_SERIAL_DOMAIN,
    serialGroup: () => ECONOMIC_SERIAL_GROUP,
    run: (ctx) =>
      (ctx.ledger?.balance(holderAccount(from as never), unit) ?? 0) < amount
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
                  { unit, from: holderAccount(from as never), to: externalAccount("used"), amount },
                ],
              },
            ],
          },
  };
}

function run(w: ReturnType<typeof world>, processes: ProcessDef[]) {
  const scheduler = new Scheduler({
    truth: w.truth,
    log: w.log,
    ledger: w.ledger,
    rng: Rng.root(7),
    clock,
    ids: new IdAllocator({ event: 2, commitment: 1 }),
    resolution: "local",
    processes,
    scopes: (kind) => (kind === "agent" ? [a1, a2] : kind === "household" ? [h1, h2] : ["world"]),
  });
  try {
    scheduler.advanceTo(clock.day);
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

const kinds = (w: ReturnType<typeof world>) => w.log.all().map((e) => e.kind);

describe("lend / repay_dose / pawn_decide: opción económica", () => {
  it("omitir la opción deja los tres sin dominio; con ella comparten el de las acciones", () => {
    const placeOf = () => place;
    const l = { goods: [good], dims: [], bonds: [], day: clock.day, player: a2, placeOf };
    const r = { goods: [good], substances: ["poppy"], player: a2, placeOf };
    const p = { goods: [good], day: clock.day, player: a2, placeOf };
    for (const make of [
      (b: boolean) => lendProcess({ ...l, economicBatch: b }),
      (b: boolean) => repayDoseProcess({ ...r, economicBatch: b }),
      (b: boolean) => pawnDecideProcess({ ...p, economicBatch: b }),
    ]) {
      expect(make(false).serialDomain).toBeUndefined();
      expect(make(true).serialDomain).toBe(ECONOMIC_SERIAL_DOMAIN);
      expect(make(true).serialGroup).toBeDefined();
    }
  });
});

describe("doble débito con un scheduler real", () => {
  const bal = (w: ReturnType<typeof world>, who: string) =>
    w.ledger.balance(holderAccount(who as never), unit);

  function lend(batch: boolean) {
    const w = world(h2, 1);
    w.truth.set(NPC_DECISION, a1, {
      at: 0,
      id: `speak:${a2}+borrow:amapola`,
      verb: "speak",
      utility: 1,
      options: 1,
    } as never);
    const lender = lendProcess({
      goods: [good],
      dims: [
        { id: "trust", baseline: 1 },
        { id: "affection", baseline: 1 },
      ] as never,
      bonds: [],
      day: clock.day,
      player: makeId("agent", 999),
      placeOf: () => place,
      ...(batch ? { economicBatch: true } : {}),
    });
    return { w, error: run(w, [drain(h2, 1), lender]) };
  }
  it("lend sin dominio: ve la despensa que el consumo ya vació y el asiento revienta", () => {
    const { w, error } = lend(false);
    expect(error?.message).toContain("no tiene 1 de good:poppy");
    expect(kinds(w)).toContain("household.borrowed");
  });
  it("lend con dominio: ve la despensa vacía, no presta y corrige lo que creía", () => {
    const { w, error } = lend(true);
    expect(error).toBeUndefined();
    expect(kinds(w)).toContain("substance.borrow_missed");
    expect(kinds(w)).not.toContain("household.borrowed");
    expect(bal(w, h1)).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
  });

  function repay(batch: boolean) {
    const w = world(h1, 1);
    const credit = makeId("commitment", 1);
    w.truth.set(ENTITY, credit, { id: credit, createdAt: 0, originEventId: seed });
    w.truth.set(CREDIT, credit, {
      kind: "credit",
      creditor: a2,
      debtor: a1,
      unit,
      principal: 1,
      owed: 1,
      lent: 0,
      due: 30 * clock.day,
      status: "open",
      history: [seed],
    });
    const repayer = repayDoseProcess({
      goods: [good],
      substances: ["poppy"],
      player: makeId("agent", 999),
      placeOf: () => place,
      ...(batch ? { economicBatch: true } : {}),
    });
    return { w, error: run(w, [drain(h1, 1, "day"), repayer]) };
  }
  it("repay_dose sin dominio: devuelve una dosis que el hogar ya consumió", () => {
    const { w, error } = repay(false);
    expect(error?.message).toContain("no tiene 1 de good:poppy");
    expect(kinds(w)).toContain("household.repaid");
  });
  it("repay_dose con dominio: ve el hogar sin dosis y no devuelve", () => {
    const { w, error } = repay(true);
    expect(error).toBeUndefined();
    expect(kinds(w)).not.toContain("household.repaid");
    expect(bal(w, h2)).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
  });

  function pawn(batch: boolean) {
    const w = world(a1, 2);
    w.truth.set(NPC_DECISION, a1, {
      at: 0,
      id: `give:${a2}+pawn:amapola`,
      verb: "give",
      utility: 1,
      options: 1,
    } as never);
    const pawner = pawnDecideProcess({
      goods: [good],
      day: clock.day,
      player: makeId("agent", 999),
      placeOf: () => place,
      ...(batch ? { economicBatch: true } : {}),
    });
    return { w, error: run(w, [drain(a1, 2), pawner]) };
  }
  it("pawn_decide sin dominio: empeña un lote que el bolsillo ya gastó", () => {
    const { w, error } = pawn(false);
    expect(error?.message).toContain("no tiene");
    expect(kinds(w)).toContain("action.give");
  });
  it("pawn_decide con dominio: ve el bolsillo vacío y no empeña", () => {
    const { w, error } = pawn(true);
    expect(error).toBeUndefined();
    expect(kinds(w)).not.toContain("action.give");
    expect(bal(w, a2)).toBe(0);
    expect(w.ledger.audit()).toEqual([]);
  });
});
