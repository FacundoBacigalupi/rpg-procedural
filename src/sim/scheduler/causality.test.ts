// Una aldea de juguete con nacimientos, regalos y muertes, corrida por el scheduler con ledger y
// registro de eventos: lo que se mide son las leyes de causality (sin huérfanos, conservación,
// ningún evento sin causa, determinismo), no la aldea.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type EntityRef,
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
  checkInvariants,
  ENTITY,
  type ReadonlyWorldTruth,
  table,
  WorldTruth,
} from "../world/index.ts";
import {
  createEntity,
  draftEvent,
  endEntity,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  Scheduler,
  SchedulerError,
  setComponent,
} from "./index.ts";

const DAY = EARTHLIKE_CLOCK.day;
const COIN = ledgerUnit("coin");
const MINT = externalAccount("mint");
const VILLAGE = makeId("settlement", 1);
const here = { kind: "settlement", settlement: VILLAGE } as const;
const HUT = table<{ owner: EntityRef }>("hut");

function living(truth: ReadonlyWorldTruth): AgentId[] {
  return truth
    .ids(ENTITY)
    .filter(
      (id): id is AgentId =>
        id.startsWith("agent:") && truth.get(ENTITY, id)?.endedAt === undefined,
    );
}

function def(
  id: string,
  run: (ctx: ProcessContext) => ProcessResult,
  over: Partial<ProcessDef>,
): ProcessDef {
  return {
    id,
    system: "demo",
    scope: "agent",
    cadence: { local: "day" },
    representation: "individual",
    phase: "physics",
    reads: ["entity"],
    writes: ["entity"],
    run,
    ...over,
  };
}

const birth = def(
  "demo.birth",
  (ctx) => {
    if (!ctx.rng.chance(0.6)) return {};
    const child = ctx.newId("agent");
    const born = draftEvent(0);
    return {
      events: [
        {
          kind: "birth",
          actors: [child],
          place: here,
          data: null,
          emissions: {},
          causes: [{ kind: "state", entity: VILLAGE, key: "population" }],
        },
      ],
      changes: [createEntity(child, born, ctx.now)],
      postings: [
        {
          event: born,
          transfers: [
            { unit: COIN, from: MINT, to: holderAccount(child), amount: ctx.rng.int(1, 20) },
          ],
        },
      ],
      schedule: [
        {
          at: ctx.now + ctx.rng.int(1, 3 * DAY),
          phase: "decide",
          process: "demo.greet",
          scope: child,
          reason: { kind: "event", event: born },
        },
      ],
    };
  },
  { scope: "world", phase: "act" },
);

/** Saluda a la aldea cuando le toca, si sigue viva: la causa es el nacimiento que lo agendó. */
const greet = def(
  "demo.greet",
  (ctx) => {
    const me = ctx.scope as AgentId;
    if (ctx.truth.get(ENTITY, me)?.endedAt !== undefined || !ctx.item) return {};
    return {
      events: [
        {
          kind: "greet",
          actors: [me],
          place: here,
          data: null,
          emissions: {},
          causes: [ctx.item.reason],
        },
      ],
    };
  },
  { cadence: { local: "onEvent" }, phase: "decide", writes: [] },
);

/** Regala parte de lo suyo a otro vivo. Solo gasta de su bolsa, así que nadie queda en negativo. */
const gift = def(
  "demo.gift",
  (ctx) => {
    const me = ctx.scope as AgentId;
    const others = living(ctx.truth).filter((a) => a !== me);
    const purse = ctx.ledger?.balance(holderAccount(me), COIN) ?? 0;
    if (others.length === 0 || purse === 0) return {};
    const to = others[ctx.rng.int(0, others.length - 1)] as AgentId;
    const amount = ctx.rng.int(1, purse);
    const gave = draftEvent(0);
    return {
      events: [
        {
          kind: "gift",
          actors: [me, to],
          place: here,
          data: { amount },
          emissions: {},
          causes: [{ kind: "state", entity: me, key: "purse" }],
        },
      ],
      postings: [
        {
          event: gave,
          transfers: [{ unit: COIN, from: holderAccount(me), to: holderAccount(to), amount }],
        },
      ],
    };
  },
  { writes: [] },
);

/** Muere a veces; lo que tenía vuelve a la casa de moneda. Sus chozas pasan a la aldea. */
const death = def(
  "demo.death",
  (ctx) => {
    const me = ctx.scope as AgentId;
    if (!ctx.rng.chance(0.15)) return {};
    const base = ctx.truth.get(ENTITY, me);
    if (!base) return {};
    const died = draftEvent(0);
    const purse = ctx.ledger?.balance(holderAccount(me), COIN) ?? 0;
    return {
      events: [
        {
          kind: "death",
          actors: [me],
          place: here,
          data: null,
          emissions: {},
          causes: [{ kind: "state", entity: me, key: "body" }],
        },
      ],
      changes: [endEntity(base, died, ctx.now)],
      postings:
        purse > 0
          ? [
              {
                event: died,
                transfers: [{ unit: COIN, from: holderAccount(me), to: MINT, amount: purse }],
              },
            ]
          : [],
    };
  },
  { phase: "settle" },
);

/** De vez en cuando alguien levanta una choza: entidad nueva con componente propio. */
const build = def(
  "demo.build",
  (ctx) => {
    if (!ctx.rng.chance(0.05)) return {};
    const hut = ctx.newId("building");
    const built = draftEvent(0);
    return {
      events: [
        {
          kind: "build",
          actors: [ctx.scope as AgentId],
          place: { kind: "building", building: hut },
          data: null,
          emissions: {},
          causes: [{ kind: "state", entity: ctx.scope as AgentId, key: "purse" }],
        },
      ],
      changes: [
        createEntity(hut, built, ctx.now),
        setComponent(HUT, hut, { owner: ctx.scope as AgentId }),
      ],
    };
  },
  { phase: "act", writes: ["entity", "hut"] },
);

