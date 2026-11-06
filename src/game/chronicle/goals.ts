// Las metas en la crónica (novel-goals-truth-chronicle, chronicle §4, player-loop §8): lo que el
// personaje se propuso, desde la verdad. Cada meta sale de su `GOAL_EVENT` nacida (con el
// `action.resolve` de origen y las palabras que usó) y termina en la siguiente terminada de la misma
// meta: la dejó, se murió queriéndola, o sigue. Las horas que le dio en los saltos son los
// `routine.for_goal`. «Creída lograda» (`achieved_believed`) es lo que el personaje cree haber
// cumplido, no lo que la verdad dice: la venganza (la persona murió y el personaje lo sabe) y cultivar
// (lo aceptó una secta: `cultivation.sect_joined`, que oyó en la plaza); las demás esperan a los
// sistemas que las cumplan.

import type { AgentId, Event, EventId, Tick } from "../../core/index.ts";
import { BELIEFS, believed, ENTITY, MEMORIES, SECT_JOINED_EVENT } from "../../sim/index.ts";
import { GOAL_EVENT, GOAL_HOUR_EVENT, type LifeWorld } from "../life/index.ts";

/** Cómo terminó una meta: la dejó, se murió con ella o seguía (la crónica de una vida en curso). */
export type GoalEnding = "dropped" | "died" | "open";

export interface ChronicleGoal {
  /** El id del objetivo en la verdad: `resolve:revenge:agent:7`. */
  readonly goal: string;
  readonly sketch: string;
  /** Las palabras con que se lo propuso («vengar a mi madre»). */
  readonly about: string;
  readonly whom?: AgentId;
  /** El acto de proponérselo (`action.resolve`). */
  readonly origin: EventId;
  readonly from: Tick;
  readonly ending: GoalEnding;
  /** El evento que la terminó, si terminó. */
  readonly endedBy?: EventId;
  readonly to?: Tick;
  /** Horas de días delegados que le dio (`routine.for_goal`). */
  readonly hours: number;
  /** Cuándo creyó haberla cumplido y por qué evento, si lo creyó. */
  readonly achievedBelieved?: { readonly at: Tick; readonly event: EventId };
}

interface GoalData {
  readonly goal?: unknown;
  readonly what?: unknown;
  readonly reason?: unknown;
  readonly target?: unknown;
}

const dataOf = (e: Event) => (e.data ?? {}) as GoalData;

/** Las palabras del acto de origen (`effect.about` del `action.resolve`). */
function aboutOf(e: Event | undefined): string | undefined {
  const about = (e?.data as { effect?: { about?: unknown } } | null)?.effect?.about;
  return typeof about === "string" ? about : undefined;
}

/**
 * Lo que `me` cree haber logrado de una meta hasta `until`. Venganza: la persona murió y el
 * personaje lo recuerda o cree que ya no vive; vale desde la muerte. Cultivar: una secta lo tomó
 * como discípulo (se lo dijeron en la cara); vale desde ese día.
 */
function achievedBelieved(
  w: LifeWorld,
  me: AgentId,
  sketch: string,
  whom: AgentId | undefined,
  until: Tick,
): { at: Tick; event: EventId } | undefined {
  if (sketch === "cultivate") {
    const joined = w.log
      .all()
      .find((e) => e.kind === SECT_JOINED_EVENT && e.actors[0] === me && e.tick <= until);
    return joined ? { at: joined.tick, event: joined.id } : undefined;
  }
  if (sketch !== "revenge" || whom === undefined) return undefined;
  const end = w.truth.get(ENTITY, whom)?.endEventId;
  const death = end ? w.log.get(end) : undefined;
  if (!death || death.kind !== "body.died" || death.tick > until) return undefined;
  const remembered = (w.truth.get(MEMORIES, me)?.items ?? []).some((m) => m.eventId === death.id);
  const thinksDead = believed(w.truth.get(BELIEFS, me), whom, "alive")?.value === false;
  return remembered || thinksDead ? { at: death.tick, event: death.id } : undefined;
}

/** Las metas que `me` se propuso, en el orden en que se las propuso, hasta `until`. */
export function chronicleGoals(w: LifeWorld, me: AgentId, until: Tick): ChronicleGoal[] {
  const events = w.log
    .all()
    .filter(
      (e) =>
        e.tick <= until &&
        e.actors[0] === me &&
        (e.kind === GOAL_EVENT || e.kind === GOAL_HOUR_EVENT) &&
        String(dataOf(e).goal ?? "").startsWith("resolve:"),
    );
  const out: ChronicleGoal[] = [];
  for (const [i, born] of events.entries()) {
    const d = dataOf(born);
    if (born.kind !== GOAL_EVENT || d.what !== "born") continue;
    const goal = String(d.goal);
    const rest = events.slice(i + 1);
    const end = rest.find(
      (e) => e.kind === GOAL_EVENT && dataOf(e).goal === goal && dataOf(e).what === "ended",
    );
    const hours = rest.filter(
      (e) =>
        e.kind === GOAL_HOUR_EVENT &&
        dataOf(e).goal === goal &&
        (end === undefined || e.tick <= end.tick),
    ).length;
    const originId = born.causes.find((c) => c.kind === "event")?.event as EventId | undefined;
    const origin = originId ? w.log.get(originId) : undefined;
    const sketch = goal.split(":")[1] ?? "";
    const whom = typeof d.target === "string" ? (d.target as AgentId) : undefined;
    const ending: GoalEnding =
      end === undefined ? "open" : dataOf(end).reason === "dropped" ? "dropped" : "died";
    const achieved = achievedBelieved(w, me, sketch, whom, end?.tick ?? until);
    out.push({
      goal,
      sketch,
      about: aboutOf(origin) ?? sketch,
      ...(whom !== undefined ? { whom } : {}),
      origin: originId ?? born.id,
      from: born.tick,
      ending,
      ...(end !== undefined ? { endedBy: end.id, to: end.tick } : {}),
      hours,
      ...(achieved !== undefined ? { achievedBelieved: achieved } : {}),
    });
  }
  return out;
}
