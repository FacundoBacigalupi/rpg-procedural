// El NPC ejecuta el verbo que decidió (actions §10, npc-c): la candidata ganadora de `life.decide`
// (`life.decision`) se vuelve un `ActionPlan` de fuente `utility` y entra a `life.plan` como el del
// personaje; `life.act` lo resuelve con la misma tirada, eventos y aprendizaje. Opt-in por verbo
// (`NpcVerbsOptions.verbs`): apagado, la decisión sigue sin mover nada salvo lo que ya ejecutan
// `life.routine` (comer, hervir, descansar, ir) y `life.lend`/`life.pawn_decide`.

import {
  type AgentId,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionCatalog,
  type ActionPlan,
  type ArgValue,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  LOCATION,
  localHour,
  PERSON,
  PLACE,
  type PostingDraft,
  type ProcessDef,
  type ProcessResult,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { ACT_PROCESS, FRESH_CURSOR, PLAN_STATE, type PlanState, planKey } from "./act.ts";
import { type Decision, NPC_DECISION } from "./decide.ts";
import { ROUTINE } from "./routine.ts";

/** Cada cuánto como mucho vuelve a comer un viajero (horas). */
const MEAL_GAP_HOURS = 4;

export const NPC_VERBS_PROCESS = "life.npc_verbs";

export interface NpcVerbsOptions {
  readonly catalog: ActionCatalog;
  /** Verbos de la decisión que se ejecutan (el resto sigue como hasta ahora). */
  readonly verbs: readonly string[];
  readonly day: number;
  /** El personaje decide por su cuenta: queda afuera. */
  readonly player: AgentId;
  /**
   * Opt-in (con `placeOf`): ir a un lugar abre un viaje (`NPC_JOURNEY`) que sigue de día en día
   * hasta llegar o hasta `journeyDays` días; sin esto, el `move` vence con la decisión del día.
   */
  readonly journeyDays?: number;
  readonly placeOf?: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Opt-in (con `journeyDays`): de noche el viajero interrumpe el tramo, duerme y sigue al alba. */
  readonly nightRest?: { readonly clock: PlanetClock; readonly lonDeg: number };
  /**
   * Opt-in (con `journeyDays`): el viajero sale con `grams` de `unit` de la despensa de su hogar
   * en el bolsillo (del libro mayor al suyo), come de eso en las horas de comida del camino
   * interrumpiendo el tramo y, al llegar o rendirse, devuelve lo que sobra a la despensa.
   */
  readonly provisions?: {
    readonly unit: string;
    readonly name: string;
    readonly grams: number;
    readonly clock: PlanetClock;
    readonly lonDeg: number;
  };
}

/** Qué decisión ya se volvió plan, para no repetirla cada hora mientras siga vigente. */
export const NPC_VERB_LOG = table<{ readonly at: Tick; readonly id: string }>("life.npc_verb_log");

const ENTITY_PART = /^(agent|place):/;
/** Ids con partes propias de otro proceso (pedir prestado, empeñar, ir hacia): no son del catálogo. */
const SPECIAL_PART = /^(borrow|pawn|toward):/;

/**
 * El plan de una decisión del catálogo (puro): el id es `<verbo>:<parte>+<parte>` con las partes en
 * el orden de los argumentos del verbo (`idOf` de `utility-verbs`). Lo que no encaja, un verbo
 * desconocido o un id con partes de otro proceso, no se ejecuta (`undefined`).
 */
export function planFromDecision(
  decision: Pick<Decision, "id" | "verb"> & Partial<Pick<Decision, "act">>,
  catalog: ActionCatalog,
  actor: AgentId,
): ActionPlan | undefined {
  const def = catalog.verb(decision.verb);
  const prefix = `${decision.verb}:`;
  if (!def || !decision.id.startsWith(prefix)) return undefined;
  const rest = decision.id.slice(prefix.length);
  // `move:<lugar>+toward:<persona>`: ir hacia donde cree que está alguien. El destino es el lugar;
  // la persona es el porqué, no un argumento del verbo.
  const parts = (rest === "" ? [] : rest.split("+")).filter(
    (p) => !(decision.verb === "move" && p.startsWith("toward:")),
  );
  if (parts.some((p) => SPECIAL_PART.test(p))) return undefined;
  const args: ArgValue[] = [];
  let next = 0;
  for (const a of def.args) {
    if (a.kind === "duration") {
      // La duración por defecto no deja parte en el id; se usa la del verbo.
      if (a.required) return undefined;
      continue;
    }
    const part = parts[next];
    if (part === undefined) {
      if (a.required) return undefined;
      continue;
    }
    if (a.kind === "text") {
      if (ENTITY_PART.test(part)) {
        if (a.required) return undefined;
        continue;
      }
      args.push({ role: a.role, text: part });
    } else {
      if (!ENTITY_PART.test(part)) {
        if (a.required) return undefined;
        continue;
      }
      args.push({ role: a.role, entity: part as never });
    }
    next++;
  }
  if (next !== parts.length) return undefined;
  // El acto de habla declarado por la candidata viaja con el contenido (vacío si no dice palabras).
  if (decision.act && decision.verb === "speak") {
    const at = args.findIndex((a) => a.role === "content" && "text" in a);
    const spoken = args[at];
    if (at >= 0 && spoken && "text" in spoken) args[at] = { ...spoken, act: decision.act };
    else args.push({ role: "content", text: "", act: decision.act });
  }
  return {
    actor,
    source: "utility",
    root: { kind: "do", verb: decision.verb, args, manner: [] },
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "utility" }],
  };
}

