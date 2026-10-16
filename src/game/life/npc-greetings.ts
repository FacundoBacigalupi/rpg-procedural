// Saludar al cruzarse (travel §3, npc-b2b4c2): cuando dos personas que se cruzaron en el camino
// (`NPC_MET`) siguen en el mismo hex, se saludan con una chance; si se conocen algo, cruzan
// palabras en vez de un gesto. El saludo deja familiaridad (y un poco de afecto y confianza) a
// ambos lados de `RELATIONS`, con rendimiento decreciente. Quien arrastra rencor, miedo o
// aversión por el otro no saluda. Una vez por pareja y viaje (`NPC_GREETED`). Va en `physics`
// (como `newborn_bonds`, donde ningún otro proceso del viaje escribe `RELATIONS`) y salta la hora
// si hay un nacimiento por asentar, que es el otro escritor de esa fase. Opt-in
// (`LifeParts.npcGreetings`, con `npcEncounters`).

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  type BondDef,
  clampDim,
  contactGain,
  type DimensionDef,
  deleteComponent,
  ENTITY,
  type EventDraft,
  LOCATION,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relations,
  type Relationship,
  relationship,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { BIRTH, BONDED } from "./birth.ts";
import { NPC_MET } from "./npc-encounters.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const NPC_GREETINGS_PROCESS = "life.npc_greetings";
export const GREETED_EVENT = "npc.greeted";

/** A quién ya saludó en este viaje (el viaje se identifica por cuándo empezó). */
export const NPC_GREETED = table<{ readonly since: number; readonly greeted: readonly string[] }>(
  "life.npc_greeted",
);

/** Chance por hora de que la pareja se salude, si ninguno guarda rencor (sin calibrar). */
export const GREET_CHANCE = 0.7;
/** Lo que suma un saludo a cada parte (familiaridad con rendimiento decreciente; sin calibrar). */
export const GREET_FAMILIARITY = 0.015;
export const GREET_AFFECTION = 0.01;
export const GREET_TRUST = 0.005;
/** Desde esta familiaridad (de quien saluda) el saludo es de palabras, no un gesto. */
export const GREET_WORDS_FAMILIARITY = 0.2;
/** Si siente esto o más de rencor o miedo, o menos de esto de afecto, no saluda. */
export const GREET_REFUSE = { resentment: 0.5, fear: 0.6, affection: -0.3 } as const;
/** Tope de saludos por pasada (una plaza llena no inunda el registro). */
export const MAX_GREETINGS_PER_PASS = 4;

