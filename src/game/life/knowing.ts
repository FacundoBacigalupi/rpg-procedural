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
  MENTAL,
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
  vigilantAttention,
} from "../../sim/index.ts";
import { impressionEvidence } from "./impressions.ts";
import { PERCEPTS } from "./perceive.ts";
import { learnReads, PURPOSE_READS } from "./reading.ts";
import { playerObserver } from "./witness.ts";

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
/** Cada cuántas horas los vecinos se miran entre sí (el costo crece con el cuadrado de la gente). */
const NPC_PASS_HOURS = 12;

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
      MENTAL.name,
      PURPOSE_READS.name,
      PERCEPTS.name,
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
      const npcPass = Math.floor(ctx.now / 3_600) % NPC_PASS_HOURS === 0;
      // Lo que cada uno cree ya acumulado en esta pasada (un observador ve a varios sujetos).
      const staged = new Map<AgentId, Beliefs | undefined>();
      const beliefsOf = (id: AgentId) => (staged.has(id) ? staged.get(id) : truth.get(BELIEFS, id));
      const medium = {
        graph: o.spaces,
        forest: o.map.forest,
        daylight: skyLight(o.map, o.clock, o.seed, ctx.now),
      };
      const hexes = [...byHex.keys()].sort((x, y) => x - y);
      for (const hex of hexes) {
        const here = byHex.get(hex) ?? [];
        // El personaje también observa: lo que percibe de los presentes queda en sus propias
        // creencias (player-loop §9); la vista sigue mirando aparte hasta el próximo ítem.
        const watchers = here;
        if (watchers.length < 2) continue;
        for (const subject of here) {
          // Entre vecinos alcanza mirarse cada pocas horas; al personaje lo miran cada hora y él
          // mira a todos cada hora.
          const me = truth.get(PERSON, subject);
          const at = truth.get(LOCATION, subject);
          if (!me || !at) continue;
          const observers: Observer[] = [];
          for (const id of watchers) {
            if (id === subject) continue;
            if (!npcPass && subject !== o.player && id !== o.player) continue;
            if (id === o.player) {
              const mine = playerObserver(
                { truth, player: o.player, clock: o.clock },
                vigilantAttention(ATTENTION.relaxed, truth.get(MENTAL, id)),
                ctx.now,
              );
              observers.push({
                ...mine,
                familiar: new Map([
                  [subject, Math.max(KNOWN_VILLAGER, mine.familiar.get(subject) ?? 0)],
                ]),
              });
              continue;
            }
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
            // La relación solo se consulta por el personaje; entre vecinos rige el piso de conocidos.
            const familiarity =
              subject === o.player
                ? relationship(truth.get(RELATIONS, id), subject, ctx.now, {
                    dims: o.dims,
                    bonds: o.bonds,
                    schemaStrength: () => 0,
                  }).dims.familiarity
                : 0;
            observers.push({
              id,
              at: there,
              acuity: sensorAcuity((ctx.now - p.born) / o.clock.year),
              attention: vigilantAttention(attention, truth.get(MENTAL, id)),
              familiar: new Map([[subject, Math.max(KNOWN_VILLAGER, familiarity)]]),
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
            medium,
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
            let next = learn(seenAt, evidence("alive", true), ctx.now);
            // Cómo se lo vio (figura y ropa) también queda: la vista lo lee de ahí.
            for (const imp of impressionEvidence(subject, pc)) next = learn(next, imp, ctx.now);
            staged.set(pc.observer, next);
          }
        }
      }
      // Lo que vio hacer a alguien que reconoció (los percepts de acción de la última hora)
      // queda como impresión: qué hacía, y cómo se lo vio.
      const lastHour = ctx.now - 3_600;
      let acted = beliefsOf(o.player);
      for (const pc of truth.get(PERCEPTS, o.player)?.recent ?? []) {
        const who = pc.fields.identity?.value;
        if (pc.tick <= lastHour || pc.fields.action === undefined) continue;
        if (pc.detail !== "identified" || typeof who !== "string") continue;
        for (const imp of impressionEvidence(who as AgentId, pc))
          acted = learn(acted, imp, ctx.now);
      }
      if (acted !== beliefsOf(o.player)) staged.set(o.player, acted);
      // Lo que el personaje leyó del porqué ajeno se vuelve creencia sobre el actor.
      const reads = truth.get(PURPOSE_READS, o.player)?.recent ?? [];
      if (reads.length > 0) {
        const learned = learnReads(beliefsOf(o.player), reads, ctx.now);
        if (learned !== beliefsOf(o.player)) staged.set(o.player, learned);
      }
      for (const id of [...staged.keys()].sort()) {
        const b = staged.get(id);
        if (b) changes.push(setComponent(BELIEFS, id, b));
      }
      return changes.length === 0 ? {} : { changes };
    },
  };
}
