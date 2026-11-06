// Los avisos de los saltos que ponen las metas del personaje (novel-goals-watch): aparte de
// `goals.ts` para que el proceso de la verdad (`resolve-goal.ts`) no arrastre la vista.

import type { GoalSketch } from "../view/index.ts";
import { activePlayerGoals, type PlayerGoal } from "./goals.ts";
import type { WatchRule } from "./interrupts.ts";

/**
 * Los avisos que ponen las metas activas en un salto delegado (novel-goals-watch): ver a la persona
 * de la meta y los sucesos de su bosquejo. Con `stopAll` («hasta que pase algo con mi meta») todo
 * corta en vez de anotar.
 */
export function goalWatch(
  goals: readonly PlayerGoal[],
  sketches: readonly GoalSketch[],
  stopAll = false,
): WatchRule[] {
  const out: WatchRule[] = [];
  for (const g of activePlayerGoals(goals)) {
    const w = sketches.find((s) => s.id === g.sketch)?.watch;
    if (w === undefined) continue;
    if (w.person !== undefined && g.target !== undefined)
      out.push({
        on: { kind: "goal", goal: g.id, who: g.target },
        action: stopAll ? "stop" : w.person,
      });
    if (w.events !== undefined)
      out.push({
        on: { kind: "goal", goal: g.id, events: w.events },
        action: stopAll ? "stop" : (w.action ?? "note"),
      });
  }
  return out;
}
