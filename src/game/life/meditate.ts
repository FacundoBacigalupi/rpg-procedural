// Meditar (novel-cult-meditate, cultivation §4): cada `action.meditate` suma a la sensibilidad al qi
// de quien meditó según su talento, su calma (el dolor y el hambre la bajan) y el qi de la aldea; la
// primera vez que cruza el umbral nace `cultivation.sensed_qi`, causado por esa meditación y por el
// talento. Sin raíz la sensibilidad no se mueve y solo quedan las horas: se narra que no pasa nada.
// Solo con el cultivo encendido (la ley en la verdad).

import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  aptitudeOf,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  type CultivationState,
  type EventDraft,
  meditationGain,
  needsFrom,
  PLACE_QI,
  type ProcessDef,
  qiFactor,
  SENSE_THRESHOLD,
  SENSED_QI_EVENT,
  type StateChange,
  setComponent,
  TALENT,
} from "../../sim/index.ts";

export const MEDITATE_PROCESS = "life.cultivation.meditate";

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Quién meditó y cuántas horas, de un `action.meditate`. */
export function meditation(e: Event): { who: AgentId; hours: number } | undefined {
  if (e.kind !== "action.meditate") return undefined;
  const who = e.actors[0] as AgentId | undefined;
  const seconds = (e.data as { seconds?: unknown } | null)?.seconds;
  if (!who || typeof seconds !== "number" || seconds <= 0) return undefined;
  return { who, hours: seconds / 3600 };
}

/** La calma para meditar: el dolor la corta, el hambre y la sed la distraen. */
function calmOf(plans: ReadonlyMap<string, BodyPlanDef>, b: Body | undefined): number {
  const plan = b ? plans.get(b.plan) : undefined;
  if (!b || !plan) return 1;
  const n = needsFrom(plan, b);
  const distraction = Math.max(n.hunger ?? 0, n.thirst ?? 0);
  return Math.max(0, 1 - (n.pain ?? 0) - 0.3 * distraction);
}

export function meditateProcess(o: { readonly bodyPlans: readonly BodyPlanDef[] }): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: MEDITATE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      CULTIVATION_LAW.name,
      PLACE_QI.name,
      TALENT.name,
      BODY_STATE.name,
      CULTIVATION_STATE.name,
    ],
    writes: [CULTIVATION_STATE.name],
    run(ctx) {
      const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
      const law = plane ? ctx.truth.get(CULTIVATION_LAW, plane) : undefined;
      if (!plane || !law) return {};
      const factor = qiFactor(ctx.truth.get(PLACE_QI, plane));
      const rows = new Map<AgentId, CultivationState>();
      const events: EventDraft[] = [];
      for (const e of ctx.recent) {
        const m = meditation(e);
        if (!m) continue;
        const talent = ctx.truth.get(TALENT, m.who);
        if (!talent) continue;
        const apt = aptitudeOf(law, talent.innate);
        const before = rows.get(m.who) ??
          ctx.truth.get(CULTIVATION_STATE, m.who) ?? { sensitivity: 0, hours: 0 };
        const gain = meditationGain(
          apt,
          m.hours,
          calmOf(plans, ctx.truth.get(BODY_STATE, m.who)),
          factor,
        );
        let next: CultivationState = {
          ...before,
          sensitivity: round4(before.sensitivity + gain),
          hours: round4(before.hours + m.hours),
        };
        if (!before.sensed && next.sensitivity >= SENSE_THRESHOLD) {
          // La fila guarda la meditación que lo dio; el evento nuevo la nombra como causa.
          next = { ...next, sensed: { at: e.tick, event: e.id as EventId } };
          events.push({
            kind: SENSED_QI_EVENT,
            actors: [m.who],
            place: e.place,
            data: { sensitivity: next.sensitivity, hours: next.hours },
            emissions: {},
            causes: [
              { kind: "event", event: e.id },
              { kind: "state", entity: m.who, key: TALENT.name },
            ],
          });
        }
        rows.set(m.who, next);
      }
      const changes: StateChange[] = [...rows].map(([id, row]) =>
        setComponent(CULTIVATION_STATE, id, row),
      );
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
