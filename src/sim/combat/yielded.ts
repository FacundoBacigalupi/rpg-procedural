// Quien se rindió queda a merced del que ganó (combat.md §12): sigue en pie, sin defenderse, y lo
// que sigue —rematarlo o perdonarlo— es una decisión del vencedor, con peso en los testigos. La
// rendición dura un rato; pasado ese rato se fue, lo atan o se recompone, y ya no es un remate.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export interface Yielded {
  /** A quién se rindió. */
  readonly to: AgentId;
  readonly at: Tick;
  /** La pelea que terminó así. */
  readonly event: EventId;
}

/** Quién está rendido, en su propia entidad. */
export const YIELDED = table<Yielded>("combat.yielded");

/** Cuánto dura la merced: una hora (calibración abierta). */
export const YIELD_WINDOW = 3600;

/** Fuerza del remate sobre alguien que no se defiende (0-1, la escala de `Blow.force`). */
export const FINISH_FORCE = 0.9;

/** Si `who` sigue a merced de `victor` en `now`. */
export function atMercyOf(y: Yielded | undefined, victor: AgentId, now: Tick): boolean {
  return y !== undefined && y.to === victor && now - y.at <= YIELD_WINDOW;
}
