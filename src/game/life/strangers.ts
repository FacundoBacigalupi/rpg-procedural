// Extraños sin identidad como impresiones (player-loop §9, information §1): al mirar, lo que se ve
// de alguien que no se reconoce (figura, ropa, dónde, cuándo) no es una creencia sobre un
// `AgentId`: queda como impresión con clave por lugar, figura y día. Cada impresión pierde
// saliencia con los días, la capacidad es corta y lo que menos pesa se olvida primero. Puro: la
// escritura la hace `life.looking`.

import { exp, LN2, type Tick } from "../../core/index.ts";
import { table } from "../../sim/index.ts";

export interface StrangerImpression {
  /** Hex, figura y día: la misma persona vista de nuevo ese día refuerza la misma impresión. */
  readonly key: string;
  readonly hex: number;
  /** La figura como texto (`sexo:franja`, ver `figureText`). */
  readonly figure: string;
  readonly attire?: string;
  readonly seen: Tick;
  /** 0-1: cuánto se fió de lo que leyó. */
  readonly confidence: number;
  /** 0-1 a `seen`; decae con los días. */
  readonly salience: number;
  readonly times: number;
}

export interface Strangers {
  readonly items: readonly StrangerImpression[];
}

/** Las impresiones de extraños de cada observador. */
export const STRANGERS = table<Strangers>("life.strangers");

export const STRANGER_CAPACITY = 12;
/** Vida media de la saliencia de un extraño, en días. */
export const STRANGER_HALF_LIFE_DAYS = 4;
/** Bajo esta saliencia envejecida la impresión se olvida. */
export const STRANGER_FORGOTTEN = 0.05;

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function strangerKey(hex: number, figure: string, day: number): string {
  return `${hex}:${figure}:${day}`;
}

/** La saliencia de `i` en `now`, ya envejecida. */
export function strangerSalienceAt(i: StrangerImpression, now: Tick, dayLength: number): number {
  const days = Math.max(0, now - i.seen) / dayLength;
  return round(i.salience * exp((-LN2 * days) / STRANGER_HALF_LIFE_DAYS));
}

/**
 * Guarda lo visto de un extraño: la misma clave se refuerza (más veces, más confianza y
 * saliencia, el último vistazo) y lo demás compite por la capacidad con lo que ya pesa menos.
 */
export function rememberStranger(
  current: Strangers | undefined,
  seen: {
    readonly hex: number;
    readonly figure: string;
    readonly attire?: string;
    readonly confidence: number;
  },
  now: Tick,
  dayLength: number,
): Strangers {
  const day = Math.floor(now / dayLength);
  const key = strangerKey(seen.hex, seen.figure, day);
  const prev = current?.items.find((i) => i.key === key);
  const fresh: StrangerImpression = {
    key,
    hex: seen.hex,
    figure: seen.figure,
    ...(seen.attire === undefined ? {} : { attire: seen.attire }),
    seen: now,
    confidence: round(Math.max(prev?.confidence ?? 0, seen.confidence)),
    salience: round(Math.min(1, (prev ? strangerSalienceAt(prev, now, dayLength) : 0) + 0.5)),
    times: (prev?.times ?? 0) + 1,
  };
  const rest = (current?.items ?? [])
    .filter((i) => i.key !== key)
    .map((i) => ({ i, s: strangerSalienceAt(i, now, dayLength) }))
    .filter((x) => x.s >= STRANGER_FORGOTTEN)
    .sort((a, b) => b.s - a.s || (a.i.key < b.i.key ? -1 : 1))
    .slice(0, STRANGER_CAPACITY - 1)
    .map((x) => x.i);
  return { items: [...rest, fresh] };
}

/**
 * Los extraños de la misma figura vistos en un día anterior y todavía recordados: «el desconocido
 * de ayer». El más reciente primero.
 */
export function strangersSeenBefore(
  strangers: Strangers | undefined,
  figure: string,
  now: Tick,
  dayLength: number,
): StrangerImpression[] {
  const today = Math.floor(now / dayLength);
  return (strangers?.items ?? [])
    .filter(
      (i) =>
        i.figure === figure &&
        Math.floor(i.seen / dayLength) < today &&
        strangerSalienceAt(i, now, dayLength) >= STRANGER_FORGOTTEN,
    )
    .sort((a, b) => b.seen - a.seen || (a.key < b.key ? -1 : 1));
}
