// Observar las leyes del campo (discovery §3, Fase 2): quien trabaja la tierra ve la causa (la hora
// de trabajo, el momento del año y del ciclo de la luna) y el efecto (cuánto rindió), y eso es una
// observación que mueve sus hipótesis sobre de qué depende el rinde. Lo que nota de la situación es
// lo que se siente, no el calendario: el tramo del año por la estación del hemisferio donde está, el
// de la luna por su fase. Ni la verdad ni el factor que la sim usa para rendir pasan por acá: solo los
// gramos que cosechó, percibidos con ruido. Los NPC y el personaje pasan por lo mismo.
//
// Verlo trabajar a otro (experiencia indirecta) llega con la percepción de los NPC presentes.

import type { AgentId, Event, EventId, PlanetClock } from "../../core/index.ts";
import {
  bucketOf,
  dayOf,
  ENTITY,
  FIELD_YIELD,
  HARVEST_GRAMS_PER_HOUR,
  LAW_BELIEFS,
  type LawBelief,
  type LawBeliefs,
  lawKeyId,
  moonAt,
  type Observation,
  observationId,
  observe,
  PERSON,
  type PerceivedSituation,
  type ProcessDef,
  perceiveYield,
  priorBelief,
  type StateChange,
  setComponent,
  skyObserverOf,
  wonder,
  yearPhase,
} from "../../sim/index.ts";

export const OBSERVE_PROCESS = "life.observe";

/** Una hora de campo que se tiene por buena (la de pleno verano con la tierra entera). */
export const GOOD_HOUR_GRAMS = HARVEST_GRAMS_PER_HOUR;
/** Qué tan nítido ve el rinde de una hora de trabajo propia. */
export const OWN_WORK_CLARITY = 0.85;

export interface ObserveOptions {
  readonly clock: PlanetClock;
  readonly map: {
    readonly lonDeg: number;
    readonly climate: { readonly latDeg: number; readonly axialTiltDeg: number };
  };
}

interface Harvest {
  readonly who: AgentId;
  readonly gramsPerHour: number;
}

/** Quién cosechó y a cuántos gramos por hora, si el evento trae un rinde para ver. */
export function harvestOf(e: Event): Harvest | undefined {
  const who = e.actors[0] as AgentId | undefined;
  if (!who) return undefined;
  const data = (e.data ?? {}) as {
    grams?: number;
    effect?: { kind?: string; gramsPerHour?: number; effectiveSeconds?: number };
  };
  if (e.kind === "routine.harvested" && typeof data.grams === "number") {
    return { who, gramsPerHour: data.grams };
  }
  const eff = data.effect;
  if (
    e.kind === "action.work" &&
    eff?.kind === "work" &&
    typeof eff.gramsPerHour === "number" &&
    (eff.effectiveSeconds ?? 0) > 0
  ) {
    return { who, gramsPerHour: eff.gramsPerHour };
  }
  return undefined;
}

/** Lo que notó de las condiciones: la estación que se siente en su hemisferio y la fase de la luna. */
export function senseSituation(o: ObserveOptions, tick: number): PerceivedSituation {
  const shifted = tick + Math.round((o.map.lonDeg / 360) * o.clock.day);
  const phase = yearPhase(o.clock, dayOf(o.clock, shifted));
  const season = bucketOf(o.map.climate.latDeg >= 0 ? phase : phase + 0.5);
  const moons = o.clock.moons.length;
  return moons === 0
    ? { season }
    : { season, moon: bucketOf(moonAt(o.clock, skyObserverOf(o.map), 0, tick).phase) };
}

export function observeProcess(o: ObserveOptions): ProcessDef {
  const keyId = lawKeyId(FIELD_YIELD);
  return {
    id: OBSERVE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [LAW_BELIEFS.name, PERSON.name, ENTITY.name],
    writes: [LAW_BELIEFS.name],
    run(ctx) {
      const truth = ctx.truth;
      const rows = new Map<AgentId, LawBeliefs>();
      for (const e of ctx.recent) {
        const h = harvestOf(e);
        if (!h || !truth.get(PERSON, h.who) || truth.get(ENTITY, h.who)?.endedAt !== undefined) {
          continue;
        }
        const row = rows.get(h.who) ?? truth.get(LAW_BELIEFS, h.who);
        const rng = ctx.rng.fork("discovery", h.who, keyId, e.id);
        const belief: LawBelief =
          row?.beliefs[keyId] ??
          priorBelief(FIELD_YIELD, ctx.rng.fork("discovery", h.who, keyId, "prior"), e.tick);
        const obs: Observation = {
          id: observationId(h.who, e.id as EventId),
          observer: h.who,
          key: FIELD_YIELD,
          eventId: e.id,
          at: e.tick,
          situation: senseSituation(o, e.tick),
          outcome: perceiveYield(h.gramsPerHour, GOOD_HOUR_GRAMS, rng.fork("outcome")),
          confidence: OWN_WORK_CLARITY,
          delay: 0,
          deliberate: false,
        };
        const next = wonder(observe(belief, obs), rng.fork("wonder"), e.id);
        rows.set(h.who, {
          beliefs: { ...(row?.beliefs ?? {}), [keyId]: next },
          originEventId: row?.originEventId ?? e.id,
        });
      }
      const changes: StateChange[] = [...rows].map(([id, r]) => setComponent(LAW_BELIEFS, id, r));
      return changes.length === 0 ? {} : { changes };
    },
  };
}
