import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  type EventId,
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
import {
  createEntity,
  draftEvent,
  type ProcessContext,
  type ProcessDef,
  Scheduler,
  setComponent,
} from "./index.ts";

const clock = EARTHLIKE_CLOCK;
const bank = makeId("household", 1);
const actor = makeId("agent", 1);
const other = makeId("agent", 2);
const coin = ledgerUnit("coin");
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const alpha = table<{ amount: number; event?: EventId }>("test.alpha");
const beta = table<{ amount: number }>("test.beta");

function fixture(mode: "valid" | "debit" | "writes" | "window" | "outside" | "causal" = "valid") {
  const truth = new WorldTruth();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { seed: [coin] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: coin, from: externalAccount("seed"), to: holderAccount(bank), amount: 100 },
    ],
  });
  const make = (id: string, periodic: boolean): ProcessDef => ({
    id,
    system: "test",
    scope: periodic ? "world" : "agent",
    cadence: { local: periodic ? "day" : "onEvent" },
    representation: "individual",
    phase: "act",
    reads: periodic ? [alpha.name] : [],
    writes: [(periodic ? beta : alpha).name, ENTITY.name],
    serialDomain: "test.economy",
    serialGroup: () => "resources",
    run(ctx) {
      const amount =
        periodic && mode === "debit"
          ? 1000
          : Math.min(60, ctx.ledger?.balance(holderAccount(bank), coin) ?? 0);
      const child = ctx.newId("item");
      const tick = periodic
        ? ctx.now - (mode === "window" ? clock.day + 1 : clock.day / 2)
        : ctx.now;
      return {
        changes: [
          setComponent(periodic && mode === "writes" ? alpha : periodic ? beta : alpha, bank, {
            amount,
            ...(mode === "causal" && !periodic ? { event: draftEvent(0) } : {}),
          }),
          createEntity(child, draftEvent(0), ctx.now),
        ],
        events: [
          {
            kind: id,
            actors: [child],
            place,
            data: { draw: ctx.rng.float(), window: ctx.window, index: ctx.windowIndex },
            tick,
            emissions: {},
            causes:
              mode === "causal" && periodic
                ? [{ kind: "event", event: ctx.truth.get(alpha, bank)?.event as EventId }]
                : [{ kind: "seed" }],
          },
        ],
        postings: [
          {
            event: draftEvent(0),
            transfers: [
              {
                unit: coin,
                from: holderAccount(bank),
                to: holderAccount(periodic ? other : actor),
                amount,
              },
            ],
          },
        ],
        schedule: periodic
          ? []
          : [
              {
                at: ctx.now + clock.day,
                phase: "act",
                process: id,
                scope: actor,
                reason: { kind: "event", event: draftEvent(0) },
              },
            ],
      };
    },
  });
  const defs = [make("test.a.scheduled", false), make("test.z.periodic", true)];
  if (mode === "outside")
    defs.push({
      id: "test.m.outside",
      system: "test",
      scope: "world",
      cadence: { local: "day" },
      representation: "individual",
      phase: "act",
      reads: [],
      writes: [alpha.name],
      run: () => ({ changes: [setComponent(alpha, bank, { amount: 0 })] }),
    });
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    rng: Rng.root(7),
    clock,
    ids: new IdAllocator(),
    resolution: "local",
    processes: defs,
  });
  scheduler.schedule({
    at: clock.day,
    phase: "act",
    process: "test.a.scheduled",
    scope: actor,
    reason: { kind: "seed" },
  });
  return { truth, log, ledger, scheduler };
}

