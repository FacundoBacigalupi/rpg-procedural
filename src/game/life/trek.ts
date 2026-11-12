// La marcha de varios días del jugador (novel-sect-seat-trek, travel §5): el `move` del jugador a un
// lugar a más de `TREK_MIN_SECONDS` de camino abre una marcha que, como el viaje de los viajeros
// NPC (`NPC_JOURNEY`), bebe del agua del camino o del odre, come de las provisiones a la hora,
// duerme de noche y retoma el tramo tras un tropiezo, hasta llegar o rendirse.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  type ActionCatalog,
  BODY_STATE,
  type BodyPlanDef,
  climateMapAt,
  deleteComponent,
  draftEvent,
  ENTITY,
  type EventDraft,
  hexPath,
  LOCATION,
  type LocalMap,
  localHour,
  nearestHex,
  PERSON,
  PLACE,
  type PlanNode,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
  type WaterQuality,
} from "../../sim/index.ts";
import { PLAN_STATE } from "./act.ts";
import { drinkOnRoad, planFromDecision, restDue, startPlan } from "./npc-verbs.ts";
import { PLAYER } from "./player.ts";
import { ROUTINE, SKIN_CAPACITY_L, WATER_SKIN } from "./routine.ts";

/** Desde este camino (segundos de marcha) un `move` del jugador es una marcha de varios días. */
export const TREK_MIN_SECONDS = 8 * 3600;
/** Días de marcha tras los que se rinde (el plan se apaga y el jugador decide). */
export const TREK_MAX_DAYS = 30;
/** Lo que lleva de la despensa al partir: el grano de unos días, como los viajeros del perfil. */
export const TREK_PROVISIONS = { good: "grain", grams: 3000 } as const;
/** Entre una comida del camino y la siguiente, al menos esto (horas). */
const MEAL_GAP_HOURS = 4;

export interface PlayerTrek {
  readonly place: EntityRef;
  readonly since: Tick;
  /** Litros que le quedan en el odre. */
  readonly skin: number;
  /** Cuándo comió por última vez en el camino. */
  readonly ate?: Tick;
  /** Cuándo paró a dormir por última vez. */
  readonly rested?: Tick;
}
export const PLAYER_TREK = table<PlayerTrek>("life.player_trek");

export const TREK_PROCESS = "life.trek";
/** El evento de la marcha (`data.what`: started, arrived, gave_up, drank). */
export const TREK_EVENT = "life.trek";

