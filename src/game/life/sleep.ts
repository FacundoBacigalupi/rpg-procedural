// El sueño que consolida (npc-psychology §15, Fase 2): mientras alguien duerme se lleva la cuenta de
// la noche (horas, incomodidad por frío, calor o dolor, miedo si lo hirieron durmiendo), y al
// despertar, si durmió lo bastante para que cuente, corre una pasada de `consolidate`
// (`sim/mind/consolidation.ts`) con la calidad de esa noche. Escribe `MEMORIES` y `MIND` (las
// confirmaciones de esquema) y deja la pasada como evento `mind.consolidated` que cita las
// memorias que tocó. El stream es `rng.fork("psyche", npc, noche)`: no depende del orden.
//
// Lo que le importa a cada quien (relevancia) todavía no sale de objetivos —los NPC no los
// tienen—: sale de la cercanía con la gente de la memoria (los vínculos importan). El tema de
// cada memoria sale del tipo de evento y de su valencia.

import {
  type AgentId,
  type CauseRef,
  type EventId,
  type PlaceRef,
  type PlanetClock,
  Rng,
  type Seed,
} from "../../core/index.ts";
import {
  applySchemaUpdates,
  BODY_STATE,
  type Body,
  type BondDef,
  COMMUNITY_RELIGION,
  consolidate,
  type DimensionDef,
  deleteComponent,
  ENTITY,
  type EventDraft,
  MEMORIES,
  MENTAL,
  type Memory,
  MIND,
  nightmareCauses,
  nightmareChance,
  PERSON,
  type ProcessDef,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  recall,
  relationship,
  type SchemaDef,
  type StateChange,
  setComponent,
  settleConditions,
  sleepQuality,
  type Theme,
  table,
  vigilantSleepFear,
} from "../../sim/index.ts";
import { closeness } from "./appraise.ts";
import { supportFor } from "./support.ts";

export const SLEEP_PROCESS = "life.consolidate";

/** Lo que se lleva de una noche mientras dura. */
export interface SleepState {
  /** Cuándo se durmió. */
  readonly since: number;
  /** Hasta cuándo está contada. */
  readonly mark: number;
  /** Horas dormidas. */
  readonly hours: number;
  /** Horas × incomodidad (0-1), para promediar. */
  readonly discomfortHours: number;
  /** 0-1: el peor susto de la noche. */
  readonly fear: number;
}

export const SLEEP_STATE = table<SleepState>("life.sleep");

/** Bajo estas horas dormidas no hay pasada (una siesta no consolida). */
export const MIN_SLEEP_HOURS = 3;
/** Lo que un adulto necesita dormir. */
export const NEED_HOURS = 8;
/** Frío (°C) desde el que molesta y los grados hasta el máximo malestar; igual para el calor. */
export const COLD_FROM_C = 10;
export const COLD_SPAN_C = 15;
export const HOT_FROM_C = 30;
export const HOT_SPAN_C = 10;
/** Cuánto del peor dolor de una herida abierta cuenta como incomodidad. */
export const PAIN_WEIGHT = 0.8;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Incomodidad 0-1 de dormir con esta temperatura y estas heridas. */
export function discomfortOf(tempC: number, body: Pick<Body, "wounds">): number {
  const cold = clamp01((COLD_FROM_C - tempC) / COLD_SPAN_C);
  const hot = clamp01((tempC - HOT_FROM_C) / HOT_SPAN_C);
  const pain = body.wounds.reduce(
    (s, w) => (w.stage === "healed" ? s : Math.max(s, w.severity)),
    0,
  );
  return Math.max(cold, hot, PAIN_WEIGHT * clamp01(pain));
}

/** Susto de la noche: una herida nueva durante el sueño (lo atacaron) pesa por su gravedad. */
export function fearOf(body: Pick<Body, "wounds">, since: number): number {
  return body.wounds.reduce(
    (s, w) => (w.at >= since ? Math.max(s, 0.5 + 0.5 * clamp01(w.severity)) : s),
    0,
  );
}

/** El tema que una memoria le deja a los esquemas, según lo que pasó y cómo le dolió. */
export function themeOfMemory(m: Memory): Theme | undefined {
  switch (m.perceived.kind) {
    case "combat.fight":
      return m.valence < -0.2 ? "violence" : undefined;
    case "combat.finish":
      return m.valence < -0.5 ? "betrayal" : "violence";
    case "combat.spare":
      return "kindness";
    case "action.give":
    case "household.repaid":
      return "kindness";
    case "action.tend":
      return "care";
    case "action.trade":
      return m.valence >= 0 ? "success" : "failure";
    case "law.default":
    case "contract.pledge_broken":
      return "betrayal";
    case "body.died":
      return "loss";
    case "mind.hardship":
      return "hardship";
    case "family.rearing":
      return m.valence >= 0 ? "care" : "neglect";
    default:
      return undefined;
  }
}

