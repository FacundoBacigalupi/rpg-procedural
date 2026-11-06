// Los días delegados a favor de las metas (novel-goals-truth-delegate, player-loop §5 y §8): cuando
// el jugador salta días, la rutina del hogar sigue mandando (duerme, come, va al campo), pero las
// horas libres salen de los objetivos que se propuso (`resolve:*` en `NPC_GOALS`): las metas de
// riqueza, tierra u oficio lo hacen madrugar al campo (a la tarde, después de diez horas de campo,
// ya está agotado); las de una persona (venganza, cuidarla, familia) lo llevan a la tarde a la casa
// de esa persona, donde la percepción hace el resto (avisos de `goalWatch`). Puro: lo usa
// `routineProcess` solo para el jugador con días delegados.

import type { AgentId } from "../../core/index.ts";
import type { Goal } from "../../sim/index.ts";

/** Las horas de la mañana, antes del campo, que una meta de trabajo toma (sin calibrar). */
export const GOAL_WORK_HOURS = [6, 8] as const;
/** Las horas de la tarde, después del campo y antes de acostarse, para ir hacia una persona. */
export const GOAL_VISIT_HOURS = [18, 21] as const;

/** Bosquejos cuyas metas se sirven trabajando de más (`content/goals/`). */
const WORK_SKETCHES: readonly string[] = ["wealth", "land", "craft"];
/** Bosquejos cuyas metas se sirven yendo hacia la persona. */
const PERSON_SKETCHES: readonly string[] = ["revenge", "protect", "family"];

const sketchOfGoal = (g: Goal): string =>
  g.id.startsWith("resolve:") ? (g.id.split(":")[1] ?? "") : "";

/** Lo que una hora hace por una meta, o nada si la hora es de la rutina. */
export type GoalHour =
  | { readonly kind: "work"; readonly goal: string }
  | { readonly kind: "visit"; readonly goal: string; readonly whom: AgentId };

const within = (h: number, [a, b]: readonly [number, number]) => h >= a && h < b;

/**
 * Qué hace a esta hora local quien delegó sus días y se propuso algo: la meta de trabajo de más peso
 * toma la mañana antes del campo (si tiene edad de trabajar y no está agotado: `rested`); la de una
 * persona, la tarde (si no le duele nada: `able`). Desempata por id, así el resultado no depende del
 * orden. `alive` descarta personas que ya no están.
 */
export function goalHour(
  goals: readonly Goal[],
  hour: number,
  state: {
    readonly ageYears: number;
    readonly workAge: number;
    readonly rested: boolean;
    readonly able: boolean;
  },
  alive: (who: AgentId) => boolean,
): GoalHour | undefined {
  const h = Math.floor(hour);
  const best = (pick: (g: Goal) => boolean) =>
    goals
      .filter(pick)
      .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (within(h, GOAL_WORK_HOURS)) {
    if (state.ageYears < state.workAge || !state.rested) return undefined;
    const work = best((g) => WORK_SKETCHES.includes(sketchOfGoal(g)));
    return work !== undefined ? { kind: "work", goal: work.id } : undefined;
  }
  if (within(h, GOAL_VISIT_HOURS)) {
    if (!state.able) return undefined;
    const person = best(
      (g) => PERSON_SKETCHES.includes(sketchOfGoal(g)) && g.target !== undefined && alive(g.target),
    );
    return person?.target !== undefined
      ? { kind: "visit", goal: person.id, whom: person.target }
      : undefined;
  }
  return undefined;
}
