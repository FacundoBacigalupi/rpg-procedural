// Absorber (novel-cult-absorb, cultivation §4): quien ya siente el qi y medita lo saca de la celda
// de la aldea hacia su recipiente. No se crea qi: lo que entra al recipiente sale de la celda
// (`QI_TAKEN`, débito que la regeneración de la celda repone con los años) y nunca más de lo que la
// celda tiene. Cuánto entra depende del qi del lugar, de cuánto se parece el qi de la celda a la raíz
// (una raíz de fuego en un valle de agua junta poco: el qi se resiste), de los meridianos y de la
// calma; lo que entra tiene esa misma pureza. El recipiente se llena hasta la capacidad del primer
// umbral de la ley y ahí no entra más (romperlo es `novel-cult-break`). Las tasas no están calibradas.
//
// Débito propio y no `AMBIENT_TAKEN`: aquella fila es por persona y la escribe solo `life.residue`;
// las dos, en el mismo paso, chocarían.

import type { Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { CultivationLaw } from "./law.ts";
import type { PlaceQi } from "./meditation.ts";
import type { Aptitude } from "./talent.ts";

export const ABSORBED_EVENT = "cultivation.absorbed";

/** Lo que la gente le sacó a la celda de la aldea, en la fila del plano. */
export interface QiTaken {
  /** Lo sacado y aún no repuesto por la regeneración. */
  readonly taken: number;
  /** Todo lo sacado alguna vez: la suma de lo que entró a los recipientes. */
  readonly drawn: number;
  /** Hasta cuándo está repuesto `taken`. */
  readonly at: Tick;
}

export const QI_TAKEN = table<QiTaken>("cultivation.qi_taken");

/** Lo que entra por hora con todo en el medio (sin calibrar): unas cincuenta horas al primer umbral. */
export const ABSORB_RATE = 2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * Cuánto se parece el qi de la celda a la raíz, 0-1: la afinidad de cada raíz por la parte de su
 * elemento en la celda, contra una celda pareja (la mitad ya es mucho). Sin raíz, 0.
 */
export function rootMatch(apt: Aptitude, place: PlaceQi | undefined): number {
  if (apt.roots.length === 0) return 0;
  if (!place) return 0.5;
  const total = Object.values(place.elements).reduce((s, v) => s + v, 0);
  if (!(total > 0)) return 0;
  const fit = apt.roots.reduce(
    (s, r) => s + r.affinity * ((place.elements[r.element] ?? 0) / total),
    0,
  );
  return round4(clamp01(2 * fit));
}

/** La capacidad del recipiente antes del primer umbral del camino del qi. */
export function vesselCapacity(law: CultivationLaw): number {
  return law.paths[0]?.thresholds[0]?.capacity ?? 0;
}

/** El débito de la celda repuesto hasta `now` por la regeneración (nunca negativo). */
export function regrown(taken: QiTaken, place: PlaceQi, now: Tick, yearTicks: number): QiTaken {
  if (now <= taken.at) return taken;
  const back = (place.regenPerYear * (now - taken.at)) / yearTicks;
  return { ...taken, taken: round4(Math.max(0, taken.taken - back)), at: now };
}

/** Cuánto pide el cuerpo en `hours` horas, antes de mirar la celda y el recipiente. */
export function absorbWant(
  apt: Aptitude,
  hours: number,
  calm: number,
  factor: number,
  match: number,
): number {
  if (apt.roots.length === 0 || hours <= 0) return 0;
  return (
    ABSORB_RATE *
    hours *
    factor *
    (0.25 + 0.75 * match) *
    (0.5 + apt.meridians) *
    clamp01(calm) *
    (0.5 + apt.rootQuality)
  );
}

/** Lo que entra de verdad: lo pedido, acotado por lo que queda en la celda y en el recipiente. */
export function absorbDraw(
  want: number,
  place: PlaceQi,
  taken: number,
  qi: number,
  capacity: number,
): number {
  const inCell = Math.max(0, place.level - taken);
  const room = Math.max(0, capacity - qi);
  return round4(Math.max(0, Math.min(want, inCell, room)));
}

/** La pureza del recipiente después de sumar `drawn` de pureza `match`. */
export function mixedPurity(qi: number, purity: number, drawn: number, match: number): number {
  const total = qi + drawn;
  return total > 0 ? round4((qi * purity + drawn * match) / total) : purity;
}
