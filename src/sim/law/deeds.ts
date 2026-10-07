// Lo que cada uno sabe de lo que otros hicieron (law §2, §15; information): un delito entra en la
// justicia de la aldea solo si alguien lo cree. Hasta que exista el almacén de creencias, cada uno
// guarda los hechos que vio o le contaron (`Deed`), con quién fue si lo reconoció. La fama de
// alguien no es un número del mundo: es cuánta gente sabe de lo que hizo.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export type DeedKind = "theft" | "assault";

/** Cómo lo supo: lo vio, lo oyó (sin ver), se lo contaron. */
export type DeedVia = "saw" | "heard" | "told";

export interface Deed {
  readonly kind: DeedKind;
  /** Quién lo hizo, si lo reconoció (si no, se sabe que pasó y no quién). */
  readonly by: AgentId | null;
  readonly victim: AgentId;
  /** El evento de la verdad (para el inspector y la crónica; nadie del mundo lo ve). */
  readonly event: EventId;
  readonly at: Tick;
  readonly via: DeedVia;
}

export interface KnownDeeds {
  readonly deeds: readonly Deed[];
}

/** Lo que alguien sabe de lo que pasó, en su entidad. */
export const KNOWN_DEEDS = table<KnownDeeds>("law.known_deeds");

/** Cuántos hechos guarda cada uno (los más viejos se olvidan; la memoria real llega en Fase 2). */
export const KEPT_DEEDS = 16;

/**
 * Suma `deed`: el mismo evento no se guarda dos veces, y si ya lo había visto no se pisa con un
 * «me contaron». Pero saber quién fue pisa el «no sé quién».
 */
export function learnDeed(before: KnownDeeds | undefined, deed: Deed): KnownDeeds {
  const old = before?.deeds ?? [];
  const same = old.find((d) => d.event === deed.event);
  if (same) {
    const better = same.by === null && deed.by !== null;
    if (!better) return before as KnownDeeds;
    return { deeds: old.map((d) => (d.event === deed.event ? { ...d, by: deed.by } : d)) };
  }
  return { deeds: [...old, deed].slice(-KEPT_DEEDS) };
}

/** Lo que `knower` sabe que hizo `who` (los hechos con su nombre). */
export function deedsBy(known: KnownDeeds | undefined, who: AgentId): readonly Deed[] {
  return (known?.deeds ?? []).filter((d) => d.by === who);
}

/** El hecho más grave que `knower` sabe de `who` (el robo pesa menos que herir a alguien). */
export function worstDeed(known: KnownDeeds | undefined, who: AgentId): Deed | null {
  const by = deedsBy(known, who);
  return by.find((d) => d.kind === "assault") ?? by[0] ?? null;
}

/**
 * Fama de `who` entre `knowers`: la fracción que sabe de algo que hizo (0-1). Es lo que cambia el
 * trato (deferencia, regateo, pedidos), y sale solo de quién lo vio o se lo contó.
 */
export function notoriety(knowers: readonly (KnownDeeds | undefined)[], who: AgentId): number {
  if (knowers.length === 0) return 0;
  const aware = knowers.filter((k) => deedsBy(k, who).length > 0).length;
  return aware / knowers.length;
}

/** Cuánto baja la fama el margen de un trato (como la deferencia, con tope). */
export const NOTORIETY_EDGE = 0.12;

export function notorietyEdge(fame: number): number {
  return -NOTORIETY_EDGE * Math.min(1, Math.max(0, fame));
}
