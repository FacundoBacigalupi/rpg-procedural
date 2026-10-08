// Qué cree cada vecino de los presentes (information §1, §10; Fase 2: «conocimiento vs verdad»). Cada
// hora, los vecinos que comparten el hex con alguien (el personaje o cualquier otro) lo perciben con sus sentidos
// (perception): si lo reconocen, guardan dónde lo vieron y que vive, con la confianza con que
// lo leyeron y la hora a la que se refiere. Cuando el personaje se va, ellos siguen creyendo que
// está ahí: la creencia envejece (la confianza decae por horas), no se corrige sola, y puede
// quedar falsa. Nadie lee la verdad para saber dónde está el personaje.

import type { AgentId, PlanetClock, Seed } from "../../core/index.ts";
import {
  ATTENTION,
  attireLook,
  BELIEFS,
  type Beliefs,
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
      // Quién está viva en qué hex (orden por id: determinista), con su ficha y su lugar.
      const byHex = new Map<number, AgentId[]>();
      for (const id of truth.ids(PERSON) as AgentId[]) {
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const there = truth.get(LOCATION, id);
        if (!truth.get(PERSON, id) || !there) continue;
        const list = byHex.get(there.hex) ?? [];
        list.push(id);
        byHex.set(there.hex, list);
      }
      const changes: StateChange[] = [];
      // Lo que cada uno cree ya acumulado en esta pasada (un observador ve a varios sujetos).
      const staged = new Map<AgentId, Beliefs | undefined>();
      const beliefsOf = (id: AgentId) => (staged.has(id) ? staged.get(id) : truth.get(BELIEFS, id));
      const hexes = [...byHex.keys()].sort((x, y) => x - y);
      for (const hex of hexes) {
        const here = byHex.get(hex) ?? [];
        // El personaje no observa: sus creencias salen de su propio ítem (jugador).
        const watchers = here.filter((id) => id !== o.player);
        if (watchers.length === 0) continue;
        for (const subject of here) {
          const me = truth.get(PERSON, subject);
          const at = truth.get(LOCATION, subject);
          if (!me || !at) continue;
          const observers: Observer[] = [];
          for (const id of watchers) {
            if (id === subject) continue;
            const p = truth.get(PERSON, id);
            const there = truth.get(LOCATION, id);
            if (!p || !there) continue;
            const activity = truth.get(BODY_STATE, id)?.activity;
            const attention =
              activity === "sleep"
                ? ATTENTION.asleep
                : activity === "heavy" || activity === "moderate"
                  ? ATTENTION.absorbed
                  : ATTENTION.relaxed;
            const dims = relationship(truth.get(RELATIONS, id), subject, ctx.now, {
              dims: o.dims,
              bonds: o.bonds,
              schemaStrength: () => 0,
            }).dims;
            observers.push({
              id,
              at: there,
              acuity: sensorAcuity((ctx.now - p.born) / o.clock.year),
              attention,
              familiar: new Map([[subject, Math.max(KNOWN_VILLAGER, dims.familiarity)]]),
            });
          }
          if (observers.length === 0) continue;
          const percepts = perceive(
            presenceStimulus({
              id: subject,
              at,
              look: {
                sex: me.sex,
                ageYears: (ctx.now - me.born) / o.clock.year,
                ...attireLook(truth.get(STATUS, subject), o.statuses),
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
          for (const pc of percepts) {
            const who = pc.fields.identity;
            if (pc.detail !== "identified" || who === undefined || who.value !== subject) continue;
            const source = { kind: "percept", percept: pc.id, tick: pc.tick } as const;
            const evidence = (attr: "at" | "alive", value: boolean | typeof at) => ({
              prop: { kind: "attr", subject, attr } as const,
              value,
              confidence: who.confidence,
              asOf: pc.tick,
              source,
            });
            const seenAt = learn(beliefsOf(pc.observer), evidence("at", at), ctx.now);
            staged.set(pc.observer, learn(seenAt, evidence("alive", true), ctx.now));
          }
        }
      }
      for (const id of [...staged.keys()].sort()) {
        const b = staged.get(id);
        if (b) changes.push(setComponent(BELIEFS, id, b));
      }
      return changes.length === 0 ? {} : { changes };
    },
  };
}