/** Convierte la decisión vigente en plan y lo agenda para `life.act`; un plan en curso no se pisa. */
export function npcVerbsProcess(o: NpcVerbsOptions): ProcessDef {
  const allowed = new Set(o.verbs);
  return {
    id: NPC_VERBS_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      NPC_DECISION.name,
      PLAN_STATE.name,
      ENTITY.name,
      NPC_VERB_LOG.name,
      LOCATION.name,
      PLACE.name,
      ...(o.provisions ? [PERSON.name] : []),
      ...(o.journeyDays !== undefined ? [NPC_JOURNEY.name] : []),
    ],
    writes: [
      PLAN_STATE.name,
      NPC_VERB_LOG.name,
      ...(o.journeyDays !== undefined ? [NPC_JOURNEY.name] : []),
    ],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const journeyDays = o.journeyDays;
      const trip = journeyDays !== undefined ? truth.get(NPC_JOURNEY, me) : undefined;
      if (journeyDays !== undefined && trip && o.placeOf) {
        // Un viaje en curso manda hasta llegar o rendirse; no depende de que la decisión siga vigente.
        const hexes = truth.get(PLACE, trip.place as never)?.hexes ?? [];
        const here = truth.get(LOCATION, me)?.hex;
        const days = (ctx.now - trip.since) / o.day;
        const prov = o.provisions;
        const pocket = holderAccount(me as unknown as HolderRef);
        const carried = prov ? (ctx.ledger?.balance(pocket, ledgerUnit(prov.unit)) ?? 0) : 0;
        const end = (what: "arrived" | "gave_up") => {
          const home = truth.get(PERSON, me)?.household;
          // Lo que sobra de las provisiones vuelve a la despensa, con el evento del fin.
          const back: PostingDraft[] =
            prov && carried > 0 && home
              ? [
                  {
                    event: draftEvent(0),
                    transfers: [
                      {
                        unit: ledgerUnit(prov.unit),
                        from: pocket,
                        to: holderAccount(home as unknown as HolderRef),
                        amount: carried,
                      },
                    ],
                  },
                ]
              : [];
          return {
            changes: [deleteComponent(NPC_JOURNEY, me)],
            events: [journeyEvent(me, what, trip.place, days, o.placeOf?.(truth, me))],
            postings: back,
          };
        };
        if (here !== undefined && hexes.includes(here)) return end("arrived");
        if (days >= journeyDays) return end("gave_up");
        const going = truth.get(PLAN_STATE, me);
        // Hora de comida con provisiones encima: el tramo se corta, come y sigue el camino.
        if (prov && carried > 0) {
          const hour = Math.floor(localHour(prov.clock, ctx.now, prov.lonDeg));
          const due =
            ROUTINE.meals.includes(hour) &&
            (trip.ate === undefined || ctx.now - trip.ate >= MEAL_GAP_HOURS * 3600);
          const meal = due
            ? planFromDecision({ id: `eat:${prov.name}`, verb: "eat" }, o.catalog, me)
            : undefined;
          if (meal) {
            return startPlan(me, meal, going?.seq ?? 0, ctx.now, {
              changes: [setComponent(NPC_JOURNEY, me, { ...trip, ate: ctx.now })],
            });
          }
        }
        // De noche el viajero para y duerme (el `rest` del catálogo, la noche entera) y sigue al alba.
        if (o.nightRest) {
          const hour = Math.floor(localHour(o.nightRest.clock, ctx.now, o.nightRest.lonDeg));
          const sleep = restDue(hour, trip.rested, ctx.now)
            ? planFromDecision({ id: "rest:", verb: "rest" }, o.catalog, me)
            : undefined;
          if (sleep) {
            return startPlan(me, sleep, going?.seq ?? 0, ctx.now, {
              changes: [setComponent(NPC_JOURNEY, me, { ...trip, rested: ctx.now })],
            });
          }
        }
        if (going && !going.done) return {};
        const plan = planFromDecision({ id: `move:${trip.place}`, verb: "move" }, o.catalog, me);
        return plan ? startPlan(me, plan, going?.seq ?? 0, ctx.now) : {};
      }
      const decision = truth.get(NPC_DECISION, me);
      if (!decision || !allowed.has(decision.verb) || ctx.now - decision.at >= o.day) return {};
      const done = truth.get(NPC_VERB_LOG, me);
      if (decision.verb === "move") {
        // Con viaje, la decisión abre un solo viaje; llegar no lo reabre cuando la rutina lo aleja.
        if (journeyDays !== undefined && done && done.at === decision.at && done.id === decision.id)
          return {};
        // Un camino largo son varios tramos: sigue hasta llegar al lugar mientras la decisión vigue.
        const hexes = decision.target
          ? truth.get(PLACE, decision.target as never)?.hexes
          : undefined;
        const here = truth.get(LOCATION, me)?.hex;
        if (!hexes || here === undefined || hexes.includes(here)) return {};
      } else if (done && done.at === decision.at && done.id === decision.id) return {};
      const state = truth.get(PLAN_STATE, me);
      if (state && !state.done) return {};
      const plan = planFromDecision(decision, o.catalog, me);
      if (!plan) return {};
      const log = setComponent(NPC_VERB_LOG, me, { at: decision.at, id: decision.id });
      // Con viaje, ir a un lugar abre un viaje que sigue los días siguientes si no llega.
      const opens =
        journeyDays !== undefined &&
        o.placeOf &&
        decision.verb === "move" &&
        decision.target !== undefined;
      if (opens && decision.target) {
        const open = setComponent(NPC_JOURNEY, me, {
          place: decision.target,
          since: ctx.now,
          decision: decision.id,
          ...(truth.get(LOCATION, me) ? { from: truth.get(LOCATION, me)?.hex as number } : {}),
        });
        // Las provisiones salen de la despensa del hogar al bolsillo, con el evento de salida.
        const prov = o.provisions;
        const home = truth.get(PERSON, me)?.household;
        const stock =
          prov && home
            ? (ctx.ledger?.balance(
                holderAccount(home as unknown as HolderRef),
                ledgerUnit(prov.unit),
              ) ?? 0)
            : 0;
        const pack = prov ? Math.min(prov.grams, stock) : 0;
        return startPlan(me, plan, state?.seq ?? 0, ctx.now, {
          changes: [log, open],
          events: [journeyEvent(me, "started", decision.target, 0, o.placeOf?.(truth, me))],
          postings:
            prov && home && pack > 0
              ? [
                  {
                    event: draftEvent(0),
                    transfers: [
                      {
                        unit: ledgerUnit(prov.unit),
                        from: holderAccount(home as unknown as HolderRef),
                        to: holderAccount(me as unknown as HolderRef),
                        amount: pack,
                      },
                    ],
                  },
                ]
              : [],
        });
      }
      return startPlan(me, plan, state?.seq ?? 0, ctx.now, { changes: [log] });
    },
  };
}

