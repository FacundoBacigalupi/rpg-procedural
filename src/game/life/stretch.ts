// Lo vivido en un salto de tiempo (narration §1, modo `montage`): de los pasos del turno y de los
// eventos propios del registro, cuenta qué hizo el personaje (verbos más repetidos y cuántos le
// salieron mal), con cuántas personas habló y si se lastimó o peleó. Solo lo propio y solo cuentas:
// nada de lo que pasó en el mundo sin que él lo viera. Puro sobre sus entradas, no toca el estado.

import type { AgentId, Event, Tick } from "../../core/index.ts";
import type { StretchView } from "../view/index.ts";
import type { StepRecord } from "./act.ts";

/** Cuántos verbos distintos entran en el resumen (los más repetidos). */
export const STRETCH_VERBS = 3;
/** Verbos que no cuentan como «algo que hizo» en un salto (esperar es el salto mismo). */
const IDLE_VERBS: ReadonlySet<string> = new Set(["wait", "observe", "look"]);

export function stretchOf(
  steps: readonly StepRecord[],
  events: readonly Event[],
  me: AgentId,
  since: Tick,
  now: Tick,
  dayLength: number,
): StretchView {
  const tally = new Map<string, { times: number; failed: number }>();
  const spoke = new Set<string>();
  let hurt = false;
  for (const s of steps) {
    const fx = s.self.effect;
    if (fx.kind === "speak" && fx.to !== null) spoke.add(fx.to);
    if (fx.kind === "work" && fx.hurt) hurt = true;
    if (IDLE_VERBS.has(s.verb)) continue;
    const row = tally.get(s.verb) ?? { times: 0, failed: 0 };
    tally.set(s.verb, {
      times: row.times + 1,
      failed: row.failed + (s.self.believed === "failure" ? 1 : 0),
    });
  }
  const fought = events.some(
    (e) => e.tick >= since && e.kind.startsWith("combat.") && e.actors.includes(me),
  );
  const did = [...tally]
    .map(([verb, r]) => ({ verb, ...r }))
    .sort((a, b) => b.times - a.times || (a.verb < b.verb ? -1 : a.verb > b.verb ? 1 : 0))
    .slice(0, STRETCH_VERBS);
  return {
    days: Math.max(1, Math.round((now - since) / dayLength)),
    did,
    spoke: spoke.size,
    hurt: hurt || fought,
    fought,
  };
}
