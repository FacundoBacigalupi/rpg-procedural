// El recuento al volver (player-loop §12): al retomar una vida, lo último que el personaje hizo y lo
// último que recuerda, desde sus memorias y de lo que él mismo hizo. Mismo muro que los paneles:
// solo recuerdos propios (con lo que creía al formarlos) y nombres que ya conoce; no lee la verdad
// de lo ocurrido sin que lo viera ni cambia el estado.

import type { AgentId, Tick } from "../../core/index.ts";
import { MEMORIES } from "../../sim/index.ts";
import { knownEntities } from "./known.ts";
import type { LifeWorld } from "./world.ts";

/** Cuántos recuerdos recientes entran en el recuento. */
export const RECAP_MEMORIES = 3;
/** Debajo de esta intensidad un recuerdo no entra (lo trivial no se cuenta al volver). */
export const RECAP_MIN_INTENSITY = 0.15;

export interface RecapMemory {
  /** El tipo del evento recordado (`body.died`, `action.give`…). */
  readonly kind: string;
  /** Hace cuántos días pasó (0 = hoy). */
  readonly daysAgo: number;
  /** Cómo le quedó: dolió, agradó o nada marcado. */
  readonly feel: "bad" | "good" | "neutral";
  /** Los conocidos con quienes fue (por nombre o relación); a los desconocidos no se los nombra. */
  readonly with: readonly string[];
}

export interface Recap {
  /** Lo último que hizo el personaje por su cuenta (verbo del catálogo), o undefined. */
  readonly lastDid?: string;
  /** Hace cuántos días lo hizo. */
  readonly lastDidDaysAgo?: number;
  /** Los recuerdos más recientes, del más nuevo al más viejo. */
  readonly recent: readonly RecapMemory[];
}

/** Valencia → cómo le quedó (umbral sin calibrar). */
export function feelOf(valence: number): RecapMemory["feel"] {
  return valence <= -0.2 ? "bad" : valence >= 0.2 ? "good" : "neutral";
}

/** Lo último que hizo y lo que recuerda de lo más reciente. Puro sobre el mundo, no lo toca. */
export function recapOf(w: LifeWorld): Recap {
  const now: Tick = w.scheduler.now;
  const day = w.clock.day;
  const daysAgo = (at: Tick) => Math.max(0, Math.floor((now - at) / day));
  const names = new Map<string, string>();
  for (const k of knownEntities(w)) {
    if (k.kind !== "person") continue;
    const name = k.names[k.names.length - 1];
    if (name !== undefined) names.set(k.ref, name);
  }
  const me = w.player as AgentId;
  let lastDid: { verb: string; at: Tick } | undefined;
  for (const e of w.log.all()) {
    if (e.actors[0] !== me || !e.kind.startsWith("action.")) continue;
    if (lastDid === undefined || e.tick >= lastDid.at) {
      lastDid = { verb: e.kind.slice("action.".length), at: e.tick };
    }
  }
  const items = (w.truth.get(MEMORIES, me)?.items ?? [])
    .filter((m) => m.intensity >= RECAP_MIN_INTENSITY)
    .slice()
    .sort((a, b) => b.at - a.at || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))
    .slice(0, RECAP_MEMORIES);
  return {
    ...(lastDid === undefined
      ? {}
      : { lastDid: lastDid.verb, lastDidDaysAgo: daysAgo(lastDid.at) }),
    recent: items.map((m) => ({
      kind: m.perceived.kind,
      daysAgo: daysAgo(m.at),
      feel: feelOf(m.valence),
      with: m.perceived.with.flatMap((id) => {
        const n = names.get(id);
        return n === undefined ? [] : [n];
      }),
    })),
  };
}
