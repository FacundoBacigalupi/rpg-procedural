// Agravio de tercero por rumor (information §3, tooling §6): quien se entera de oídas de lo que
// `accused` le hizo a otro mueve su propia relación con el culpable, sin haber estado. Es opt-in
// (`AppraiseOptions.rumorGrievance`): pesa por cuánto cree el rumor, la gravedad que le llegó y lo
// cerca que está de la víctima. Pura; sin RNG ni estado propio (la fila de relaciones la escribe
// `life.appraise`, único dueño de `RELATIONS`).

import type { AgentId, Event } from "../../core/index.ts";
import type { Deltas, Rumors } from "../../sim/index.ts";

/** Cuánto baja la confianza con credibilidad, gravedad y cercanía a la víctima al máximo. */
export const GRIEVANCE_TRUST = 0.3;
/** Y el cariño: baja menos (no es un trato propio). */
export const GRIEVANCE_AFFECTION = 0.1;
/** Cercanía mínima a la víctima para que el rumor le importe (un desconocido no se indigna). */
export const GRIEVANCE_FLOOR = 0.15;

export interface RumorGrievance {
  readonly listener: AgentId;
  readonly accused: AgentId;
  readonly victim: AgentId;
  readonly credit: number;
  readonly severity: number;
}

/**
 * Del evento `rumor.told` y lo que el oyente guarda en `RUMORS`: contra quién se indigna.
 * Nada si no lo creyó, si no hay culpable nombrado o si el oyente es parte del hecho.
 */
export function grievanceOf(e: Event, heard: Rumors | undefined): RumorGrievance | null {
  if (e.kind !== "rumor.told") return null;
  const listener = e.actors[1] as AgentId | undefined;
  const data = e.data as { deed?: string; credit?: number };
  if (!listener || !data.deed) return null;
  const h = heard?.items.find((x) => x.root === data.deed);
  const accused = h?.content.by;
  if (!h || !accused) return null;
  if (listener === accused || listener === h.content.victim) return null;
  const credit = data.credit ?? h.confidence;
  if (credit <= 0) return null;
  return {
    listener,
    accused,
    victim: h.content.victim,
    credit,
    severity: h.content.severity,
  };
}

/** Lo que cambia lo que el oyente siente por el culpable, dado cuán cerca está de la víctima. */
export function grievanceDeltas(g: RumorGrievance, closenessToVictim: number): Deltas | null {
  if (closenessToVictim < GRIEVANCE_FLOOR) return null;
  const w = g.credit * Math.min(1, g.severity) * closenessToVictim;
  return { trust: -GRIEVANCE_TRUST * w, affection: -GRIEVANCE_AFFECTION * w };
}
