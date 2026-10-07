// Una aldea de juguete para los tests (causality, persistencia): nacimientos, saludos, regalos,
// muertes y chozas, corrida por el scheduler con ledger y registro de eventos. No es contenido
// del juego; vive acá para que otras capas la puedan correr sin copiarla.
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
import { ENTITY, type ReadonlyWorldTruth, table, WorldTruth } from "../world/index.ts";
import {
  createEntity,
  draftEvent,
  endEntity,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  Scheduler,
  type SchedulerState,
  setComponent,
} from "./index.ts";

export const DAY = EARTHLIKE_CLOCK.day;
export const COIN = ledgerUnit("coin");
export const MINT = externalAccount("mint");
export const VILLAGE = makeId("settlement", 1);
export const here = { kind: "settlement", settlement: VILLAGE } as const;
export const HUT = table<{ owner: EntityRef }>("hut");

export function living(truth: ReadonlyWorldTruth): AgentId[] {
  return truth
    .ids(ENTITY)
    .filter(
      (id): id is AgentId =>
        id.startsWith("agent:") && truth.get(ENTITY, id)?.endedAt === undefined,
    );
}

export function def(
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

export const birth = def(
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
export const greet = def(
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
export const gift = def(
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
export const death = def(
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
export const build = def(
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

export const PROCESSES = [birth, greet, gift, death, build];

export function village(seed: number, processes: readonly ProcessDef[] = PROCESSES) {
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
  return resumeVillage(seed, { truth, ids, log, ledger }, processes);
}

/** Sigue una aldea desde un estado guardado (o recién sembrado). */
export function resumeVillage(
  seed: number,
  w: {
    truth: WorldTruth;
    ids: IdAllocator;
    log: EventLog;
    ledger: Ledger;
    scheduler?: SchedulerState;
  },
  processes: readonly ProcessDef[] = PROCESSES,
) {
  const { truth, ids, log, ledger } = w;
  const scheduler = new Scheduler(
    {
      rng: Rng.root(seed),
      clock: EARTHLIKE_CLOCK,
      truth,
      ids,
      log,
      ledger,
      processes,
      resolution: "local",
      scopes: (kind, t) => (kind === "agent" ? living(t) : []),
    },
    w.scheduler,
  );
  return { truth, ids, log, ledger, scheduler };
}
