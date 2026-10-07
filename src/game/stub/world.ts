// El mundo del stub del turno (player-loop §15, Fase 0): una aldea con el personaje y unos
// aldeanos que trabajan y a veces se regalan monedas. No es contenido del juego: sirve para que
// el loop de la CLI tenga algo que avanzar, guardar y rehacer. Se reemplaza en la Fase 1 por la
// aldea de verdad.
//
// El plan del jugador entra al mundo como el componente `intent` del personaje (su voluntad,
// como el seed es la del autor) más un ítem agendado para cuando termina; el proceso
// `stub.intent` lo ejecuta contra el estado de ese momento y lo borra.

import {
  type AgentId,
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  MINUTE,
  makeId,
  Rng,
  type Seed,
  type Tick,
  type Transfer,
} from "../../core/index.ts";
import {
  createEntity,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  type ReadonlyWorldTruth,
  Scheduler,
  type SchedulerState,
  setComponent,
  table,
  WorldTruth,
} from "../../sim/index.ts";

export const CLOCK = EARTHLIKE_CLOCK;
export const DAY = CLOCK.day;
export const COIN = ledgerUnit("coin");
/** Lo que queda fuera de la aldea: de ahí viene la paga y ahí va lo que se gasta. */
export const OUTSIDE = externalAccount("outside");
export const VILLAGE = makeId("settlement", 1);
export const HERE = { kind: "settlement", settlement: VILLAGE } as const;
export const HUT_COST = 5;

/** Los planes que entiende el stub. JSON plano: van a `player_plans` y al replay. */
export type StubPlan =
  | { readonly verb: "wait"; readonly seconds: number }
  | { readonly verb: "look" }
  | { readonly verb: "build" }
  | { readonly verb: "give"; readonly to: AgentId; readonly amount: number };

export const PLAYER = table<{ readonly since: Tick }>("player");
export const INTENT = table<{ readonly seq: number; readonly plan: StubPlan; readonly at: Tick }>(
  "intent",
);
export const HUT = table<{ readonly owner: AgentId }>("hut");

export interface StubSetup {
  /** Cuántos aldeanos además del personaje. */
  readonly villagers: number;
}

/** Cuánto tarda cada plan: el turno avanza hasta ahí (o hasta una interrupción). */
export function planDuration(plan: StubPlan): number {
  switch (plan.verb) {
    case "wait":
      return plan.seconds;
    case "look":
    case "give":
      return MINUTE;
    case "build":
      return DAY;
  }
}

export function living(truth: ReadonlyWorldTruth): AgentId[] {
  return truth
    .ids(ENTITY)
    .filter(
      (id): id is AgentId =>
        id.startsWith("agent:") && truth.get(ENTITY, id)?.endedAt === undefined,
    );
}

function isPlayer(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(PLAYER, id) !== undefined;
}

function purse(ctx: ProcessContext, who: AgentId): number {
  return ctx.ledger?.balance(holderAccount(who), COIN) ?? 0;
}

function base(id: string, over: Partial<ProcessDef> & Pick<ProcessDef, "run">): ProcessDef {
  return {
    id,
    system: "stub",
    scope: "agent",
    cadence: { local: "day" },
    representation: "individual",
    phase: "act",
    reads: ["entity", "player"],
    writes: [],
    ...over,
  };
}

/** Los aldeanos trabajan casi todos los días y cobran de afuera. */
const work = base("stub.work", {
  run(ctx) {
    const me = ctx.scope as AgentId;
    if (isPlayer(ctx.truth, me) || !ctx.rng.chance(0.7)) return {};
    return single({ kind: "work", actors: [me], data: null, cause: "needs" }, [
      { from: OUTSIDE, to: holderAccount(me), amount: ctx.rng.int(1, 3) },
    ]);
  },
});

/** A veces un aldeano le regala algo a otro (al personaje también). */
const gift = base("stub.gift", {
  run(ctx) {
    const me = ctx.scope as AgentId;
    const mine = purse(ctx, me);
    if (isPlayer(ctx.truth, me) || mine === 0 || !ctx.rng.chance(0.1)) return {};
    const others = living(ctx.truth).filter((a) => a !== me);
    if (others.length === 0) return {};
    const to = ctx.rng.pick(others);
    const amount = ctx.rng.int(1, Math.min(mine, 3));
    return single({ kind: "gift", actors: [me, to], data: { amount }, cause: "purse" }, [
      { from: holderAccount(me), to: holderAccount(to), amount },
    ]);
  },
});