/** Un viaje del NPC: a dónde va y desde cuándo; sigue de día en día hasta llegar o rendirse. */
export interface NpcJourney {
  readonly place: string;
  readonly since: Tick;
  /** La decisión que lo abrió. */
  readonly decision: string;
  /** El hex del que salió, si se sabía (`life.transit` parte de ahí). */
  readonly from?: number;
  /** Cuándo comió por última vez en el camino (`NpcVerbsOptions.provisions`). */
  readonly ate?: Tick;
  /** Cuándo paró a dormir por última vez en el camino (`NpcVerbsOptions.nightRest`). */
  readonly rested?: Tick;
}
export const NPC_JOURNEY = table<NpcJourney>("life.npc_journey");

/** Entre una parada a dormir y la siguiente pasa al menos esto (horas): una por noche. */
export const REST_GAP_HOURS = 12;

/** ¿Toca parar a dormir? De noche (las horas de sueño de la rutina) y sin haber parado hace poco. */
export function restDue(hour: number, restedAt: Tick | undefined, now: number): boolean {
  const night = hour >= ROUTINE.sleep || hour < ROUTINE.wake;
  return night && (restedAt === undefined || now - restedAt >= REST_GAP_HOURS * 3600);
}

function journeyEvent(
  me: AgentId,
  what: "started" | "arrived" | "gave_up",
  place: string,
  days: number,
  at: PlaceRef | undefined,
): EventDraft {
  return {
    kind: "npc.journey",
    actors: [me],
    place: at as PlaceRef,
    data: { what, place, days: Math.round(days * 100) / 100 },
    emissions: {},
    causes: [{ kind: "state", entity: me, key: "utility" }],
  };
}

function startPlan(
  me: AgentId,
  plan: ActionPlan,
  prevSeq: number,
  now: Tick,
  extra: {
    readonly changes?: readonly StateChange[];
    readonly events?: readonly EventDraft[];
    readonly postings?: readonly PostingDraft[];
  } = {},
): ProcessResult {
  const seq = prevSeq + 1;
  const next: PlanState = {
    seq,
    plan,
    cursor: FRESH_CURSOR,
    lastBelieved: null,
    steps: [],
    done: false,
  };
  return {
    changes: [setComponent(PLAN_STATE, me, next), ...(extra.changes ?? [])],
    ...(extra.events ? { events: extra.events } : {}),
    ...(extra.postings && extra.postings.length > 0 ? { postings: extra.postings } : {}),
    schedule: [
      {
        at: (now + 1) as Tick,
        phase: "act",
        process: ACT_PROCESS,
        scope: me,
        reason: { kind: "state", entity: me, key: planKey(seq) },
      },
    ],
  };
}