describe("dominio serial explícito entre procesos", () => {
  it("mezcla ventanas válidas conservando RNG, orígenes, writers propios y agendas", () => {
    const w = fixture();
    w.scheduler.advanceTo(clock.day);
    expect(w.truth.get(alpha, bank)?.amount).toBe(60);
    expect(w.truth.get(beta, bank)?.amount).toBe(40);
    expect(w.ledger.balance(holderAccount(actor), coin)).toBe(60);
    expect(w.ledger.balance(holderAccount(other), coin)).toBe(40);
    const events = w.log.all();
    expect(events.map((e) => e.tick)).toEqual([clock.day, clock.day / 2]);
    expect(events[0]?.data).toEqual({
      draw: Rng.root(7).fork("test", "test.a.scheduled", actor, "at", clock.day, 0).float(),
      window: 0,
      index: undefined,
    });
    expect(events[1]?.data).toEqual({
      draw: Rng.root(7).fork("test", "test.z.periodic", "world", 0).float(),
      window: clock.day,
      index: 0,
    });
    expect(w.truth.ids(ENTITY).map((id) => w.truth.get(ENTITY, id)?.originEventId)).toEqual(
      events.map((e) => e.id),
    );
    expect(w.scheduler.state().queue).toHaveLength(1);
    expect(w.ledger.audit()).toEqual([]);
  });
  it.each(["debit", "writes", "window"] as const)(
    "rechaza %s por el contrato original del miembro antes de efectos",
    (mode) => {
      const w = fixture(mode);
      expect(() => w.scheduler.advanceTo(clock.day)).toThrow();
      expect(w.truth.rows()).toEqual([]);
      expect(w.log.all()).toEqual([]);
      expect(w.ledger.balance(holderAccount(bank), coin)).toBe(100);
    },
  );
  it("un escritor fuera del dominio sigue siendo conflicto, no una reserva universal", () => {
    const w = fixture("outside");
    expect(() => w.scheduler.advanceTo(clock.day)).toThrow("sin declarar iniciativa");
    expect(w.truth.rows()).toEqual([]);
    expect(w.log.all()).toEqual([]);
    expect(w.ledger.balance(holderAccount(bank), coin)).toBe(100);
  });
  it("rechaza una causa de tick futuro entre ventanas antes de verdad, registro o ledger", () => {
    const w = fixture("causal");
    expect(() => w.scheduler.advanceTo(clock.day)).toThrow("posterior");
    expect(w.truth.rows()).toEqual([]);
    expect(w.log.all()).toEqual([]);
    expect(w.ledger.balance(holderAccount(bank), coin)).toBe(100);
    expect(w.ledger.balance(holderAccount(actor), coin)).toBe(0);
  });
  it("omitir dominio mantiene separados grupos del mismo proceso con ventanas distintas", () => {
    const truth = new WorldTruth();
    const log = new EventLog();
    const def: ProcessDef = {
      id: "test.windows",
      system: "test",
      scope: "agent",
      cadence: { local: "day" },
      representation: "individual",
      phase: "act",
      reads: [],
      writes: [alpha.name],
      serialGroup: () => "key",
      run(ctx: ProcessContext) {
        return {
          changes: [setComponent(alpha, ctx.scope as typeof actor, { amount: ctx.window })],
          events: [
            {
              kind: "test.window",
              tick: ctx.now - ctx.window / 2,
              actors: [ctx.scope as typeof actor],
              place,
              data: { window: ctx.window },
              emissions: {},
              causes: [{ kind: "seed" }],
            },
          ],
        };
      },
    };
    const scheduler = new Scheduler({
      truth,
      log,
      clock,
      rng: Rng.root(7),
      ids: new IdAllocator(),
      resolution: "local",
      processes: [def],
      scopes: () => [other],
    });
    scheduler.schedule({
      at: clock.day,
      phase: "act",
      process: def.id,
      scope: actor,
      reason: { kind: "seed" },
    });
    scheduler.advanceTo(clock.day);
    expect(log.all().map((e) => e.tick)).toEqual([clock.day, clock.day / 2]);
    expect(truth.get(alpha, actor)?.amount).toBe(0);
    expect(truth.get(alpha, other)?.amount).toBe(clock.day);
  });
});
