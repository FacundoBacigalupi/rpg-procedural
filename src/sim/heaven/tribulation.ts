// La tribulación como evento físico (heaven-karma §5, novel2-trib-gather): cuando una ruptura cruza
// un umbral que el Cielo no tolera, el intento no se resuelve en el acto. El Cielo junta qi de la
// reserva del lugar (débito: la energía sale del campo y vuelve al terminar, conservación) y durante
// unas horas las nubes se cierran sobre quien rompe, a la vista de todos. Después cae; la ruptura se
// resuelve con lo que quedó. Las olas (daño y templado) van en `novel2-trib-waves`.

import type { EntityRef, EventId, PlaceRef, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { HeavenLaw } from "./law.ts";

/** Una tribulación en curso, en la fila de quien rompe. */
export interface Tribulation {
  /** El umbral que quiere cruzar (`ThresholdLaw.id`) y el tramo desde el que lo intenta. */
  readonly threshold: string;
  readonly stage: number;
  /** El qi que el Cielo juntó para ella (unidades de qi), sacado de `pool`. */
  readonly energy: number;
  /** La reserva de donde salió (la fila con `QI_TAKEN`): ahí vuelve al terminar. */
  readonly pool: EntityRef;
  readonly gatheredAt: Tick;
  /** Cuándo cae: después de juntar las nubes. */
  readonly strikeAt: Tick;
  /** Dónde cae: donde se intentó la ruptura. */
  readonly place: PlaceRef;
  /** El intento de ruptura que la llamó. */
  readonly attempt: EventId;
}

export const TRIBULATION = table<Tribulation>("heaven.tribulation");

/** Las nubes se juntan sobre quien rompe (visible desde lejos). */
export const TRIBULATION_GATHERS_EVENT = "heaven.tribulation_gathers";
/** La tribulación cae; la ruptura se resuelve después. */
export const TRIBULATION_STRIKES_EVENT = "heaven.tribulation_strikes";

/** Qué parte de la capacidad del umbral pide el Cielo por unidad de fuerza × ofensa (sin calibrar). */
export const TRIBULATION_SCALE = 0.5;
/** Cuántas horas tardan las nubes, entre estos extremos según fuerza × ofensa (sin calibrar). */
export const GATHER_HOURS = [2, 6] as const;

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Lo que pesa la ofensa para este Cielo, 0-1. */
export function tribulationWeight(heaven: HeavenLaw, transgression: number): number {
  return Math.min(1, Math.max(0, heaven.strength * transgression));
}

/**
 * El qi que el Cielo junta: lo que pide (escala × peso × capacidad del umbral), acotado por lo que
 * la reserva todavía tiene (`inCell`). Nunca más de lo que hay: no crea energía.
 */
export function tribulationEnergy(
  heaven: HeavenLaw,
  transgression: number,
  capacity: number,
  inCell: number,
): number {
  const want = TRIBULATION_SCALE * tribulationWeight(heaven, transgression) * capacity;
  return round4(Math.max(0, Math.min(want, inCell)));
}

/** Cuántas horas tardan las nubes en cerrarse: más ofensa, más tiempo juntando. */
export function gatherHours(heaven: HeavenLaw, transgression: number): number {
  const [lo, hi] = GATHER_HOURS;
  return lo + (hi - lo) * tribulationWeight(heaven, transgression);
}
