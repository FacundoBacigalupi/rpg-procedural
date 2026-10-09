// Intrusión despierta (npc-psychology §11): quien tiene una condición (trauma, culpa) y se topa con su
// disparador —la persona que la causó o el lugar donde pasó— puede recibir el recuerdo de golpe. Cada
// hora, a quien está despierto con alguien (o en el sitio) que dispara una condición, una tirada con
// `intrusionChance` (escalada por hora) reactiva las memorias de lo que la abrió: las refuerza (recall)
// y deja el evento `mind.intrusion` con esas causas. El azar sale de un rng con clave (id, hora).

import { type AgentId, type PlaceRef, Rng, type Seed } from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  type EventDraft,
  intrusionChance,
  intrusionEvents,
  LOCATION,
  MEMORIES,
  MENTAL,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  recall,
  type StateChange,
  setComponent,
  triggeredBy,
} from "../../sim/index.ts";

export const INTRUSION_PROCESS = "life.intrusion";
/** Qué parte de la chance de intrusión cae en una hora de estar frente al disparador. */
export const INTRUSION_HOURLY = 0.12;

export interface IntrusionOptions {
  readonly seed: Seed;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function intrusionProcess(o: IntrusionOptions): ProcessDef {
  return {
    id: INTRUSION_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, LOCATION.name, MENTAL.name, MEMORIES.name, BODY_STATE.name],
    writes: [MEMORIES.name],
    run(ctx) {
      const truth = ctx.truth;
      const awake = (id: AgentId) => {
        if (truth.get(ENTITY, id)?.endedAt !== undefined || !truth.get(PERSON, id)) return false;
        const body = truth.get(BODY_STATE, id);
        return (
          !!body &&
          body.death === null &&
          body.activity !== "sleep" &&
          body.consciousness !== "unconscious"
        );
      };
      const spots = new Map<string, AgentId[]>();
      for (const id of truth.ids(PERSON) as AgentId[]) {
        if (!awake(id)) continue;
        const at = truth.get(LOCATION, id);
        if (!at) continue;
        const key = `${at.hex}|${at.space ?? ""}`;
        spots.set(key, [...(spots.get(key) ?? []), id]);
      }
      const hour = Math.floor(ctx.now / 3600);
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const group of spots.values()) {
        for (const me of group) {
          const mental = truth.get(MENTAL, me);
          if (!mental || mental.conditions.length === 0) continue;
          const memories = truth.get(MEMORIES, me);
          if (!memories) continue;
          const place = o.placeOf(truth, me);
          // Cada presencia (y el lugar) es un estímulo; la primera que pega trae el recuerdo.
          const cues = [...group.filter((x) => x !== me).map((who) => ({ who })), { place }];
          for (const cue of cues) {
            const chance = intrusionChance(mental, cue) * INTRUSION_HOURLY;
            if (chance <= 0) continue;
            const key = "who" in cue ? cue.who : "place";
            if (Rng.root(o.seed).fork("intrusion", me, hour, key).float() >= chance) continue;
            const origins = intrusionEvents(mental, cue);
            const woken = new Set(origins);
            changes.push(
              setComponent(MEMORIES, me, {
                ...memories,
                items: memories.items.map((m) => (woken.has(m.eventId) ? recall(m, ctx.now) : m)),
              }),
            );
            events.push({
              kind: "mind.intrusion",
              actors: [me],
              place,
              data: { kinds: triggeredBy(mental, cue).map((c) => c.kind) },
              emissions: {},
              causes: origins.map((ev) => ({ kind: "event", event: ev }) as const),
            });
            break;
          }
        }
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