/** Ejecuta el plan del personaje cuando termina su duración, contra el estado de ese momento. */
const intent = base("stub.intent", {
  cadence: { local: "onEvent" },
  reads: ["entity", "player", "intent", "hut"],
  writes: ["entity", "intent", "hut"],
  run(ctx) {
    const me = ctx.scope as AgentId;
    const current = ctx.truth.get(INTENT, me);
    // Un plan nuevo reemplaza al anterior: el ítem viejo ya no tiene a quién ejecutar.
    if (!current || !ctx.item || ctx.item.reason.kind !== "state") return {};
    if (ctx.item.reason.key !== intentKey(current.seq)) return {};
    if (ctx.truth.get(ENTITY, me)?.endedAt !== undefined) return {};
    const done = deleteComponent(INTENT, me);
    const plan = current.plan;
    const cause = intentKey(current.seq);

    if (plan.verb === "build") {
      if (purse(ctx, me) < HUT_COST) {
        return single(
          { kind: "build-failed", actors: [me], data: { reason: "coins" }, cause },
          [],
          [done],
        );
      }
      // La choza nace del evento que la levantó.
      const hut = ctx.newId("building");
      return single(
        { kind: "build", actors: [me], data: { building: hut }, cause },
        [{ from: holderAccount(me), to: OUTSIDE, amount: HUT_COST }],
        [done, createEntity(hut, draftEvent(0), ctx.now), setComponent(HUT, hut, { owner: me })],
      );
    }
    if (plan.verb === "give") {
      const alive = ctx.truth.get(ENTITY, plan.to);
      if (!alive || alive.endedAt !== undefined || plan.to === me) {
        return single(
          { kind: "give-failed", actors: [me], data: { reason: "nobody", to: plan.to }, cause },
          [],
          [done],
        );
      }
      if (purse(ctx, me) < plan.amount) {
        return single(
          { kind: "give-failed", actors: [me], data: { reason: "coins", to: plan.to }, cause },
          [],
          [done],
        );
      }
      return single(
        { kind: "gift", actors: [me, plan.to], data: { amount: plan.amount }, cause },
        [{ from: holderAccount(me), to: holderAccount(plan.to), amount: plan.amount }],
        [done],
      );
    }
    // Esperar y mirar no cambian el mundo.
    return { changes: [done] };
  },
});

export const STUB_PROCESSES: readonly ProcessDef[] = [work, gift, intent];

export function intentKey(seq: number): string {
  return `intent.${seq}`;
}

/** Un evento del personaje o de un aldeano con su asiento (si mueve monedas). */
function single(
  e: { kind: string; actors: AgentId[]; data: unknown; cause: string },
  transfers: readonly Omit<Transfer, "unit">[],
  changes: ProcessResult["changes"] = [],
): ProcessResult {
  const event: EventDraft = {
    kind: e.kind,
    actors: e.actors,
    place: HERE,
    data: e.data,
    emissions: {},
    causes: [{ kind: "state", entity: e.actors[0] as AgentId, key: e.cause }],
  };
  return {
    events: [event],
    changes,
    postings:
      transfers.length > 0
        ? [{ event: draftEvent(0), transfers: transfers.map((t) => ({ unit: COIN, ...t })) }]
        : [],
  };
}

export interface StubWorld {
  readonly truth: WorldTruth;
  readonly ids: IdAllocator;
  readonly log: EventLog;
  readonly ledger: Ledger;
  readonly scheduler: Scheduler;
}

/** Siembra la aldea: el personaje es `agent:1`, cada uno con unas monedas de arranque. */
export function createStubWorld(seed: Seed, setup: StubSetup): StubWorld {
  if (!Number.isSafeInteger(setup.villagers) || setup.villagers < 0 || setup.villagers > 50) {
    throw new RangeError(`cantidad de aldeanos inválida: ${setup.villagers}`);
  }
  const truth = new WorldTruth();
  const ids = new IdAllocator();
  const log = new EventLog();
  const ledger = new Ledger({ externals: { outside: ["coin"] } });
  const genesis = ids.next("event");
  log.append({
    id: genesis,
    tick: 0,
    kind: "genesis",
    actors: [],
    place: HERE,
    data: null,
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  truth.set(ENTITY, VILLAGE, { id: VILLAGE, originEventId: genesis, createdAt: 0 });
  const rng = Rng.root(seed).fork("stub", "setup");
  const transfers = [];
  for (let i = 0; i <= setup.villagers; i++) {
    const who = ids.next("agent");
    truth.set(ENTITY, who, { id: who, originEventId: genesis, createdAt: 0 });
    if (i === 0) truth.set(PLAYER, who, { since: 0 });
    transfers.push({ unit: COIN, from: OUTSIDE, to: holderAccount(who), amount: rng.int(3, 12) });
  }
  ledger.post({ tick: 0, eventId: genesis, transfers });
  return resumeStubWorld(seed, { truth, ids, log, ledger });
}

/** Sigue la aldea desde un estado guardado. */
export function resumeStubWorld(
  seed: Seed,
  w: {
    truth: WorldTruth;
    ids: IdAllocator;
    log: EventLog;
    ledger: Ledger;
    scheduler?: SchedulerState;
  },
): StubWorld {
  const scheduler = new Scheduler(
    {
      rng: Rng.root(seed),
      clock: CLOCK,
      truth: w.truth,
      ids: w.ids,
      log: w.log,
      ledger: w.ledger,
      processes: STUB_PROCESSES,
      resolution: "local",
      scopes: (kind, t) => (kind === "agent" ? living(t) : []),
    },
    w.scheduler,
  );
  return { truth: w.truth, ids: w.ids, log: w.log, ledger: w.ledger, scheduler };
}
