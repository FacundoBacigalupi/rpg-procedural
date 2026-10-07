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

/** Debajo de esto ya no se ve a simple vista. */
export const TRACE_VISIBLE = 0.1;

/** Cuánto se nota la huella en `now`. */
export function traceStrength(t: Trace, now: Tick): number {
  const age = Math.max(0, now - t.made);
  return t.strength * pow(0.5, age / TRACE_HALF_LIFE[t.kind]);
}

export function traceVisible(t: Trace, now: Tick): boolean {
  return traceStrength(t, now) >= TRACE_VISIBLE;
}

/** La mancha que deja una pelea: la herida más grave (0-1) y una base por haber sangrado. */
export function bloodStrength(worstSeverity: number): number {
  return Math.min(1, 0.3 + worstSeverity);
}
