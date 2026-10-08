// Huellas (perception §9, law §5): lo que un hecho deja en el lugar y se puede percibir después.
// Son entidades con origen, no marcas del narrador: la sangre de una pelea queda donde cayó y se
// va borrando sola. Quién la ve y qué entiende de ella es percepción e inferencia (Fase 2); acá
// vive la verdad de la huella y cuánto queda de ella.

import { type AgentId, type EventId, pow, type Tick } from "../../core/index.ts";
import { type Location, table } from "../world/index.ts";

export type TraceKind = "blood";

export interface Trace {
  readonly kind: TraceKind;
  readonly at: Location;
  readonly made: Tick;
  /** Quién la dejó (verdad: lo que se entienda de ella es otra cosa). */
  readonly by: readonly AgentId[];
  readonly event: EventId;
  /** Cuánto se nota al nacer, 0-1 (una herida leve mancha poco). */
  readonly strength: number;
}

export const TRACE = table<Trace>("law.trace");

/** Segundos hasta que una huella pierde la mitad de lo que se nota. */
export const TRACE_HALF_LIFE: Readonly<Record<TraceKind, number>> = {
  blood: 36 * 3600,
};

/** Milímetros de lluvia que le sacan la mitad a una huella a la intemperie. */
export const TRACE_WASH_MM = 6;

/** Debajo de esto ya no se ve a simple vista. */
export const TRACE_VISIBLE = 0.1;

/**
 * Cuánto se nota la huella en `now`. `rainMm` es la lluvia caída en el lugar desde que se hizo:
 * lava lo que está a la intemperie (`at.space` sin definir) y no toca lo que quedó adentro.
 */
export function traceStrength(t: Trace, now: Tick, rainMm = 0): number {
  const age = Math.max(0, now - t.made);
  const washed = t.at.space === undefined ? pow(0.5, Math.max(0, rainMm) / TRACE_WASH_MM) : 1;
  return t.strength * pow(0.5, age / TRACE_HALF_LIFE[t.kind]) * washed;
}

export function traceVisible(t: Trace, now: Tick, rainMm = 0): boolean {
  return traceStrength(t, now, rainMm) >= TRACE_VISIBLE;
}

/** La mancha que deja una pelea: la herida más grave (0-1) y una base por haber sangrado. */
export function bloodStrength(worstSeverity: number): number {
  return Math.min(1, 0.3 + worstSeverity);
}
