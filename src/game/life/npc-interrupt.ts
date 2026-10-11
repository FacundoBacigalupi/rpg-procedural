// Interrupciones del plan del NPC (actions §6, player-loop §6 aplicado a los NPC, npc-e): lo que
// corta un plan en curso, incluidos el viaje y las plantillas, y deja un resultado parcial
// coherente en el evento: qué plan era, qué pasos alcanzó a hacer, cuál lo agarró a medias y, si
// viajaba, a dónde iba. Dos causas, las mismas que cortan el turno del personaje:
// - un signo grave del cuerpo que antes no sentía (sangra, hueso roto, hambre o sed graves…);
// - lo que otro le hace o le dice en persona: un golpe que lo alcanza o alguien que le habla.
// Después manda la rutina (come, descansa) y la utilidad (evitar, vengarse). Opt-in
// (`LifeParts.npcInterrupt`).

import type { AgentId, EventId, PlaceRef, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  deleteComponent,
  ENTITY,
  type EventDraft,
  LOCATION,
  type LocalMap,
  nodeAt,
  type ProcessDef,
  type ReadonlyWorldTruth,
  setComponent,
  table,
} from "../../sim/index.ts";
import { PLAN_STATE } from "./act.ts";
import { alarmingSignsOf } from "./alarms.ts";
import { NPC_JOURNEY, NPC_PAUSED } from "./npc-verbs.ts";
import { advanceTransit, TRANSIT } from "./transit.ts";

export const NPC_INTERRUPT_PROCESS = "life.npc_interrupt";
export const NPC_REACT_PROCESS = "life.npc_react";
export const INTERRUPTED_EVENT = "npc.interrupted";

/** Lo que ya sentía y el último evento ajeno que ya atendió, para que solo lo nuevo lo interrumpa. */
export const NPC_ALARMS = table<{
  readonly signs: readonly string[];
  readonly seen?: EventId;
}>("life.npc_alarms");

/** Lo último que otro le hizo o le dijo en persona, a la espera de que el proceso horario lo atienda. */
export interface NpcReaction {
  readonly kind: "attacked" | "spoken_to";
  readonly event: EventId;
  readonly who: AgentId;
  readonly at: Tick;
}
export const NPC_REACT = table<NpcReaction>("life.npc_react");

/** Una reacción más vieja que esto (segundos) ya no corta un plan nuevo. */
export const REACTION_WINDOW = 2 * 3600;

export interface NpcReactOptions {
  readonly player: AgentId;
}

/**
 * Anota qué le hicieron o le dijeron a cada NPC en el paso: un golpe (`action.strike`) o una frase
 * (`action.speak`) de otro donde él es parte. Un golpe vale más que una frase. Solo anota; el corte
 * lo decide `life.npc_interrupt`, que escribe el plan (dos procesos de la misma fase no comparten
 * escritura).
 */
export function npcReactProcess(o: NpcReactOptions): ProcessDef {
  return {
    id: NPC_REACT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [ENTITY.name, NPC_REACT.name],
    writes: [NPC_REACT.name],
    run(ctx) {
      const best = new Map<AgentId, NpcReaction>();
      for (const e of ctx.recent) {
        const kind =
          e.kind === "action.strike" ? "attacked" : e.kind === "action.speak" ? "spoken_to" : null;
        const from = e.actors[0];
        if (!kind || !from?.startsWith("agent:")) continue;
        for (const a of e.actors.slice(1)) {
          if (!a.startsWith("agent:") || a === o.player || a === from) continue;
          const me = a as AgentId;
          if (ctx.truth.get(ENTITY, me)?.endedAt !== undefined) continue;
          const old = best.get(me);
          if (old?.kind === "attacked" && kind === "spoken_to") continue;
          best.set(me, { kind, event: e.id, who: from as AgentId, at: e.tick });
        }
      }
      const changes = [...best.entries()]
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([me, r]) => setComponent(NPC_REACT, me, r));
      return changes.length > 0 ? { changes } : {};
    },
  };
}

export interface NpcInterruptOptions {
  readonly player: AgentId;
  readonly plans: readonly BodyPlanDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Con `life.transit` encendido: el viaje cortado deja al cuerpo en el hex intermedio que le toca. */
  readonly map?: LocalMap;
}

