// Los nombres que el personaje sabe de gente fuera de su familia (novel-names-introduce). Al
// preguntarle el nombre a alguien o presentarse, quien contesta dice el suyo (`introduce`); desde ahí
// el personaje lo reconoce al verlo (`acquaintances`) y lo nombra. Lo que guarda es lo que oyó, con
// cuándo y en qué conversación: la creencia del nombre, no una lectura de la verdad.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../../sim/index.ts";

export interface KnownName {
  /** El nombre como lo oyó. */
  readonly name: string;
  readonly at: Tick;
}

/** Por agente: a quién conoce de nombre (fuera de su familia) y cómo lo oyó. */
export interface KnownNames {
  readonly people: Readonly<Record<AgentId, KnownName>>;
  readonly originEventId?: EventId;
}
export const KNOWN_NAMES = table<KnownNames>("life.known_names");

/** Suma (o actualiza) un nombre oído. */
export function learnName(
  prev: KnownNames | undefined,
  who: AgentId,
  name: string,
  at: Tick,
): KnownNames {
  return { ...(prev ?? {}), people: { ...(prev?.people ?? {}), [who]: { name, at } } };
}