export interface NpcGreetingsOptions {
  readonly player: AgentId;
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const alive = (truth: ReadonlyWorldTruth, id: AgentId) =>
  truth.get(ENTITY, id)?.endedAt === undefined && truth.get(PERSON, id) !== undefined;

export function npcGreetingsProcess(o: NpcGreetingsOptions): ProcessDef {
  const ctxRel = { dims: o.dims, bonds: o.bonds, schemaStrength: () => 0 };
  return {
    id: NPC_GREETINGS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "physics",
    reads: [
      ENTITY.name,
      PERSON.name,
      LOCATION.name,
      NPC_JOURNEY.name,
      NPC_MET.name,
      NPC_GREETED.name,
      RELATIONS.name,
      BIRTH.name,
      BONDED.name,
    ],
    writes: [NPC_GREETED.name, RELATIONS.name],
    run(ctx) {
      const truth = ctx.truth;
      const changes: StateChange[] = [];
      // Quien ya no viaja deja su libreta de saludos.
      const booked = (truth.ids(NPC_GREETED) as AgentId[]).sort();
      for (const id of booked) {
        if (truth.get(NPC_JOURNEY, id) === undefined)
          changes.push(deleteComponent(NPC_GREETED, id));
      }
      const travelers = (truth.ids(NPC_MET) as AgentId[]).filter(
        (id) => id !== o.player && truth.get(NPC_JOURNEY, id) !== undefined,
      );
      if (travelers.length === 0) return changes.length === 0 ? {} : { changes };
      // Con un nacimiento por asentar, `newborn_bonds` escribe `RELATIONS` en este paso: se espera.
      const pendingBirth = (truth.ids(BIRTH) as AgentId[]).some(
        (m) => truth.get(BONDED, m)?.child !== truth.get(BIRTH, m)?.child,
      );
      if (pendingBirth) return changes.length === 0 ? {} : { changes };

      const rows = new Map<AgentId, Relations & { toward: Record<string, Relationship> }>();
      const books = new Map<AgentId, { since: number; greeted: Set<string> }>();
      const bookOf = (id: AgentId) => {
        let b = books.get(id);
        if (!b) {
          const trip = truth.get(NPC_JOURNEY, id);
          if (!trip) return undefined;
          const old = truth.get(NPC_GREETED, id);
          b = {
            since: trip.since,
            greeted: new Set(old && old.since === trip.since ? old.greeted : []),
          };
          books.set(id, b);
        }
        return b;
      };
      const feel = (from: AgentId, to: AgentId) =>
        relationship(rows.get(from) ?? truth.get(RELATIONS, from), to, ctx.now, ctxRel);
      const hostile = (r: Relationship) =>
        r.dims.resentment >= GREET_REFUSE.resentment ||
        r.dims.fear >= GREET_REFUSE.fear ||
        r.dims.affection <= GREET_REFUSE.affection;
      const warm = (from: AgentId, to: AgentId, r: Relationship) => {
        let row = rows.get(from);
        if (!row) {
          const base = truth.get(RELATIONS, from);
          const origin =
            base?.originEventId ??
            (truth.get(ENTITY, from)?.originEventId as Relations["originEventId"]);
          row = { originEventId: origin, toward: { ...(base?.toward ?? {}) } };
          rows.set(from, row);
        }
        const gain = contactGain(GREET_FAMILIARITY, r.dims.familiarity);
        row.toward[to] = {
          ...r,
          dims: {
            ...r.dims,
            familiarity: clampDim("familiarity", r.dims.familiarity + gain),
            affection: clampDim("affection", r.dims.affection + GREET_AFFECTION),
            trust: clampDim("trust", r.dims.trust + GREET_TRUST),
          },
          updated: ctx.now,
        };
      };
      const events: EventDraft[] = [];
      const done = new Set<string>();
      const dirty = new Set<AgentId>();
      for (const me of travelers.sort()) {
        const met = truth.get(NPC_MET, me);
        const trip = truth.get(NPC_JOURNEY, me);
        const here = truth.get(LOCATION, me)?.hex;
        if (!met || !trip || met.since !== trip.since || here === undefined || !alive(truth, me))
          continue;
        for (const other of met.met as AgentId[]) {
          if (events.length >= MAX_GREETINGS_PER_PASS) break;
          const key = me < other ? `${me}|${other}` : `${other}|${me}`;
          if (other === o.player || done.has(key) || !alive(truth, other)) continue;
          if (truth.get(LOCATION, other)?.hex !== here) continue;
          const mine = bookOf(me);
          const theirs = bookOf(other);
          if (mine?.greeted.has(other) || theirs?.greeted.has(me)) continue;
          done.add(key);
          const a = feel(me, other);
          const b = feel(other, me);
          const first = me < other ? me : other;
          const second = me < other ? other : me;
          if (hostile(a) || hostile(b)) continue;
          if (ctx.rng.fork("greet", first, second, ctx.now).float() >= GREET_CHANCE) continue;
          warm(me, other, a);
          warm(other, me, b);
          mine?.greeted.add(other);
          if (mine) dirty.add(me);
          if (theirs) dirty.add(other);
          theirs?.greeted.add(me);
          const words = Math.max(a.dims.familiarity, b.dims.familiarity) >= GREET_WORDS_FAMILIARITY;
          events.push({
            kind: GREETED_EVENT,
            actors: [me, other],
            place: o.placeOf(truth, me),
            data: { hex: here, form: words ? "words" : "gesture" },
            emissions: {},
            causes: [
              { kind: "state", entity: me, key: "life.npc_met" },
              { kind: "state", entity: other, key: "location" },
            ],
          });
        }
      }
      if (events.length === 0) return changes.length === 0 ? {} : { changes };
      for (const [id, r] of [...rows].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
        changes.push(setComponent(RELATIONS, id, r));
      }
      for (const [id, b] of [...books]
        .filter(([i]) => dirty.has(i))
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
        changes.push(
          setComponent(NPC_GREETED, id, { since: b.since, greeted: [...b.greeted].sort() }),
        );
      }
      return { changes, events };
    },
  };
}
