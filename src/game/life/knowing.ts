// Qué cree cada vecino del personaje (information §1, §10; Fase 2: «conocimiento vs verdad»). Cada
// hora, los vecinos que comparten el hex con el personaje lo perciben con sus sentidos
// (perception): si lo reconocen, guardan dónde lo vieron y que vive, con la confianza con que
// lo leyeron y la hora a la que se refiere. Cuando el personaje se va, ellos siguen creyendo que
// está ahí: la creencia envejece (la confianza decae por horas), no se corrige sola, y puede
// quedar falsa. Nadie lee la verdad para saber dónde está el personaje.

import type { AgentId, PlanetClock, Seed } from "../../core/index.ts";
import {
  ATTENTION,
  attireLook,
  BELIEFS,
  BODY_STATE,
  type BondDef,
  type DimensionDef,
  ENTITY,
  LOCATION,
  type LocalMap,
  learn,
  type Observer,
  PERSON,
  type ProcessDef,
  perceive,
  presenceStimulus,
  RELATIONS,
  relationship,
  type SpaceGraph,
  STATUS,
  type StateChange,
  type StatusDef,
  sensorAcuity,
  setComponent,
  skyLight,
} from "../../sim/index.ts";

export const KNOWING_PROCESS = "life.knowing";

export interface KnowingOptions {
  readonly player: AgentId;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly statuses: readonly StatusDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
}

/** Piso de lo conocido: un vecino reconoce al personaje aunque casi no hayan hablado. */
const KNOWN_VILLAGER = 0.6;

export function knowingProcess(o: KnowingOptions): ProcessDef {
  return {
    id: KNOWING_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [
      PERSON.name,
      ENTITY.name,
      LOCATION.name,
      STATUS.name,
      BODY_STATE.name,
      RELATIONS.name,
      BELIEFS.name,
    ],
    writes: [BELIEFS.name],
    run(ctx) {
      const truth = ctx.truth;
      const me = truth.get(PERSON, o.player);
      const at = truth.get(LOCATION, o.player);
      if (!me || !at || truth.get(ENTITY, o.player)?.endedAt !== undefined) return {};
      const observers: Observer[] = [];
      for (const id of truth.ids(PERSON) as AgentId[]) {
        if (id === o.player || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const p = truth.get(PERSON, id);
        const there = truth.get(LOCATION, id);
        if (!p || !there || there.hex !== at.hex) continue;
        const activity = truth.get(BODY_STATE, id)?.activity;
        const attention =
          activity === "sleep"
            ? ATTENTION.asleep
            : activity === "heavy" || activity === "moderate"
              ? ATTENTION.absorbed
              : ATTENTION.relaxed;
        const dims = relationship(truth.get(RELATIONS, id), o.player, ctx.now, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: () => 0,
        }).dims;
        observers.push({
          id,
          at: there,
          acuity: sensorAcuity((ctx.now - p.born) / o.clock.year),
          attention,
          familiar: new Map([[o.player, Math.max(KNOWN_VILLAGER, dims.familiarity)]]),
        });
      }
      if (observers.length === 0) return {};
      const percepts = perceive(
        presenceStimulus({
          id: o.player,
          at,
          look: {
            sex: me.sex,
            ageYears: (ctx.now - me.born) / o.clock.year,
            ...attireLook(truth.get(STATUS, o.player), o.statuses),
          },
          tick: ctx.now,
        }),
        observers,
        {
          graph: o.spaces,
          forest: o.map.forest,
          daylight: skyLight(o.map, o.clock, o.seed, ctx.now),
        },
        ctx.rng,
      );
      const changes: StateChange[] = [];
      for (const pc of percepts) {
        const who = pc.fields.identity;
        if (pc.detail !== "identified" || who === undefined || who.value !== o.player) continue;
        const source = { kind: "percept", percept: pc.id, tick: pc.tick } as const;
        const evidence = (attr: "at" | "alive", value: boolean | typeof at) => ({
          prop: { kind: "attr", subject: o.player, attr } as const,
          value,
          confidence: who.confidence,
          asOf: pc.tick,
          source,
        });
        const seenAt = learn(truth.get(BELIEFS, pc.observer), evidence("at", at), ctx.now);
        changes.push(
          setComponent(BELIEFS, pc.observer, learn(seenAt, evidence("alive", true), ctx.now)),
        );
      }
      return changes.length === 0 ? {} : { changes };
    },
  };
}
