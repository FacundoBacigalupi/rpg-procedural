// Rastros en el camino (travel §3, perception: huellas, npc-b2b4b): quien viaja deja señales físicas
// en los hexes que pisa (`NPC_TRAIL`: dónde estuvo y cuántas horas) y quien pasa después por el mismo
// hex puede notarlas. Lo que nota es una creencia (`NPC_TRACES`): qué cree haber visto (huellas, restos
// de fogata) y hace cuánto, con error; nunca de quién. Una sola mirada por rastro y viajero. Se nota
// con una tirada con rng propio. Opt-in (`LifeParts.npcTraces`, con `npcEncounters`).

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  deleteComponent,
  ENTITY,
  type EventDraft,
  LOCATION,
  type ProcessDef,
  type ReadonlyWorldTruth,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const NPC_TRACES_PROCESS = "life.npc_traces";
export const TRACE_SEEN_EVENT = "npc.trace_seen";

export type TraceKind = "footprints" | "campfire";

/** Por dónde anduvo: una entrada por tramo continuo en un hex. */
export interface TrailStep {
  readonly hex: number;
  /** Cuándo llegó y cuándo se lo vio por última vez ahí (segundos de mundo). */
  readonly from: number;
  readonly last: number;
}
export const NPC_TRAIL = table<{ readonly steps: readonly TrailStep[] }>("life.npc_trail");

/** Lo que el viajero cree haber visto: sin quién, con la edad estimada (no la real). */
export interface BelievedTrace {
  readonly hex: number;
  readonly kind: TraceKind;
  readonly estAgeHours: number;
  readonly at: number;
}
export const NPC_TRACES = table<{
  readonly since: number;
  /** Rastros ya mirados (`hex:from`), notados o no. */
  readonly looked: readonly string[];
  readonly seen: readonly BelievedTrace[];
}>("life.npc_traces");

/** Cuánto dura un rastro en el camino. */
export const TRAIL_KEEP_HOURS = 72;
/** Horas seguidas en un hex para que cuente como campamento (resto de fogata). */
export const CAMP_HOURS = 5;
/** Chance de notar un rastro al pasar. */
export const NOTICE_CHANCE = 0.5;
/** Error relativo (desvío estándar) de la edad estimada. */
export const AGE_SD = 0.3;
/** Tope de rastros que guarda y de miradas que recuerda por viaje. */
export const MAX_SEEN = 8;
export const MAX_LOOKED = 32;
/** Rastros mirados por pasada. */
export const MAX_NOTICED_PER_PASS = 2;

const HOUR = 3600;

export function traceKind(step: TrailStep): TraceKind {
  return step.last - step.from >= CAMP_HOURS * HOUR ? "campfire" : "footprints";
}

export interface NpcTracesOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function npcTracesProcess(o: NpcTracesOptions): ProcessDef {
  return {
    id: NPC_TRACES_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [ENTITY.name, LOCATION.name, NPC_JOURNEY.name, NPC_TRAIL.name, NPC_TRACES.name],
    writes: [NPC_TRAIL.name, NPC_TRACES.name],
    scopeGuard: (truth, scope) =>
      truth.get(NPC_JOURNEY, scope as AgentId) !== undefined ||
      truth.get(NPC_TRAIL, scope as AgentId) !== undefined ||
      truth.get(NPC_TRACES, scope as AgentId) !== undefined,
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const now = ctx.now;
      const trip = truth.get(NPC_JOURNEY, me);
      const here = truth.get(LOCATION, me)?.hex;
      const changes = [];
      const events: EventDraft[] = [];

      // Lo que deja: el tramo en este hex; lo viejo se olvida.
      const old = truth.get(NPC_TRAIL, me)?.steps ?? [];
      let steps = old.filter((s) => now - s.last <= TRAIL_KEEP_HOURS * HOUR);
      if (trip && here !== undefined) {
        const tail = steps[steps.length - 1];
        steps =
          tail && tail.hex === here
            ? [...steps.slice(0, -1), { ...tail, last: now }]
            : [...steps, { hex: here, from: now, last: now }];
      }
      if (steps.length !== old.length || steps.some((s, i) => s !== old[i])) {
        changes.push(
          steps.length > 0
            ? setComponent(NPC_TRAIL, me, { steps })
            : deleteComponent(NPC_TRAIL, me),
        );
      }

      // Lo que nota: rastros de otros en este hex, ya sin ellos.
      const book = truth.get(NPC_TRACES, me);
      if (!trip) {
        if (book) changes.push(deleteComponent(NPC_TRACES, me));
      } else if (here !== undefined) {
        const fresh = book !== undefined && book.since === trip.since;
        const looked = new Set(fresh ? book.looked : []);
        const seen = [...(fresh ? book.seen : [])];
        const candidates: { key: string; step: TrailStep }[] = [];
        for (const other of truth.ids(NPC_TRAIL) as AgentId[]) {
          if (other === me || truth.get(LOCATION, other)?.hex === here) continue;
          for (const s of truth.get(NPC_TRAIL, other)?.steps ?? []) {
            const key = `${s.hex}:${s.from}`;
            if (s.hex === here && now - s.last >= 2 * HOUR && !looked.has(key)) {
              candidates.push({ key, step: s });
            }
          }
        }
        candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        for (const { key, step } of candidates.slice(0, MAX_NOTICED_PER_PASS)) {
          looked.add(key);
          const roll = ctx.rng.fork("trace", me, key);
          if (roll.float() >= NOTICE_CHANCE) continue;
          const realHours = (now - step.last) / HOUR;
          const estAgeHours = Math.max(1, Math.round(realHours * (1 + roll.normal(0, AGE_SD))));
          const kind = traceKind(step);
          seen.push({ hex: here, kind, estAgeHours, at: now });
          events.push({
            kind: TRACE_SEEN_EVENT,
            actors: [me],
            place: o.placeOf(truth, me),
            data: { hex: here, trace: kind, estAgeHours },
            emissions: {},
            causes: [{ kind: "state", entity: me, key: "location" }],
          });
        }
        if (candidates.length > 0 || (book && !fresh)) {
          changes.push(
            setComponent(NPC_TRACES, me, {
              since: trip.since,
              looked: [...looked].sort().slice(-MAX_LOOKED),
              seen: seen.slice(-MAX_SEEN),
            }),
          );
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}
