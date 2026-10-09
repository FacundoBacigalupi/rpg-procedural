// Qué cree cada uno de la posición de los presentes (social-structure §3, perception §6). Cada
// hora (los vecinos entre sí, cada pocas), quien comparte hex con otro lo mira: lo que lee de la
// ropa sale de la claridad con que lo vio (luz, distancia, atención: `perceive`) y quien lo
// conoce de antes (familiaridad de `RELATIONS`) sabe su lugar. La lectura queda en
// `STANDING_BELIEFS` del observador; el `STATUS` real no se consulta para tratar a nadie. Una
// creencia nueva o que cambia de escalón deja un evento `social.standing_read` con causa.

import type { AgentId, PlaceRef, PlanetClock, Seed } from "../../core/index.ts";
import {
  ATTENTION,
  type Attire,
  attireLook,
  BODY_STATE,
  type BondDef,
  beliefAbout,
  type DimensionDef,
  draftEvent,
  ENTITY,
  type EventDraft,
  LOCATION,
  type LocalMap,
  type Observer,
  PERSON,
  type ProcessDef,
  perceive,
  presenceStimulus,
  RELATIONS,
  type ReadonlyWorldTruth,
  rankOf,
  readStanding,
  relationship,
  type SpaceGraph,
  STANDING_BELIEFS,
  STATUS,
  type StandingBeliefs,
  type StateChange,
  type StatusDef,
  sensorAcuity,
  setComponent,
  skyLight,
  updateBeliefs,
} from "../../sim/index.ts";
import { playerObserver } from "./witness.ts";

export const STANDING_PROCESS = "life.standing";

export interface StandingOptions {
  readonly player: AgentId;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly statuses: readonly StatusDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Familiaridad desde la que alguien sabe el lugar de otro sin deducirlo de la ropa. */
export const ACQUAINTED_AT = 0.5;
/** Entre vecinos de la aldea, la familiaridad de piso (todos se conocen). */
const VILLAGER_FAMILIARITY = 0.6;
/** Cada cuántas horas los vecinos se leen entre sí. */
const NPC_PASS_HOURS = 12;
/** Cuánto tiene que moverse el rango creído para dejar un evento nuevo. */
const REREAD_STEP = 0.5;

export function standingProcess(o: StandingOptions): ProcessDef {
  return {
    id: STANDING_PROCESS,
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
      STANDING_BELIEFS.name,
    ],
    writes: [STANDING_BELIEFS.name],
    run(ctx) {
      const truth = ctx.truth;
      const byHex = new Map<number, AgentId[]>();
      for (const id of truth.ids(PERSON) as AgentId[]) {
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const there = truth.get(LOCATION, id);
        if (!truth.get(PERSON, id) || !there) continue;
        const list = byHex.get(there.hex) ?? [];
        list.push(id);
        byHex.set(there.hex, list);
      }
      const npcPass = Math.floor(ctx.now / 3_600) % NPC_PASS_HOURS === 0;
      const staged = new Map<AgentId, StandingBeliefs | undefined>();
      const beliefsOf = (id: AgentId) =>
        staged.has(id) ? staged.get(id) : truth.get(STANDING_BELIEFS, id);
      const events: EventDraft[] = [];
      const medium = {
        graph: o.spaces,
        forest: o.map.forest,
        daylight: skyLight(o.map, o.clock, o.seed, ctx.now),
      };
      for (const hex of [...byHex.keys()].sort((x, y) => x - y)) {
        const here = byHex.get(hex) ?? [];
        if (here.length < 2) continue;
        for (const subject of here) {
          const me = truth.get(PERSON, subject);
          const at = truth.get(LOCATION, subject);
          if (!me || !at) continue;
          const familiarOf = new Map<AgentId, number>();
          const observers: Observer[] = [];
          for (const id of here) {
            if (id === subject) continue;
            if (!npcPass && subject !== o.player && id !== o.player) continue;
            // Lo que el observador siente por el sujeto: la relación guardada, con el piso de
            // vecino entre gente de la aldea.
            const stored = relationship(truth.get(RELATIONS, id), subject, ctx.now, {
              dims: o.dims,
              bonds: o.bonds,
              schemaStrength: () => 0,
            }).dims.familiarity;
            const familiarity =
              id === o.player || subject === o.player
                ? stored
                : Math.max(VILLAGER_FAMILIARITY, stored);
            familiarOf.set(id, familiarity);
            if (id === o.player) {
              const mine = playerObserver(
                { truth, player: o.player, clock: o.clock },
                ATTENTION.relaxed,
                ctx.now,
              );
              observers.push({
                ...mine,
                familiar: new Map([[subject, Math.max(mine.familiar.get(subject) ?? 0, stored)]]),
              });
              continue;
            }
            const p = truth.get(PERSON, id);
            const there = truth.get(LOCATION, id);
            if (!p || !there) continue;
            const activity = truth.get(BODY_STATE, id)?.activity;
            observers.push({
              id,
              at: there,
              acuity: sensorAcuity((ctx.now - p.born) / o.clock.year),
              attention:
                activity === "sleep"
                  ? ATTENTION.asleep
                  : activity === "heavy" || activity === "moderate"
                    ? ATTENTION.absorbed
                    : ATTENTION.relaxed,
              familiar: new Map([[subject, familiarity]]),
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
            ctx.rng.fork("see", subject),
          );
          const trueRank = rankOf(truth.get(STATUS, subject), o.statuses);
          for (const pc of percepts) {
            const attire = pc.fields.attire;
            const who = pc.fields.identity;
            const recognized = pc.detail === "identified" && who?.value === subject;
            const acquainted = recognized && (familiarOf.get(pc.observer) ?? 0) >= ACQUAINTED_AT;
            const seenAttire =
              typeof attire?.value === "string" ? (attire.value as Attire) : undefined;
            if (!acquainted && seenAttire === undefined) continue;
            const reading = readStanding(
              {
                ...(seenAttire === undefined ? {} : { attire: seenAttire }),
                clarity: attire?.confidence ?? who?.confidence ?? 0,
                acquainted,
              },
              trueRank,
              o.statuses,
              ctx.rng.fork("read", pc.observer, subject),
            );
            if (!reading) continue;
            const prev = beliefsOf(pc.observer);
            const old = beliefAbout(prev, subject);
            const fresh =
              !old ||
              old.basis !== reading.basis ||
              Math.abs(old.rank - reading.rank) >= REREAD_STEP;
            let origin = old?.originEventId;
            if (fresh) {
              origin = draftEvent(events.length);
              events.push({
                kind: "social.standing_read",
                actors: [pc.observer, subject],
                place: o.placeOf(truth, subject),
                data: { rank: reading.rank, basis: reading.basis, confidence: reading.confidence },
                emissions: {},
                causes: [{ kind: "state", entity: subject, key: STATUS.name }],
              });
            }
            if (origin === undefined) continue;
            staged.set(pc.observer, updateBeliefs(prev, subject, reading, ctx.now, origin));
          }
        }
      }
      const changes: StateChange[] = [];
      for (const id of [...staged.keys()].sort()) {
        const b = staged.get(id);
        if (b) changes.push(setComponent(STANDING_BELIEFS, id, b));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