export function npcInterruptProcess(o: NpcInterruptOptions): ProcessDef {
  const plans = new Map(o.plans.map((p) => [p.id, p]));
  return {
    id: NPC_INTERRUPT_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [
      BODY_STATE.name,
      PLAN_STATE.name,
      ENTITY.name,
      NPC_ALARMS.name,
      NPC_JOURNEY.name,
      NPC_REACT.name,
      ...(o.map ? [LOCATION.name, TRANSIT.name] : []),
    ],
    writes: [
      PLAN_STATE.name,
      NPC_ALARMS.name,
      NPC_JOURNEY.name,
      NPC_PAUSED.name,
      ...(o.map ? [LOCATION.name, TRANSIT.name] : []),
    ],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const body = truth.get(BODY_STATE, me);
      const plan = body && plans.get(body.plan);
      if (!body || !plan) return {};
      const now = alarmingSignsOf(plan, body);
      const prev = truth.get(NPC_ALARMS, me);
      const known = new Set(prev?.signs ?? []);
      const fresh = [...now].filter((s) => !known.has(s)).sort();
      // Lo que otro le hizo desde la última vez y todavía vale (no un plan viejo con una frase vieja).
      const react = truth.get(NPC_REACT, me);
      const heard =
        react && react.event !== prev?.seen && ctx.now - react.at <= REACTION_WINDOW
          ? react
          : undefined;
      const seen = heard?.event ?? prev?.seen;
      const same = known.size === now.size && fresh.length === 0 && seen === prev?.seen;
      const book = same
        ? []
        : now.size === 0 && seen === undefined
          ? [deleteComponent(NPC_ALARMS, me)]
          : [
              setComponent(NPC_ALARMS, me, {
                signs: [...now].sort(),
                ...(seen === undefined ? {} : { seen }),
              }),
            ];
      const going = truth.get(PLAN_STATE, me);
      if ((fresh.length === 0 && !heard) || !going || going.done)
        return book.length > 0 ? { changes: book } : {};

      // Un resultado parcial: lo hecho, lo que la agarró a medias y adónde iba.
      const trip = truth.get(NPC_JOURNEY, me);
      const cut = going.cursor.path ? nodeAt(going.plan.root, going.cursor.path) : undefined;
      const event: EventDraft = {
        kind: INTERRUPTED_EVENT,
        actors: heard ? [me, heard.who] : [me],
        place: o.placeOf(truth, me),
        data: {
          why: heard ? heard.kind : "body_alarm",
          ...(fresh.length > 0 ? { signs: fresh } : {}),
          plan: going.plan.goal ?? (cut && cut.kind === "do" ? cut.verb : "plan"),
          done: going.steps.map((s) => s.verb),
          cut: cut && cut.kind === "do" ? cut.verb : null,
          ...(trip ? { journey: trip.place } : {}),
        },
        emissions: {},
        causes: heard
          ? [{ kind: "event", event: heard.event }]
          : [{ kind: "state", entity: me, key: "body" }],
      };
      // El cuerpo queda donde le tocaba estar a medio camino, no en el destino que `life.act` ya fijó.
      const here = truth.get(LOCATION, me);
      const walked =
        trip && o.map && here
          ? advanceTransit(
              o.map,
              truth.get(TRANSIT, me) ??
                (trip.from !== undefined
                  ? { seen: trip.from, at: trip.since }
                  : { seen: here.hex, at: ctx.now }),
              here.hex,
              ctx.now,
            )
          : undefined;
      return {
        changes: [
          ...book,
          setComponent(PLAN_STATE, me, { ...going, done: true }),
          // Lo cortado queda a mano para retomarlo (`NpcVerbsOptions.resume`).
          setComponent(NPC_PAUSED, me, {
            plan: going.plan,
            cursor: going.cursor,
            steps: going.steps,
            ...(going.resume ? { resume: true } : {}),
            ...(trip ? { journey: trip } : {}),
            at: ctx.now,
            why: heard ? heard.kind : "body_alarm",
          }),
          ...(trip ? [deleteComponent(NPC_JOURNEY, me)] : []),
          ...(walked
            ? [
                ...(walked.pos === here?.hex
                  ? []
                  : [setComponent(LOCATION, me, { hex: walked.pos })]),
                setComponent(TRANSIT, me, { seen: walked.pos, at: ctx.now }),
              ]
            : []),
        ],
        events: [event],
      };
    },
  };
}
