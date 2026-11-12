// La tribulación como evento físico (heaven-karma §5, novel2-trib-gather): cuando una ruptura cruza
// un umbral que el Cielo no tolera, el intento no se resuelve en el acto. El Cielo junta qi de la
// reserva del lugar (débito: la energía sale del campo y vuelve al terminar, conservación) y durante
// unas horas las nubes se cierran sobre quien rompe, a la vista de todos. Después cae; la ruptura se
// resuelve con lo que quedó. Cae en olas (`novel2-trib-waves`): cada una daña según lo que aguanta
// quien rompe y, si la aguanta, lo templa.

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
  /** En cuántas olas cae (`waveCount`). */
  readonly waves: number;
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

/** Lo que de una tribulación ven y oyen los de alrededor (novel2-trib-seen): nubes, caída y rayos. */
export const TRIBULATION_SEEN: ReadonlySet<string> = new Set([
  TRIBULATION_GATHERS_EVENT,
  TRIBULATION_STRIKES_EVENT,
  "heaven.tribulation_wave",
]);

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

// ---------------------------------------------------------------------------------------------
// Las olas (novel2-trib-waves)

/** Cada rayo que cae: daña lo que golpea y, si se aguanta, templa. */
export const TRIBULATION_WAVE_EVENT = "heaven.tribulation_wave";

/** Cuántas olas, entre estos extremos según fuerza × ofensa. */
export const WAVES = [3, 9] as const;
/** Cuánto pega una ola por unidad de energía sobre lo que aguanta (sin calibrar). */
export const WAVE_FORCE = 5;
/** Daño a los meridianos por unidad de fuerza de una ola (sin calibrar). */
export const WAVE_MERIDIAN = 0.05;
/** Templado por unidad de fuerza de una ola aguantada; suma a la calidad de la ruptura (sin calibrar). */
export const WAVE_TEMPER = 0.04;

export function waveCount(heaven: HeavenLaw, transgression: number): number {
  const [lo, hi] = WAVES;
  return lo + Math.round((hi - lo) * tribulationWeight(heaven, transgression));
}

/** Lo que aguanta quien recibe la ola: su recipiente, su fundamento y su salud. */
export interface WaveHold {
  readonly capacity: number;
  readonly qi: number;
  /** El fundamento acumulado (calidad de rupturas anteriores). */
  readonly foundation: number;
  /** 0-1: cuánto cuerpo sano queda (1 sin heridas abiertas). */
  readonly health: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * La fuerza (0-1) con que una ola de `energy` llega al cuerpo: la energía contra lo que aguanta,
 * con `roll` (0-1) para la puntería del rayo. Un recipiente lleno, un fundamento hondo y un cuerpo
 * entero la frenan; vacío y herido, la misma ola pega más.
 */
export function waveForce(energy: number, hold: WaveHold, roll: number): number {
  if (energy <= 0) return 0;
  const fill = hold.capacity > 0 ? clamp01(hold.qi / hold.capacity) : 0;
  const resist =
    Math.max(1e-6, hold.capacity) *
    (0.5 + 0.5 * Math.min(1, hold.foundation)) *
    (0.5 + 0.5 * fill) *
    Math.max(0.2, clamp01(hold.health));
  return round4(clamp01(((WAVE_FORCE * energy) / resist) * (0.7 + 0.6 * clamp01(roll))));
}

/** Lo que templa una ola aguantada. */
export function waveTemper(force: number): number {
  return round4(WAVE_TEMPER * clamp01(force));
}
