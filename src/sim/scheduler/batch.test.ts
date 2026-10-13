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
import { ENTITY, table, WorldTruth } from "../world/index.ts";
import { BatchLedger, batchEvents } from "./batch.ts";
import { createEntity, draftEvent, type ProcessDef, Scheduler, setComponent } from "./index.ts";

const clock = EARTHLIKE_CLOCK;
const bank = makeId("household", 1);
const agents = [makeId("agent", 1), makeId("agent", 2)] as const;
const unit = ledgerUnit("coin");
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const progress = table<{ value: number }>("test.progress");
const memory = table<{ events: readonly string[]; refs: Readonly<Record<string, string>> }>(
  "test.memory",
);

function world(stock: number, invalid = false) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { seed: [unit] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [{ unit, from: externalAccount("seed"), to: holderAccount(bank), amount: stock }],
  });
  const def: ProcessDef = {
    id: "test.serial",
    system: "test",
    scope: "agent",
    cadence: { local: "day" },
    representation: "individual",
    phase: "act",
    reads: [progress.name, memory.name],
    writes: [progress.name, memory.name, ENTITY.name],
    serialGroup: () => "bank",
    run(ctx) {
      const actor = ctx.scope as (typeof agents)[number];
      const available = ctx.ledger?.balance(holderAccount(bank), unit) ?? 0;
      const amount = invalid && actor === agents[1] ? 1000 : Math.min(50, available);
      const child = ctx.newId("item");
      return {
        changes: [
          createEntity(child, draftEvent(0), ctx.now),
          setComponent(progress, actor, { value: amount }),
          setComponent(memory, bank, {
            events: [...(ctx.truth.get(memory, bank)?.events ?? []), draftEvent(0)],
            refs: { ...(ctx.truth.get(memory, bank)?.refs ?? {}), [draftEvent(0)]: child },
          }),
        ],
        events: [
          {
            kind: amount > 0 ? "test.paid" : "test.failed",
            actors: [actor, child],
            place,
            emissions: {},
            causes: [{ kind: "seed" }],
            data: { amount },
          },
        ],
        postings:
          amount > 0
            ? [
                {
                  event: draftEvent(0),
                  transfers: [
                    { unit, from: holderAccount(bank), to: holderAccount(actor), amount },
                  ],
                },
              ]
            : [],
        schedule: [
          {
            at: ctx.now + clock.day,
            phase: "act",
            process: "test.serial",
            scope: actor,
            reason: { kind: "event", event: draftEvent(0) },
          },
        ],
      };
    },
  };
  const scheduler = new Scheduler({
    rng: Rng.root(7),
    clock,
    truth,
    log,
    ledger,
    ids: new IdAllocator(),
    resolution: "local",
    processes: [def],
    scopes: () => agents,
  });
  return { truth, log, ledger, scheduler };
}

describe("lote serial opt-in", () => {
  it("actualiza externos y rechaza overflow con los mismos checks del ledger real", () => {
    const ledger = new Ledger({ externals: { seed: [unit] } });
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [
        {
          unit,
          from: externalAccount("seed"),
          to: holderAccount(bank),
          amount: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    const batch = new BatchLedger(ledger);
    const transfer = {
      unit,
      from: externalAccount("seed"),
      to: holderAccount(agents[0]),
      amount: 1,
    };
    expect(() => batch.post([transfer])).toThrow("desborde");
    expect(batch.balance(externalAccount("seed"), unit)).toBe(-Number.MAX_SAFE_INTEGER);
    expect(ledger.balance(holderAccount(agents[0]), unit)).toBe(0);
    batch.post([{ unit, from: holderAccount(bank), to: externalAccount("seed"), amount: 10 }]);
    expect(batch.balance(externalAccount("seed"), unit)).toBe(-Number.MAX_SAFE_INTEGER + 10);
    expect(batch.holdings(externalAccount("seed"))).toEqual([
      { unit, amount: -Number.MAX_SAFE_INTEGER + 10 },
    ]);
  });
  it("remapea claves y valores del namespace privado de eventos", () => {
    const first = batchEvents({ refs: { "event:~0": "event:~0" } }, 2);
    expect(first).toEqual({ refs: { "event:batch:2": "event:batch:2" } });
    expect(batchEvents(first, 0, true)).toEqual({ refs: { "event:~2": "event:~2" } });
  });
  it("rechaza también overflow positivo de un sumidero externo", () => {
    const ledger = new Ledger({ externals: { seed: [unit], sink: [unit] } });
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [
        {
          unit,
          from: externalAccount("seed"),
          to: externalAccount("sink"),
          amount: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    const batch = new BatchLedger(ledger);
    expect(() =>
      batch.post([
        {
          unit,
          from: externalAccount("sink"),
          to: externalAccount("seed"),
          amount: Number.MAX_SAFE_INTEGER,
        },
      ]),
    ).not.toThrow();
    expect(batch.balance(externalAccount("sink"), unit)).toBe(0);
    expect(batch.total(unit)).toBe(0);
    const fresh = new BatchLedger(ledger);
    expect(() =>
      fresh.post([
        { unit, from: externalAccount("sink"), to: externalAccount("seed"), amount: 1 },
        { unit, from: externalAccount("seed"), to: externalAccount("sink"), amount: 2 },
      ]),
    ).toThrow("desborde");
  });
  it.each([100, 60])(
    "actualiza saldo antes del segundo actor con stock=%s y conserva todas agendas",
    (stock) => {
      const w = world(stock);
      w.scheduler.advanceTo(clock.day);
      expect(w.ledger.balance(holderAccount(agents[0]), unit)).toBe(50);
      expect(w.ledger.balance(holderAccount(agents[1]), unit)).toBe(stock - 50);
      expect(w.ledger.total(unit)).toBe(stock);
      expect(w.scheduler.state().queue).toHaveLength(2);
      const events = w.log.all();
      expect(events).toHaveLength(2);
      expect(w.truth.get(memory, bank)?.events).toEqual(events.map((e) => e.id));
      const children = w.truth.ids(ENTITY);
      expect(children).toHaveLength(2);
      expect(children.map((id) => w.truth.get(ENTITY, id)?.originEventId)).toEqual(
        events.map((e) => e.id),
      );
      expect(Object.keys(w.truth.get(memory, bank)?.refs ?? {})).toEqual(events.map((e) => e.id));
      expect(Object.values(w.truth.get(memory, bank)?.refs ?? {})).toEqual(children);
    },
  );
  it("sin stock para el segundo registra fallo y mantiene agenda", () => {
    const w = world(50);
    w.scheduler.advanceTo(clock.day);
    expect(w.log.all().map((e) => e.kind)).toEqual(["test.paid", "test.failed"]);
    expect(w.truth.get(progress, agents[1])?.value).toBe(0);
    expect(w.scheduler.state().queue).toHaveLength(2);
  });
  it("débito inválido rechaza el lote antes de mutar verdad, eventos o saldo", () => {
    const w = world(100, true);
    const before = w.truth.rows();
    expect(() => w.scheduler.advanceTo(clock.day)).toThrow();
    expect(w.truth.rows()).toEqual(before);
    expect(w.log.all()).toEqual([]);
    expect(w.ledger.balance(holderAccount(bank), unit)).toBe(100);
  });
  it("mismo seed y planes mantienen eventos, entidades y saldos", () => {
    const a = world(100);
    const b = world(100);
    a.scheduler.advanceTo(clock.day);
    b.scheduler.advanceTo(clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
  });
});