export interface TrekOptions {
  readonly catalog: ActionCatalog;
  readonly plans: readonly BodyPlanDef[];
  readonly map: LocalMap;
  readonly clock: PlanetClock;
  /** Las provisiones que salen de la despensa del hogar al bolsillo al partir. */
  readonly provisions?: { readonly unit: string; readonly name: string; readonly grams: number };
  /** La calidad del agua donde está; sin esto, agua limpia. */
  readonly quality?: (
    truth: ReadonlyWorldTruth,
    who: AgentId,
    now?: number,
  ) => WaterQuality | undefined;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** El lugar al que va un plan que es un solo `move` (o `undefined`). */
function moveTarget(root: PlanNode): EntityRef | undefined {
  if (root.kind !== "do" || root.verb !== "move") return undefined;
  for (const a of root.args) if (a.role === "to" && "entity" in a) return a.entity;
  return undefined;
}

/** Segundos de camino de `from` al lugar (por el mapa); `undefined` si no hay camino. */
function roadSeconds(map: LocalMap, from: number, hexes: readonly number[]): number | undefined {
  const goal = nearestHex(map, from, hexes);
  if (goal === from) return 0;
  const path = hexPath(map, from, goal);
  if (path.length === 0) return undefined;
  return path.reduce((t, h) => t + (map.crossSeconds[h] ?? 0), 0);
}

/**
 * La secuencia de los planes que arma la marcha: negativa, para no chocar con las del jugador
 * (positivas, del guardado); baja de a uno desde la del plan que la abrió.
 */
function trekSeq(seq: number): number {
  return seq < 0 ? seq - 1 : -(seq * 1000 + 1);
}

function trekEvent(
  me: AgentId,
  what: "started" | "arrived" | "gave_up" | "drank",
  place: EntityRef,
  at: PlaceRef,
  data: Readonly<Record<string, number | string>> = {},
): EventDraft {
  return {
    kind: TREK_EVENT,
    actors: [me],
    place: at,
    data: { what, place, ...data },
    emissions: what === "drank" ? { sight: 0.2 } : {},
    causes: [{ kind: "state", entity: me, key: "intent" }],
  };
}

/** Escritor de `PLAYER_TREK` y de los planes del camino del jugador (cableado opt-in). */
export function trekProcess(o: TrekOptions): ProcessDef {
  const prov = o.provisions;
  return {
    id: TREK_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      PLAYER.name,
      PLAN_STATE.name,
      PLAYER_TREK.name,
      ENTITY.name,
      PERSON.name,
      LOCATION.name,
      PLACE.name,
      BODY_STATE.name,
      WATER_SKIN.name,
    ],
    writes: [PLAN_STATE.name, PLAYER_TREK.name, BODY_STATE.name, WATER_SKIN.name],
    run(ctx) {
      const truth = ctx.truth;
      for (const id of truth.ids(PLAYER)) {
        const me = id as AgentId;
        if (truth.get(ENTITY, me)?.endedAt !== undefined) continue;
        const body = truth.get(BODY_STATE, me);
        if (!body || body.death) continue;
        const here = truth.get(LOCATION, me)?.hex;
        if (here === undefined) continue;
        const state = truth.get(PLAN_STATE, me);
        const trek = truth.get(PLAYER_TREK, me);
        const at = o.placeOf(truth, me);
        const pocket = holderAccount(me as unknown as HolderRef);
        if (!trek) {
          // Abre la marcha: el plan del jugador es ir a un lugar lejos.
          if (!state || state.done || state.seq < 0) continue;
          const target = moveTarget(state.plan.root);
          const hexes = target ? (truth.get(PLACE, target)?.hexes ?? []) : [];
          if (!target || hexes.length === 0) continue;
          const seconds = roadSeconds(o.map, here, hexes);
          if (seconds === undefined || seconds < TREK_MIN_SECONDS) continue;
          const home = truth.get(PERSON, me)?.household;
          const stock =
            prov && home
              ? (ctx.ledger?.balance(
                  holderAccount(home as unknown as HolderRef),
                  ledgerUnit(prov.unit),
                ) ?? 0)
              : 0;
          const pack = prov ? Math.min(prov.grams, stock) : 0;
          const postings: PostingDraft[] =
            prov && home && pack > 0
              ? [
                  {
                    event: draftEvent(0),
                    transfers: [
                      {
                        unit: ledgerUnit(prov.unit),
                        from: holderAccount(home as unknown as HolderRef),
                        to: pocket,
                        amount: pack,
                      },
                    ],
                  },
                ]
              : [];
          return {
            changes: [
              setComponent(PLAYER_TREK, me, {
                place: target,
                since: ctx.now,
                skin: truth.get(WATER_SKIN, me)?.liters ?? SKIN_CAPACITY_L,
              }),
            ],
            events: [
              trekEvent(me, "started", target, at, {
                hours: Math.round(seconds / 360) / 10,
                food: pack,
              }),
            ],
            ...(postings.length > 0 ? { postings } : {}),
          };
        }
        const hexes = truth.get(PLACE, trek.place)?.hexes ?? [];
        const days = (ctx.now - trek.since) / o.clock.day;
        const end: StateChange[] = [
          deleteComponent(PLAYER_TREK, me),
          setComponent(WATER_SKIN, me, { liters: trek.skin }),
        ];
        if (hexes.includes(here)) {
          return {
            changes: end,
            events: [
              trekEvent(me, "arrived", trek.place, at, { days: Math.round(days * 100) / 100 }),
            ],
          };
        }
        if (days >= TREK_MAX_DAYS || hexes.length === 0) {
          return {
            changes: [
              ...end,
              ...(state && !state.done
                ? [setComponent(PLAN_STATE, me, { ...state, done: true })]
                : []),
            ],
            events: [
              trekEvent(me, "gave_up", trek.place, at, { days: Math.round(days * 100) / 100 }),
            ],
          };
        }
        // Con sed bebe donde está o del odre, sin cortar el tramo.
        const bodyPlan = o.plans.find((p) => p.id === body.plan);
        const sip =
          bodyPlan && body.consciousness !== "unconscious"
            ? drinkOnRoad(
                bodyPlan,
                body,
                trek.skin,
                SKIN_CAPACITY_L,
                o.quality?.(truth, me, ctx.now),
              )
            : undefined;
        if (sip) {
          return {
            changes: [
              setComponent(BODY_STATE, me, sip.body),
              setComponent(PLAYER_TREK, me, { ...trek, skin: sip.skin }),
            ],
            events: [
              trekEvent(me, "drank", trek.place, at, {
                liters: Math.round(sip.liters * 100) / 100,
                from: sip.from,
              }),
            ],
          };
        }
        const prevSeq = trekSeq(state?.seq ?? 0) - 1;
        const hour = Math.floor(localHour(o.clock, ctx.now, climateMapAt(o.map, here).lonDeg));
        // Hora de comida con provisiones encima: come y sigue.
        const carried = prov ? (ctx.ledger?.balance(pocket, ledgerUnit(prov.unit)) ?? 0) : 0;
        if (
          prov &&
          carried > 0 &&
          ROUTINE.meals.includes(hour) &&
          (trek.ate === undefined || ctx.now - trek.ate >= MEAL_GAP_HOURS * 3600)
        ) {
          const meal = planFromDecision({ id: `eat:${prov.name}`, verb: "eat" }, o.catalog, me);
          if (meal) {
            return startPlan(me, { ...meal, source: "player" }, prevSeq, ctx.now, {
              changes: [setComponent(PLAYER_TREK, me, { ...trek, ate: ctx.now })],
            });
          }
        }
        // De noche (o agotado) para y duerme; sigue al alba.
        if (restDue(hour, trek.rested, ctx.now, body.fatigue ?? 0)) {
          const sleep = planFromDecision({ id: "rest:", verb: "rest" }, o.catalog, me);
          if (sleep) {
            return startPlan(me, { ...sleep, source: "player" }, prevSeq, ctx.now, {
              changes: [setComponent(PLAYER_TREK, me, { ...trek, rested: ctx.now })],
            });
          }
        }
        if (state && !state.done) continue;
        // El tramo terminó (o un tropiezo cortó el plan) y no llegó: sigue el camino.
        const go = planFromDecision({ id: `move:${trek.place}`, verb: "move" }, o.catalog, me);
        if (go) return startPlan(me, { ...go, source: "player" }, prevSeq, ctx.now);
      }
      return {};
    },
  };
}