export interface SleepOptions {
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly schemas: readonly SchemaDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  /** Temperatura que siente cada cuerpo (`ambient.ts`); sin ella, 18 °C. */
  readonly ambientOf?: (truth: ReadonlyWorldTruth, who: AgentId) => (at: number) => number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

function sleeping(body: Body): boolean {
  return body.activity === "sleep" && body.consciousness !== "unconscious" && body.death === null;
}

export function sleepProcess(o: SleepOptions): ProcessDef {
  return {
    id: SLEEP_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "settle",
    reads: [
      BODY_STATE.name,
      SLEEP_STATE.name,
      MEMORIES.name,
      MIND.name,
      RELATIONS.name,
      PERSON.name,
      ENTITY.name,
      MENTAL.name,
      COMMUNITY_RELIGION.name,
      RELIGIOUS_IDENTITY.name,
    ],
    writes: [SLEEP_STATE.name, MEMORIES.name, MIND.name, MENTAL.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      const body = truth.get(BODY_STATE, me);
      const st = truth.get(SLEEP_STATE, me);
      if (!body || !truth.get(PERSON, me) || truth.get(ENTITY, me)?.endedAt !== undefined) {
        return st ? { changes: [deleteComponent(SLEEP_STATE, me)] } : {};
      }

      if (sleeping(body)) {
        const since = st?.since ?? Math.max(0, ctx.now - ctx.window);
        const mark = st?.mark ?? since;
        const hours = Math.max(0, ctx.now - mark) / 3600;
        const temp = o.ambientOf?.(truth, me)(ctx.now) ?? 18;
        const next: SleepState = {
          since,
          mark: ctx.now,
          hours: round((st?.hours ?? 0) + hours),
          discomfortHours: round((st?.discomfortHours ?? 0) + hours * discomfortOf(temp, body)),
          fear: round(Math.max(st?.fear ?? 0, fearOf(body, since))),
        };
        return { changes: [setComponent(SLEEP_STATE, me, next)] };
      }

      if (!st) return {};
      // Despertó (o lo despertaron): si durmió lo bastante, la mente hace su pasada.
      const drop = deleteComponent(SLEEP_STATE, me);
      if (st.hours < MIN_SLEEP_HOURS) return { changes: [drop] };

      // Trauma y culpa de haber matado: una noche mala si la mente los trae, y el tiempo los gasta.
      const mental = truth.get(MENTAL, me);
      const night = Math.floor(st.since / o.clock.day);
      const dreamt =
        mental !== undefined &&
        Rng.root(o.seed).fork("nightmare", me, night).float() < nightmareChance(mental);
      const quality = sleepQuality({
        hours: st.hours,
        needHours: NEED_HOURS,
        discomfort: st.hours > 0 ? st.discomfortHours / st.hours : 0,
        // Quien está en guardia duerme con un oído abierto: miedo de fondo (hipervigilancia).
        fear: Math.max(st.fear, vigilantSleepFear(mental)),
        ...(dreamt && mental
          ? { nightmares: Math.max(0, ...mental.conditions.map((c) => c.severity)) }
          : {}),
      });
      const mind = truth.get(MIND, me);
      const rels = truth.get(RELATIONS, me);
      const result = consolidate({
        memories: truth.get(MEMORIES, me),
        now: ctx.now,
        quality,
        rng: Rng.root(o.seed).fork("psyche", me, night),
        relevance: (m) =>
          Math.max(
            0,
            ...m.perceived.with.map((w) =>
              closeness(
                relationship(rels, w, ctx.now, {
                  dims: o.dims,
                  bonds: o.bonds,
                  schemaStrength: (s) => mind?.schemas[s]?.strength ?? 0,
                }),
              ),
            ),
          ),
        themeOf: themeOfMemory,
        schemas: o.schemas,
        ...(mind ? { mind } : {}),
      });
      const { pass } = result;
      const touched = new Set<EventId>([
        ...pass.strengthened,
        ...pass.merged.flatMap(([a, b]) => [a, b]),
        ...pass.faded,
      ]);
      const causes: CauseRef[] = [...touched]
        .sort()
        .map((event) => ({ kind: "event", event }) as const);
      if (causes.length === 0) causes.push({ kind: "state", entity: me, key: "sleep" });

      const event: EventDraft = {
        kind: "mind.consolidated",
        actors: [me],
        place: o.placeOf(truth, me),
        data: {
          night,
          hours: st.hours,
          quality: pass.sleepQuality,
          strengthened: pass.strengthened,
          merged: pass.merged,
          faded: pass.faded,
          schemaUpdates: pass.schemaUpdates,
        },
        emissions: {},
        causes,
      };
      // La pesadilla es un recuerdo intrusivo: reactiva (refuerza) las memorias de lo que la causó.
      const woken = new Set(dreamt ? nightmareCauses(mental) : []);
      const memories =
        woken.size === 0
          ? result.memories
          : {
              ...result.memories,
              items: result.memories.items.map((m) =>
                woken.has(m.eventId) ? recall(m, ctx.now) : m,
              ),
            };
      const changes: StateChange[] = [drop, setComponent(MEMORIES, me, memories)];
      if (mind && pass.schemaUpdates.length > 0) {
        changes.push(setComponent(MIND, me, applySchemaUpdates(mind, pass.schemaUpdates)));
      }
      const events: EventDraft[] = [event];
      if (mental) {
        const settled = settleConditions(
          mental,
          ctx.now,
          o.clock.day,
          mental.conditions.length > 0 ? supportFor(truth, me) : 0,
        );
        changes.push(setComponent(MENTAL, me, settled));
        if (dreamt) {
          events.push({
            kind: "mind.nightmare",
            actors: [me],
            place: o.placeOf(truth, me),
            data: { night, conditions: mental.conditions.map((c) => c.kind) },
            emissions: {},
            causes: nightmareCauses(mental).map((ev) => ({ kind: "event", event: ev }) as const),
          });
        }
      }
      return { events, changes };
    },
  };
}
