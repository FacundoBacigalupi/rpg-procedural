// Lo vivido en un salto de tiempo (narration §1, modo `montage`): de los pasos del turno y de los
// eventos propios del registro, cuenta qué hizo el personaje (verbos más repetidos y cuántos le
// salieron mal), con cuántas personas habló y si se lastimó o peleó. Solo lo propio y solo cuentas:
// nada de lo que pasó en el mundo sin que él lo viera. Puro sobre sus entradas, no toca el estado.

import type { AgentId, Event, Tick } from "../../core/index.ts";
import type { StretchInput } from "../view/index.ts";
import type { StepRecord } from "./act.ts";

/** Cuántos verbos distintos entran en el resumen (los más repetidos). */
export const STRETCH_VERBS = 3;
/** Verbos que no cuentan como «algo que hizo» en un salto (esperar es el salto mismo). */
const IDLE_VERBS: ReadonlySet<string> = new Set(["wait", "observe", "look"]);

/** Cuántas heridas sentidas se cuentan en un salto. */
export const STRETCH_WOUNDS = 2;
/** Qué tan grave suena cada señal de herida, para contar primero la peor (sin calibrar). */
const WOUND_RANK: Readonly<Record<string, number>> = {
  bone_broken: 4,
  bleeding_heavily: 3,
  wound_hot: 2,
  bleeding: 1,
  in_pain: 0,
};

/**
 * De las señales del cuerpo por zona (`bodySigns.zones`) deja las de herida, la peor de cada zona,
 * de la más grave a la menos (empate por zona). Puro.
 */
export function feltWounds(
  zones: readonly { readonly zone: string; readonly signs: readonly string[] }[],
): { zone: string; sign: string }[] {
  const out: { zone: string; sign: string; rank: number }[] = [];
  for (const z of zones) {
    let best: { sign: string; rank: number } | undefined;
    for (const s of z.signs) {
      const rank = WOUND_RANK[s];
      if (rank !== undefined && (best === undefined || rank > best.rank)) best = { sign: s, rank };
    }
    if (best) out.push({ zone: z.zone, ...best });
  }
  return out
    .sort((a, b) => b.rank - a.rank || (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : 0))
    .slice(0, STRETCH_WOUNDS)
    .map(({ zone, sign }) => ({ zone, sign }));
}

export function stretchOf(
  steps: readonly StepRecord[],
  events: readonly Event[],
  me: AgentId,
  since: Tick,
  now: Tick,
  dayLength: number,
  zones: readonly { readonly zone: string; readonly signs: readonly string[] }[] = [],
): StretchInput {
  const wounds = feltWounds(zones);
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
    metWith: [...spoke].sort() as AgentId[],
    hurt: hurt || fought || wounds.length > 0,
    fought,
    ...(wounds.length > 0 ? { wounds } : {}),
  };
}
