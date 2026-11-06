// Meditar y sentir el qi (novel-cult-meditate, cultivation §4): el primer paso del camino del qi.
// Cada uno tiene una sensibilidad al qi que sube con las horas quieto, más rápido con comprensión,
// calma, buena raíz y un lugar con qi; la primera vez que cruza `SENSE_THRESHOLD` lo siente
// (`cultivation.sensed_qi`). Sin raíz no sube nunca: la quietud no encuentra nada. El qi del lugar
// es el nivel de esencia de la celda del planeta donde está la aldea, fijado al sembrar (al retomar
// no hay planeta), contra la media del planeta. Las tasas no están calibradas.

import type { EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { Aptitude } from "./talent.ts";

export const SENSED_QI_EVENT = "cultivation.sensed_qi";

/** El qi de la aldea, en la fila del plano: toda la aldea comparte el de su celda. */
export interface PlaceQi {
  /** La celda del planeta. */
  readonly cell: number;
  /** `planet.essence.level` de la celda. */
  readonly level: number;
  /** La media del planeta: un lugar común vale 1. */
  readonly reference: number;
  /** Lo que nace por año en la celda (`planet.essence.regen`): repone lo absorbido. */
  readonly regenPerYear: number;
  /** De qué elementos está hecho el qi de la celda (`cellElements`, suma `level`). */
  readonly elements: Readonly<Record<string, number>>;
}

export const PLACE_QI = table<PlaceQi>("cultivation.place_qi");

/** Lo que una persona lleva cultivado. Verdad: nadie lo lee, se manifiesta. */
export interface CultivationState {
  /** Sensibilidad al qi: llega a `SENSE_THRESHOLD` y lo siente. */
  readonly sensitivity: number;
  /** Horas meditadas en total. */
  readonly hours: number;
  /** Cuándo lo sintió por primera vez y en qué meditación (`action.meditate`). */
  readonly sensed?: { readonly at: Tick; readonly event: EventId };
  /** Qi en el recipiente (novel-cult-absorb): salido de la celda, conservado. */
  readonly qi?: number;
  /** Pureza del qi del recipiente, 0-1: cuánto se parece a la raíz. */
  readonly purity?: number;
}

export const CULTIVATION_STATE = table<CultivationState>("cultivation.state");

/** La sensibilidad a la que se siente el qi. */
export const SENSE_THRESHOLD = 1;
/** Lo que sube por hora con todo en el medio (sin calibrar): unas veinte horas de meditación. */
export const SENSE_RATE = 0.05;
/** Cuánto pesa el qi del lugar, acotado: un lugar muerto o una veta no son infinitos. */
export const QI_FACTOR_RANGE = [0.25, 4] as const;

/** Cuánto multiplica el qi del lugar: la raíz de su nivel contra la media, acotado. */
export function qiFactor(qi: PlaceQi | undefined): number {
  if (!qi || qi.reference <= 0) return 1;
  const [lo, hi] = QI_FACTOR_RANGE;
  return Math.sqrt(Math.min(hi, Math.max(lo, qi.level / qi.reference)));
}

/**
 * Cuánto sube la sensibilidad en `hours` horas de meditación. `calm` es 0-1 (el dolor y la necesidad
 * la bajan). Sin raíz, nada.
 */
export function meditationGain(apt: Aptitude, hours: number, calm: number, factor: number): number {
  if (apt.roots.length === 0 || hours <= 0) return 0;
  const c = Math.min(1, Math.max(0, calm));
  return SENSE_RATE * hours * (0.5 + apt.comprehension) * c * factor * (0.5 + apt.rootQuality);
}
