// Interrupciones del plan del NPC (actions §6, player-loop §6 aplicado a los NPC, npc-e): un signo
// grave del cuerpo que antes no sentía (sangra, se le rompe un hueso, se muere de hambre o de
// sed…) corta el plan en curso, incluidos el viaje y las plantillas, y deja un resultado parcial
// coherente en el evento: qué plan era, qué pasos alcanzó a hacer, cuál lo agarró a medias y, si
// viajaba, a dónde iba. Después manda la rutina (come, descansa). Opt-in (`LifeParts.npcInterrupt`).

import type { AgentId, PlaceRef } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  deleteComponent,
  ENTITY,
  type EventDraft,
  nodeAt,
  type ProcessDef,
  type ReadonlyWorldTruth,
  setComponent,
  table,
} from "../../sim/index.ts";
import { PLAN_STATE } from "./act.ts";
import { alarmingSignsOf } from "./alarms.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const NPC_INTERRUPT_PROCESS = "life.npc_interrupt";
export const INTERRUPTED_EVENT = "npc.interrupted";

/** Los signos graves que ya sentía, para que solo lo nuevo lo interrumpa. */
export const NPC_ALARMS = table<{ readonly signs: readonly string[] }>("life.npc_alarms");

export interface NpcInterruptOptions {
  readonly player: AgentId;
  readonly plans: readonly BodyPlanDef[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
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
    reads: [BODY_STATE.name, PLAN_STATE.name, ENTITY.name, NPC_ALARMS.name, NPC_JOURNEY.name],
    writes: [PLAN_STATE.name, NPC_ALARMS.name, NPC_JOURNEY.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      const body = truth.get(BODY_STATE, me);
      const plan = body && plans.get(body.plan);
      if (!body || !plan) return {};
      const now = alarmingSignsOf(plan, body);
      const known = new Set(truth.get(NPC_ALARMS, me)?.signs ?? []);
      const fresh = [...now].filter((s) => !known.has(s)).sort();
      const same = known.size === now.size && fresh.length === 0;
      const book = same
        ? []
        : now.size === 0
          ? [deleteComponent(NPC_ALARMS, me)]
          : [setComponent(NPC_ALARMS, me, { signs: [...now].sort() })];
      const going = truth.get(PLAN_STATE, me);
      if (fresh.length === 0 || !going || going.done)
        return book.length > 0 ? { changes: book } : {};

      // Un resultado parcial: lo hecho, lo que la agarró a medias y adónde iba.
      const trip = truth.get(NPC_JOURNEY, me);
      const cut = going.cursor.path ? nodeAt(going.plan.root, going.cursor.path) : undefined;
      const event: EventDraft = {
        kind: INTERRUPTED_EVENT,
        actors: [me],
        place: o.placeOf(truth, me),
        data: {
          why: "body_alarm",
          signs: fresh,
          plan: going.plan.goal ?? (cut && cut.kind === "do" ? cut.verb : "plan"),
          done: going.steps.map((s) => s.verb),
          cut: cut && cut.kind === "do" ? cut.verb : null,
          ...(trip ? { journey: trip.place } : {}),
        },
        emissions: {},
        causes: [{ kind: "state", entity: me, key: "body" }],
      };
      return {
        changes: [
          ...book,
          setComponent(PLAN_STATE, me, { ...going, done: true }),
          ...(trip ? [deleteComponent(NPC_JOURNEY, me)] : []),
        ],
        events: [event],
      };
    },
  };
}