const PROCESSES = [birth, greet, gift, death, build];

function village(seed: number, processes: readonly ProcessDef[] = PROCESSES) {
  const truth = new WorldTruth();
  const ids = new IdAllocator();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { mint: ["coin"] } });
  const genesis = ids.next("event");
  log.append({
    id: genesis,
    tick: 0,
    kind: "genesis",
    actors: [],
    place: here,
    data: null,
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  truth.set(ENTITY, VILLAGE, { id: VILLAGE, originEventId: genesis, createdAt: 0 });
  const scheduler = new Scheduler({
    rng: Rng.root(seed),
    clock: EARTHLIKE_CLOCK,
    truth,
    ids,
    log,
    ledger,
    processes,
    resolution: "local",
    scopes: (kind, t) => (kind === "agent" ? living(t) : []),
  });
  return { truth, ids, log, ledger, scheduler };
}

const seeds = fc.nat({ max: 0xffffffff });

describe("leyes de la causalidad en una corrida", () => {
  it("sin huérfanos, todo con causa y la conservación cuadra", () => {
    fc.assert(
      fc.property(seeds, fc.integer({ min: 1, max: 90 }), (seed, days) => {
        const w = village(seed);
        w.scheduler.advanceTo(days * DAY);
        expect(checkInvariants(w)).toEqual([]);
        // Toda moneda en el mundo salió de la casa de moneda por un nacimiento.
        const minted = w.ledger
          .journal()
          .filter((j) => j.from === MINT)
          .reduce((s, j) => s + j.amount, 0);
        const burned = w.ledger
          .journal()
          .filter((j) => j.to === MINT)
          .reduce((s, j) => s + j.amount, 0);
        expect(w.ledger.total(COIN)).toBe(minted - burned);
        // Los muertos no tienen nada y cada uno murió por su evento de muerte.
        for (const id of w.truth.ids(ENTITY)) {
          const base = w.truth.get(ENTITY, id);
          if (base?.endEventId === undefined) continue;
          expect(w.log.get(base.endEventId)?.kind).toBe("death");
          expect(w.ledger.balance(holderAccount(id as AgentId), COIN)).toBe(0);
        }
        // Cada nacido salió de su nacimiento, y quien saluda cita ese nacimiento.
        for (const e of w.log.all()) {
          if (e.kind === "birth")
            expect(w.truth.get(ENTITY, e.actors[0] as AgentId)?.originEventId).toBe(e.id);
          if (e.kind === "greet") {
            const [cause] = w.log.causesOf(e.id);
            expect(w.log.get(cause as typeof e.id)?.actors).toEqual(e.actors);
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it("mismo seed, mismo registro, mismo diario y misma verdad", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const a = village(seed);
        const b = village(seed);
        a.scheduler.advanceTo(40 * DAY);
        b.scheduler.advanceTo(40 * DAY);
        expect(a.log.all()).toEqual(b.log.all());
        expect(a.ledger.journal()).toEqual(b.ledger.journal());
        expect(a.truth.rows()).toEqual(b.truth.rows());
      }),
      { numRuns: 20 },
    );
  });
});

describe("ids provisionales", () => {
  it("el perdedor de una contienda no consume ids", () => {
    const claim = (id: string, initiative: number) =>
      def(
        id,
        (ctx) => {
          const a = ctx.newId("agent");
          return {
            events: [
              {
                kind: "claim",
                actors: [a],
                place: here,
                data: null,
                emissions: {},
                causes: [{ kind: "seed" }],
              },
            ],
            changes: [
              createEntity(a, draftEvent(0), ctx.now),
              setComponent(HUT, VILLAGE, { owner: a }),
            ],
            contest: { initiative, place: here },
          };
        },
        { scope: "world", phase: "act", writes: ["entity", "hut"] },
      );
    for (let seed = 0; seed < 20; seed++) {
      const w = village(seed, [claim("demo.a", 0), claim("demo.b", 0)]);
      w.scheduler.advanceTo(DAY);
      expect(living(w.truth)).toEqual([makeId("agent", 1)]);
      expect(w.truth.get(HUT, VILLAGE)).toEqual({ owner: makeId("agent", 1) });
      // génesis, contienda, el reclamo ganador
      expect(w.log.all().map((e) => [e.id, e.kind])).toEqual([
        ["event:1", "genesis"],
        ["event:2", "contest"],
        ["event:3", "claim"],
      ]);
      expect(checkInvariants(w)).toEqual([]);
    }
  });

  it("usar un provisional que no se pidió es un error", () => {
    const bad = def(
      "demo.bad",
      (ctx) => ({ changes: [createEntity(makeId("agent", 1), draftEvent(3), ctx.now)] }),
      { scope: "world" },
    );
    expect(() => village(1, [bad]).scheduler.advanceTo(DAY)).toThrow(/no pidió ni emitió/);
  });

  it("un asiento tiene que ir por un evento de la misma corrida", () => {
    const bad = def(
      "demo.bad",
      () => ({ postings: [{ event: makeId("event", 1), transfers: [] }] }),
      { scope: "world" },
    );
    expect(() => village(1, [bad]).scheduler.advanceTo(DAY)).toThrow(SchedulerError);
  });

  it("un evento sin causas no entra al registro", () => {
    const bad = def(
      "demo.bad",
      () => ({
        events: [{ kind: "x", actors: [], place: here, data: null, emissions: {}, causes: [] }],
      }),
      { scope: "world" },
    );
    expect(() => village(1, [bad]).scheduler.advanceTo(DAY)).toThrow(/sin causas/);
  });
});
