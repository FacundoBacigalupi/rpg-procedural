// Habituación (perception, ampliación 2026-10-08): un percept sostenido en el tiempo (un olor, un
// ruido de fondo, la luz) pierde saliencia con una vida media que depende del canal y, si hace
// falta, del tipo de estímulo. Se renueva con un cambio (aparece algo nuevo o la intensidad se
// mueve lo bastante desde la última vez que se lo notó) o con atención deliberada. Lo habituado
// sigue ahí: el personaje deja de notarlo, pero un cambio fuerte lo vuelve a poner.
//
// Es matemática pura sobre una memoria que lleva quien la use (no es estado del mundo). Los canales
// de acá son los sentidos del personaje, más finos que los canales de emisión de `Percept`.

import { pow, type Tick } from "../../core/index.ts";

export const SENSES = ["sight", "hearing", "touch", "smell"] as const;
export type Sense = (typeof SENSES)[number];

/** Segundos en que la saliencia baja a la mitad, por canal. */
export const SENSE_HALF_LIFE: Readonly<Record<Sense, number>> = {
  smell: 5 * 60,
  hearing: 20 * 60,
  touch: 45 * 60,
  sight: 4 * 3600,
};

/**
 * Vidas medias propias de un tipo de estímulo (clave `canal/tipo`) que se apartan de la de su
 * canal: el viento se pierde pronto en el fondo, el frío intenso tarda más en dejar de notarse.
 */
export const KIND_HALF_LIFE: Readonly<Record<string, number>> = {
  "hearing/wind": 12 * 60,
  "touch/freezing": 2 * 3600,
  "touch/hot": 90 * 60,
};

/** Por debajo de esto ya no figura. */
export const NOTICEABLE = 0.25;

/** Cuánto tiene que moverse la intensidad (0-1) desde el último aviso para renovar la saliencia. */
export const RENEWAL_DELTA = 0.15;

export interface HabituationEntry {
  /** Desde cuándo se nota (la última renovación). */
  readonly since: Tick;
  /** Intensidad 0-1 en esa renovación. */
  readonly intensity: number;
}

/** Memoria por estímulo; la clave la arma quien la use (lugar, canal, tipo). */
export type HabituationMemory = Map<string, HabituationEntry>;

export function halfLifeOf(sense: Sense, kind: string): number {
  return KIND_HALF_LIFE[`${sense}/${kind}`] ?? SENSE_HALF_LIFE[sense];
}

/**
 * Anota el estímulo y devuelve su saliencia (0-1). Se renueva (saliencia 1) si es nuevo, si se
 * atiende a propósito o si la intensidad se movió `RENEWAL_DELTA` o más desde la última renovación;
 * si no, decae a la mitad por vida media. Un cambio chico no renueva pero se acumula: una deriva
 * lenta termina renovando.
 */
export function habituate(
  memory: HabituationMemory,
  key: string,
  sense: Sense,
  kind: string,
  intensity: number,
  now: Tick,
  attended = false,
): number {
  const prev = memory.get(key);
  if (!prev || attended || Math.abs(intensity - prev.intensity) >= RENEWAL_DELTA) {
    memory.set(key, { since: now, intensity });
    return 1;
  }
  return pow(0.5, Math.max(0, now - prev.since) / halfLifeOf(sense, kind));
}

/** Olvida lo que dejó de estar (para que, si vuelve, cuente como nuevo). */
export function forgetExcept(memory: HabituationMemory, present: ReadonlySet<string>): void {
  for (const k of [...memory.keys()]) if (!present.has(k)) memory.delete(k);
}
